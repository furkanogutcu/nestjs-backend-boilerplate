import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'crypto';
import { QueryFailedError } from 'typeorm';
import type { Mock, MockedFunction } from 'vitest';

import { ClockService } from '@infrastructure/clock/clock.service';
import { MailProducer } from '@infrastructure/mail/jobs/mail.producer';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';

import { User } from '../entities/user.entity';
import { MfaService } from '../mfa/services/mfa.service';
import { UserRolesService } from '../rbac/services/user-roles.service';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from '../services/auth.service';
import { SessionService } from '../services/session.service';
import { PasswordService } from './password.service';
import { PasswordStrengthService } from './password-strength.service';

vi.mock('@node-rs/argon2', () => ({ hash: vi.fn(), verify: vi.fn() }));

const mockedHash = hash as MockedFunction<typeof hash>;
const mockedVerify = verify as MockedFunction<typeof verify>;

describe('PasswordService', () => {
  let usersRepository: DeepMocked<UsersRepository>;
  let authService: DeepMocked<AuthService>;
  let sessionService: DeepMocked<SessionService>;
  let mailProducer: DeepMocked<MailProducer>;
  let clock: DeepMocked<ClockService>;
  let passwordStrengthService: DeepMocked<PasswordStrengthService>;
  let mfaService: DeepMocked<MfaService>;
  let userRolesService: DeepMocked<UserRolesService>;
  let redisClient: { set: Mock; getdel: Mock };
  let service: PasswordService;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockedHash.mockResolvedValue('argon2-hash');
    mockedVerify.mockResolvedValue(true);

    usersRepository = createMock<UsersRepository>();
    authService = createMock<AuthService>();
    sessionService = createMock<SessionService>();
    mailProducer = createMock<MailProducer>();
    clock = createMock<ClockService>();
    passwordStrengthService = createMock<PasswordStrengthService>();
    mfaService = createMock<MfaService>();
    userRolesService = createMock<UserRolesService>();
    userRolesService.hasAnyRole.mockResolvedValue(false);
    mfaService.requirementFor.mockResolvedValue({ enrolled: false, required: false });
    redisClient = { set: vi.fn().mockResolvedValue('OK'), getdel: vi.fn() };
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redisClient as never);

    authService.issueSessionForUser.mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 900,
    });
    mailProducer.send.mockResolvedValue(undefined);

    service = new PasswordService(
      usersRepository,
      authService,
      sessionService,
      redisService,
      mailProducer,
      clock,
      passwordStrengthService,
      mfaService,
      userRolesService,
    );
    await service.onModuleInit();
  });

  describe('register', () => {
    beforeEach(() => {
      (usersRepository.create as unknown as Mock).mockImplementation((dto: Partial<User>) => dto);
      (usersRepository.save as unknown as Mock).mockImplementation(async (u: User) => await Promise.resolve(u));
    });

    it('hashes the password, persists a non-anonymous user, issues a session, and sends a verification mail', async () => {
      const result = await service.register({ email: 'a@example.com', password: 'super-secret', userAgent: 'jest' });

      expect(mockedHash).toHaveBeenCalledWith('super-secret');
      expect(usersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'a@example.com', passwordHash: 'argon2-hash', isAnonymous: false }),
      );
      expect(authService.issueSessionForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userAgent: 'jest', linked: true }),
      );
      expect(redisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('email-verification'),
        expect.any(String),
        'EX',
        expect.any(Number),
      );
      expect(mailProducer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ template: 'email-verification', securityCritical: true }),
        }),
      );
      expect(result).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    });

    it('maps a unique-violation on email to a 409 conflict', async () => {
      (usersRepository.save as unknown as Mock).mockRejectedValue(
        new QueryFailedError('q', [], { code: '23505' } as never),
      );

      await expect(service.register({ email: 'a@example.com', password: 'super-secret' })).rejects.toBeInstanceOf(
        AppConflictException,
      );
      expect(authService.issueSessionForUser).not.toHaveBeenCalled();
    });

    it('rethrows a non-unique database error instead of masking it as a conflict', async () => {
      (usersRepository.save as unknown as Mock).mockRejectedValue(new Error('connection reset'));

      await expect(service.register({ email: 'a@example.com', password: 'super-secret' })).rejects.toThrow(
        'connection reset',
      );
    });

    it('rejects a weak password before hashing or persisting, feeding the email as a dictionary input', async () => {
      passwordStrengthService.assertStrong.mockImplementation(() => {
        throw new AppBadRequestException({ code: ExceptionCode.WeakPassword });
      });

      await expect(service.register({ email: 'a@example.com', password: 'password123' })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
      expect(passwordStrengthService.assertStrong).toHaveBeenCalledWith({
        password: 'password123',
        userInputs: ['a@example.com'],
      });
      expect(mockedHash).not.toHaveBeenCalledWith('password123');
      expect(usersRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    const adminUser = { id: 'u1', passwordHash: 'stored', isAnonymous: false } as User;

    it('refuses a suspended account even with the right password', async () => {
      usersRepository.findOne.mockResolvedValue({ ...adminUser, suspendedAt: new Date() });

      await expect(service.login({ email: 'a@example.com', password: 'super-secret' })).rejects.toMatchObject({
        code: ExceptionCode.AccountSuspended,
      });
      expect(authService.issueSessionForUser).not.toHaveBeenCalled();
    });

    it('demands a code when MFA is enrolled and none was supplied', async () => {
      usersRepository.findOne.mockResolvedValue(adminUser);
      mfaService.requirementFor.mockResolvedValue({ enrolled: true, required: true });

      await expect(service.login({ email: 'a@example.com', password: 'super-secret' })).rejects.toMatchObject({
        code: ExceptionCode.MfaRequired,
      });
      expect(authService.issueSessionForUser).not.toHaveBeenCalled();
    });

    it('verifies the supplied code and issues a session', async () => {
      usersRepository.findOne.mockResolvedValue(adminUser);
      mfaService.requirementFor.mockResolvedValue({ enrolled: true, required: true });

      await expect(
        service.login({ email: 'a@example.com', password: 'super-secret', mfaCode: '123456' }),
      ).resolves.toMatchObject({ accessToken: 'access' });
      expect(mfaService.verify).toHaveBeenCalledWith({ userId: 'u1', code: '123456' });
    });

    it('propagates an invalid code instead of issuing a session', async () => {
      usersRepository.findOne.mockResolvedValue(adminUser);
      mfaService.requirementFor.mockResolvedValue({ enrolled: true, required: true });
      mfaService.verify.mockRejectedValue(new Error('invalid'));

      await expect(
        service.login({ email: 'a@example.com', password: 'super-secret', mfaCode: '000000' }),
      ).rejects.toThrow('invalid');
      expect(authService.issueSessionForUser).not.toHaveBeenCalled();
    });

    it('refuses an administrative account that never finished enrolment', async () => {
      usersRepository.findOne.mockResolvedValue(adminUser);
      mfaService.requirementFor.mockResolvedValue({ enrolled: false, required: true });

      await expect(service.login({ email: 'a@example.com', password: 'super-secret' })).rejects.toMatchObject({
        code: ExceptionCode.MfaEnrolmentRequired,
      });
    });

    it('checks MFA only after the password is proved', async () => {
      usersRepository.findOne.mockResolvedValue(adminUser);
      mockedVerify.mockResolvedValue(false);

      await expect(service.login({ email: 'a@example.com', password: 'wrong' })).rejects.toMatchObject({
        code: ExceptionCode.InvalidCredentials,
      });
      expect(mfaService.requirementFor).not.toHaveBeenCalled();
    });

    it('issues a session when the password matches', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'stored', isAnonymous: false } as User);
      mockedVerify.mockResolvedValue(true);

      const result = await service.login({ email: 'a@example.com', password: 'super-secret' });

      expect(mockedVerify).toHaveBeenCalledWith('stored', 'super-secret');
      expect(authService.issueSessionForUser).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', linked: true }),
      );
      expect(result).toMatchObject({ accessToken: 'access' });
    });

    it('runs a dummy verify and fails generically when the email is unknown (no timing oracle)', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.login({ email: 'ghost@example.com', password: 'x'.repeat(8) })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
      expect(mockedVerify).toHaveBeenCalledWith('argon2-hash', 'x'.repeat(8));
      expect(authService.issueSessionForUser).not.toHaveBeenCalled();
    });

    it('rejects an account with no password (OAuth-only) generically', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', passwordHash: null, isAnonymous: false } as User);

      await expect(service.login({ email: 'a@example.com', password: 'super-secret' })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });

    it('rejects a wrong password generically', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'stored', isAnonymous: false } as User);
      mockedVerify.mockResolvedValue(false);

      await expect(service.login({ email: 'a@example.com', password: 'wrong-one' })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
      expect(authService.issueSessionForUser).not.toHaveBeenCalled();
    });

    it('never gates on password strength, so a pre-existing weak password still logs in', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', passwordHash: 'stored', isAnonymous: false } as User);
      mockedVerify.mockResolvedValue(true);

      await service.login({ email: 'a@example.com', password: 'weak' });

      expect(passwordStrengthService.assertStrong).not.toHaveBeenCalled();
      expect(authService.issueSessionForUser).toHaveBeenCalled();
    });
  });

  describe('verifyEmail', () => {
    it('consumes the token once and stamps emailVerifiedAt', async () => {
      const now = new Date('2026-06-20T10:00:00.000Z');
      clock.date.mockReturnValue(now);
      redisClient.getdel.mockResolvedValue('u1');

      await service.verifyEmail({ token: 'tok' });

      expect(redisClient.getdel).toHaveBeenCalledWith(expect.stringContaining('email-verification'));
      expect(usersRepository.update).toHaveBeenCalledWith({ id: 'u1' }, { emailVerifiedAt: now });
    });

    it('rejects an invalid or expired token', async () => {
      redisClient.getdel.mockResolvedValue(null);

      await expect(service.verifyEmail({ token: 'tok' })).rejects.toBeInstanceOf(AppBadRequestException);
      expect(usersRepository.update).not.toHaveBeenCalled();
    });

    it('looks up the SHA-256 of the token, never the raw token (Redis-leak resistant)', async () => {
      redisClient.getdel.mockResolvedValue('u1');

      await service.verifyEmail({ token: 'raw-token-value' });

      const key = redisClient.getdel.mock.calls[0][0] as string;
      expect(key).toContain(createHash('sha256').update('raw-token-value').digest('hex'));
      expect(key).not.toContain('raw-token-value');
    });
  });

  describe('resendVerification', () => {
    it('sends when the account exists and is unverified', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerifiedAt: null } as User);

      await service.resendVerification({ email: 'a@example.com' });

      expect(mailProducer.send).toHaveBeenCalled();
    });

    it('stays silent (no send, no throw) for an already-verified account', async () => {
      usersRepository.findOne.mockResolvedValue({
        id: 'u1',
        email: 'a@example.com',
        emailVerifiedAt: new Date(),
      } as User);

      await service.resendVerification({ email: 'a@example.com' });

      expect(mailProducer.send).not.toHaveBeenCalled();
    });

    it('stays silent for an unknown email (enumeration-safe)', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.resendVerification({ email: 'ghost@example.com' })).resolves.toBeUndefined();
      expect(mailProducer.send).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('sends a reset mail for a password account', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', email: 'a@example.com', passwordHash: 'stored' } as User);

      await service.forgotPassword({ email: 'a@example.com' });

      expect(redisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('password-reset'),
        'u1',
        'EX',
        expect.any(Number),
      );
      expect(mailProducer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ template: 'password-reset', securityCritical: true }),
        }),
      );
    });

    it('stays silent for an OAuth-only account with no password', async () => {
      usersRepository.findOne.mockResolvedValue({ id: 'u1', email: 'a@example.com', passwordHash: null } as User);

      await service.forgotPassword({ email: 'a@example.com' });

      expect(mailProducer.send).not.toHaveBeenCalled();
    });

    it('stays silent for an unknown email (enumeration-safe)', async () => {
      usersRepository.findOne.mockResolvedValue(null);

      await expect(service.forgotPassword({ email: 'ghost@example.com' })).resolves.toBeUndefined();
      expect(mailProducer.send).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('consumes the token, sets the new password, and revokes every session', async () => {
      redisClient.getdel.mockResolvedValue('u1');

      await service.resetPassword({ token: 'tok', password: 'new-super-secret' });

      expect(mockedHash).toHaveBeenCalledWith('new-super-secret');
      expect(usersRepository.update).toHaveBeenCalledWith({ id: 'u1' }, { passwordHash: 'argon2-hash' });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith({ userId: 'u1' });
    });

    it('rejects an invalid or expired token without touching the password', async () => {
      redisClient.getdel.mockResolvedValue(null);

      await expect(service.resetPassword({ token: 'tok', password: 'new-super-secret' })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
      expect(usersRepository.update).not.toHaveBeenCalled();
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects a weak password before consuming the single-use reset token', async () => {
      passwordStrengthService.assertStrong.mockImplementation(() => {
        throw new AppBadRequestException({ code: ExceptionCode.WeakPassword });
      });

      await expect(service.resetPassword({ token: 'tok', password: 'password123' })).rejects.toBeInstanceOf(
        AppBadRequestException,
      );
      expect(redisClient.getdel).not.toHaveBeenCalled();
      expect(mockedHash).not.toHaveBeenCalledWith('password123');
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
