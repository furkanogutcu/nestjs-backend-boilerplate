import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'crypto';
import { QueryFailedError } from 'typeorm';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { MailProducer } from '@infrastructure/mail/jobs/mail.producer';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { CacheKey } from '@shared/utils/cache-key.util';
import { generateUuid } from '@shared/utils/uuid.util';

import { EMAIL_VERIFICATION_TOKEN_BYTES, PASSWORD_RESET_TOKEN_BYTES } from '../constants/auth.constant';
import { User } from '../entities/user.entity';
import { MfaService } from '../mfa/services/mfa.service';
import { UserRolesService } from '../rbac/services/user-roles.service';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';
import { ICredentialsResult } from './interfaces/credentials-result.interface';
import { PasswordStrengthService } from './password-strength.service';

const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);
  private readonly emailVerificationPrefix = appConfig.redis.keyPrefixes.emailVerification;
  private readonly passwordResetPrefix = appConfig.redis.keyPrefixes.passwordReset;
  // * Precomputed argon2 hash to verify against on a login miss, so an unknown email costs the same time as a wrong
  // * password for a real one — no timing oracle for address enumeration.
  private dummyHash!: string;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly redisService: RedisService,
    private readonly mailProducer: MailProducer,
    private readonly clock: ClockService,
    private readonly passwordStrengthService: PasswordStrengthService,
    private readonly mfaService: MfaService,
    private readonly userRolesService: UserRolesService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('argon2-timing-dummy');
  }

  async register({
    email,
    password,
    userAgent,
  }: {
    email: string;
    password: string;
    userAgent?: string | null;
  }): Promise<ICredentialsResult> {
    this.passwordStrengthService.assertStrong({ password, userInputs: [email] });

    const passwordHash = await hash(password);
    const user = this.usersRepository.create({ id: generateUuid(), email, passwordHash, isAnonymous: false });

    try {
      await this.usersRepository.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
      ) {
        throw new AppConflictException({
          conflictedFields: ['email'],
          code: ExceptionCode.EmailAlreadyRegistered,
          message: 'Email is already registered.',
        });
      }

      throw error;
    }

    const tokens = await this.authService.issueSessionForUser({ userId: user.id, userAgent, linked: true });
    await this.sendVerificationMail({ user });

    return { user, ...tokens };
  }

  async login({
    email,
    password,
    userAgent,
    mfaCode,
  }: {
    email: string;
    password: string;
    userAgent?: string | null;
    mfaCode?: string;
  }): Promise<ICredentialsResult> {
    const user = await this.usersRepository.findOne({ where: { email } });

    // * Constant-time miss: verify against the dummy hash so a nonexistent/passwordless account is indistinguishable
    // * from a wrong password, then fail with the same generic error either way.
    if (!user || !user.passwordHash) {
      await verify(this.dummyHash, password);
      throw this.invalidCredentials();
    }

    if (!(await verify(user.passwordHash, password))) {
      throw this.invalidCredentials();
    }

    if (user.suspendedAt) {
      throw new AppForbiddenException({
        code: ExceptionCode.AccountSuspended,
        message: 'This account is suspended.',
      });
    }

    await this.enforceMfa({ userId: user.id, mfaCode });

    const tokens = await this.authService.issueSessionForUser({ userId: user.id, userAgent, linked: true });

    return { user, ...tokens };
  }

  // ! Runs only after the password has been proved, so an attacker cannot use the MFA responses to learn
  // ! whether an account exists or which accounts are administrative.
  private async enforceMfa({ userId, mfaCode }: { userId: string; mfaCode?: string }): Promise<void> {
    const hasRole = await this.userRolesService.hasAnyRole({ userId });
    const requirement = await this.mfaService.requirementFor({ userId, hasRole });

    if (!requirement.required) {
      return;
    }

    // ! An administrative account that never finished enrolment must not fall back to password-only: refuse
    // ! the login instead, and let an operator re-issue it with `admin:create`.
    if (!requirement.enrolled) {
      throw new AppForbiddenException({
        code: ExceptionCode.MfaEnrolmentRequired,
        message: 'This account requires multi-factor authentication to be enrolled before signing in.',
      });
    }

    if (!mfaCode) {
      throw new AppUnauthorizedException({
        code: ExceptionCode.MfaRequired,
        message: 'A multi-factor authentication code is required.',
      });
    }

    await this.mfaService.verify({ userId, code: mfaCode });
  }

  async verifyEmail({ token }: { token: string }): Promise<void> {
    const userId = await this.consumeToken({ prefix: this.emailVerificationPrefix, token });

    if (!userId) {
      throw new AppBadRequestException({
        code: ExceptionCode.InvalidVerificationToken,
        message: 'Verification link is invalid or has expired.',
      });
    }

    await this.usersRepository.update({ id: userId }, { emailVerifiedAt: this.clock.date() });
  }

  // * Enumeration-safe: always resolves. Only actually sends when there is an unverified account to send to.
  async resendVerification({ email }: { email: string }): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (user?.email && !user.emailVerifiedAt) {
      await this.sendVerificationMail({ user });
    }
  }

  // * Enumeration-safe: always resolves. Only sends when a password account with this email exists.
  async forgotPassword({ email }: { email: string }): Promise<void> {
    const user = await this.usersRepository.findOne({ where: { email } });

    if (user?.email && user.passwordHash) {
      const token = await this.issueToken({
        prefix: this.passwordResetPrefix,
        userId: user.id,
        bytes: PASSWORD_RESET_TOKEN_BYTES,
        ttlSeconds: env.PASSWORD_RESET_TTL_SECONDS,
      });

      this.sendMail({
        to: user.email,
        subject: 'Reset your password',
        template: 'password-reset',
        token,
        path: 'reset-password',
        ttlSeconds: env.PASSWORD_RESET_TTL_SECONDS,
      });
    }
  }

  async resetPassword({ token, password }: { token: string; password: string }): Promise<void> {
    // * Check strength before consuming the single-use token, so a weak password does not burn a valid reset link.
    this.passwordStrengthService.assertStrong({ password });

    const userId = await this.consumeToken({ prefix: this.passwordResetPrefix, token });

    if (!userId) {
      throw new AppBadRequestException({
        code: ExceptionCode.InvalidResetToken,
        message: 'Reset link is invalid or has expired.',
      });
    }

    const passwordHash = await hash(password);
    await this.usersRepository.update({ id: userId }, { passwordHash });
    // * A reset may be the response to a compromise: kill every existing session so a stolen refresh token cannot
    // * outlive the password it was issued under.
    await this.sessionService.revokeAllForUser({ userId });
  }

  private async sendVerificationMail({ user }: { user: User }): Promise<void> {
    if (!user.email) {
      return;
    }

    const token = await this.issueToken({
      prefix: this.emailVerificationPrefix,
      userId: user.id,
      bytes: EMAIL_VERIFICATION_TOKEN_BYTES,
      ttlSeconds: env.EMAIL_VERIFICATION_TTL_SECONDS,
    });

    this.sendMail({
      to: user.email,
      subject: 'Verify your email',
      template: 'email-verification',
      token,
      path: 'verify-email',
      ttlSeconds: env.EMAIL_VERIFICATION_TTL_SECONDS,
    });
  }

  // * Fire-and-forget enqueue: a failed queue push must not fail the request (the account already exists and the
  // * user can trigger a resend), so it is logged, not thrown. Actual delivery + retries happen in the mail worker.
  private sendMail({
    to,
    subject,
    template,
    token,
    path,
    ttlSeconds,
  }: {
    to: string;
    subject: string;
    template: string;
    token: string;
    path: string;
    ttlSeconds: number;
  }): void {
    const base = env.APP_URL;
    const context = {
      appName: appConfig.name,
      actionUrl: `${base}/${path}?token=${token}`,
      ttlHours: Math.round(ttlSeconds / 3600),
    };

    void this.mailProducer
      .send({ payload: { to, subject, template, context, securityCritical: true } })
      .catch((error: unknown) => this.logger.error(`Failed to enqueue "${template}" mail: ${String(error)}`));
  }

  private async issueToken({
    prefix,
    userId,
    bytes,
    ttlSeconds,
  }: {
    prefix: string;
    userId: string;
    bytes: number;
    ttlSeconds: number;
  }): Promise<string> {
    const token = randomBytes(bytes).toString('base64url');
    // * Store the SHA-256 of the token, never the raw token — mirrors the refresh-token at-rest doctrine, so a Redis
    // * read/backup leak yields only hashes, not usable links. No pepper: a 256-bit random token is already beyond
    // * brute force, so the hash alone (non-invertible, no rainbow table) suffices.
    await this.redisService.getClient().set(CacheKey.join(prefix, this.hashToken(token)), userId, 'EX', ttlSeconds);

    return token;
  }

  private async consumeToken({ prefix, token }: { prefix: string; token: string }): Promise<string | null> {
    return await this.redisService.getClient().getdel(CacheKey.join(prefix, this.hashToken(token)));
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private invalidCredentials(): AppUnauthorizedException {
    return new AppUnauthorizedException({
      code: ExceptionCode.InvalidCredentials,
      message: 'Invalid email or password.',
    });
  }
}
