import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import * as OTPAuth from 'otpauth';
import { Repository } from 'typeorm';

import { appConfig } from '@config/app.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { AppUnprocessableEntityException } from '@shared/exceptions/unprocessable-entity.exception';

import { User } from '../../entities/user.entity';
import { MfaCredential } from '../entities/mfa-credential.entity';
import {
  RECOVERY_CODE_BYTES,
  RECOVERY_CODE_COUNT,
  TOTP_ALGORITHM,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_WINDOW,
} from '../mfa.constant';

export interface IMfaEnrolment {
  secret: string;
  otpauthUri: string;
}

export interface IMfaRequirement {
  enrolled: boolean;
  required: boolean;
}

@Injectable()
export class MfaService {
  constructor(
    @InjectRepository(MfaCredential) private readonly credentials: Repository<MfaCredential>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly clock: ClockService,
  ) {}

  async beginEnrolment({ userId }: { userId: string }): Promise<IMfaEnrolment> {
    const existing = await this.credentials.findOne({ where: { userId } });

    if (existing?.confirmedAt) {
      throw new AppConflictException({
        conflictedFields: ['mfa'],
        code: ExceptionCode.MfaAlreadyEnrolled,
        message: 'Multi-factor authentication is already enabled for this account.',
      });
    }

    const secret = new OTPAuth.Secret({ size: TOTP_SECRET_BYTES }).base32;

    await this.credentials.upsert({ userId, secret, confirmedAt: null, recoveryCodeHashes: [], lastUsedAt: null }, [
      'userId',
    ]);

    return { secret, otpauthUri: this.buildUri({ secret, accountLabel: await this.accountLabel(userId) }) };
  }

  // ! The only moment the plaintext recovery codes exist; they are stored hashed.
  async confirmEnrolment({ userId, code }: { userId: string; code: string }): Promise<{ recoveryCodes: string[] }> {
    const credential = await this.requireCredential(userId);

    if (credential.confirmedAt) {
      throw new AppConflictException({
        conflictedFields: ['mfa'],
        code: ExceptionCode.MfaAlreadyEnrolled,
        message: 'Multi-factor authentication is already enabled for this account.',
      });
    }

    if (!this.isValidTotp({ secret: credential.secret, code })) {
      throw this.invalidCode();
    }

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.generateRecoveryCode());

    await this.credentials.update(
      { userId },
      {
        confirmedAt: this.clock.date(),
        recoveryCodeHashes: recoveryCodes.map((recoveryCode) => this.hash(recoveryCode)),
      },
    );

    return { recoveryCodes };
  }

  // ! MFA is active from creation: an administrative account must never exist in a password-only state.
  async provisionConfirmed({ userId }: { userId: string }): Promise<IMfaEnrolment & { recoveryCodes: string[] }> {
    const secret = this.generateSecret();
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () => this.generateRecoveryCode());

    await this.credentials.upsert(
      {
        userId,
        secret,
        confirmedAt: this.clock.date(),
        recoveryCodeHashes: recoveryCodes.map((recoveryCode) => this.hash(recoveryCode)),
        lastUsedAt: null,
      },
      ['userId'],
    );

    return {
      secret,
      otpauthUri: this.buildUri({ secret, accountLabel: await this.accountLabel(userId) }),
      recoveryCodes,
    };
  }

  async requirementFor({ userId, hasRole }: { userId: string; hasRole: boolean }): Promise<IMfaRequirement> {
    const credential = await this.credentials.findOne({
      where: { userId },
      select: { userId: true, confirmedAt: true },
    });
    const enrolled = credential?.confirmedAt != null;

    // ! Any role at all makes MFA mandatory: roles exist only to grant administrative permissions.
    return { enrolled, required: enrolled || hasRole };
  }

  async verify({ userId, code }: { userId: string; code: string }): Promise<void> {
    const credential = await this.requireCredential(userId);

    if (!credential.confirmedAt) {
      throw this.invalidCode();
    }

    if (this.isValidTotp({ secret: credential.secret, code })) {
      await this.credentials.update({ userId }, { lastUsedAt: this.clock.date() });

      return;
    }

    const remaining = this.consumeRecoveryCode({ hashes: credential.recoveryCodeHashes, code });

    if (!remaining) {
      throw this.invalidCode();
    }

    await this.credentials.update({ userId }, { recoveryCodeHashes: remaining, lastUsedAt: this.clock.date() });
  }

  async disable({ userId }: { userId: string }): Promise<void> {
    const result = await this.credentials.delete({ userId });

    if ((result.affected ?? 0) === 0) {
      throw new AppUnprocessableEntityException({
        code: ExceptionCode.MfaNotEnrolled,
        message: 'Multi-factor authentication is not enabled for this account.',
      });
    }
  }

  buildUri({ secret, accountLabel }: { secret: string; accountLabel: string }): string {
    return new OTPAuth.TOTP({
      issuer: appConfig.name,
      label: accountLabel,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secret),
    }).toString();
  }

  generateSecret(): string {
    return new OTPAuth.Secret({ size: TOTP_SECRET_BYTES }).base32;
  }

  generateRecoveryCode(): string {
    return randomBytes(RECOVERY_CODE_BYTES).toString('hex');
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private isValidTotp({ secret, code }: { secret: string; code: string }): boolean {
    const totp = new OTPAuth.TOTP({
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD_SECONDS,
      secret: OTPAuth.Secret.fromBase32(secret),
    });

    return totp.validate({ token: code.trim(), window: TOTP_WINDOW, timestamp: this.clock.epochMillis() }) !== null;
  }

  private consumeRecoveryCode({ hashes, code }: { hashes: string[]; code: string }): string[] | null {
    const candidate = Buffer.from(this.hash(code.trim()), 'hex');

    // ! No early exit once matched: the response time would reveal the position of the presented code.
    const matches = hashes.map((stored) => {
      const storedBuffer = Buffer.from(stored, 'hex');

      return storedBuffer.length === candidate.length && timingSafeEqual(storedBuffer, candidate);
    });
    const matchedIndex = matches.indexOf(true);

    return matchedIndex === -1 ? null : hashes.toSpliced(matchedIndex, 1);
  }

  private async accountLabel(userId: string): Promise<string> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, email: true } });

    return user?.email ?? userId;
  }

  private async requireCredential(userId: string): Promise<MfaCredential> {
    const credential = await this.credentials.findOne({ where: { userId } });

    if (!credential) {
      throw new AppUnprocessableEntityException({
        code: ExceptionCode.MfaNotEnrolled,
        message: 'Multi-factor authentication is not enabled for this account.',
      });
    }

    return credential;
  }

  private invalidCode(): AppUnauthorizedException {
    return new AppUnauthorizedException({
      code: ExceptionCode.InvalidMfaCode,
      message: 'Invalid multi-factor authentication code.',
    });
  }
}
