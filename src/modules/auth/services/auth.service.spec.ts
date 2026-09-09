import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { createHash } from 'crypto';
import type { Mock } from 'vitest';

import { IDEMPOTENCY_LOCK_TTL_SECONDS } from '@infrastructure/idempotency/idempotency.constant';
import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';

import { IDEMPOTENCY_REFRESH_TTL_SECONDS } from '../constants/auth.constant';
import { Session } from '../entities/session.entity';
import { User } from '../entities/user.entity';
import { UsersRepository } from '../repositories/users.repository';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

describe('AuthService', () => {
  let sessionService: DeepMocked<SessionService>;
  let tokenService: DeepMocked<TokenService>;
  let idempotencyService: DeepMocked<IdempotencyService>;
  let usersRepository: DeepMocked<UsersRepository>;
  let service: AuthService;

  beforeEach(() => {
    sessionService = createMock<SessionService>();
    tokenService = createMock<TokenService>();
    idempotencyService = createMock<IdempotencyService>();
    usersRepository = createMock<UsersRepository>();
    service = new AuthService(sessionService, tokenService, idempotencyService, usersRepository);

    tokenService.signAccessToken.mockResolvedValue({ token: 'access', expiresInSeconds: 900 });
  });

  describe('createGuest', () => {
    beforeEach(() => {
      (usersRepository.create as unknown as Mock).mockImplementation((dto: Partial<User>) => dto);
      (usersRepository.save as unknown as Mock).mockImplementation(
        async (entity: User) => await Promise.resolve(entity),
      );
      sessionService.issue.mockResolvedValue({
        session: { id: 's1', familyId: 'f1' } as Session,
        refreshToken: 'guest-rt',
      });
    });

    it('persists an anonymous user, then issues a session for it', async () => {
      const result = await service.createGuest({ userAgent: 'jest' });

      const userId = (usersRepository.create as unknown as Mock).mock.calls[0][0].id as string;
      expect(userId).toEqual(expect.any(String));
      expect(usersRepository.create).toHaveBeenCalledWith({ id: userId, isAnonymous: true });
      expect(sessionService.issue).toHaveBeenCalledWith({ userId, userAgent: 'jest', linked: false });
      expect(tokenService.signAccessToken).toHaveBeenCalledWith({ userId, sessionId: 's1', familyId: 'f1' });
      expect(idempotencyService.execute).not.toHaveBeenCalled();
      expect(result).toEqual({
        user: { id: userId, isAnonymous: true },
        accessToken: 'access',
        refreshToken: 'guest-rt',
        expiresInSeconds: 900,
      });
    });

    it('creates a guest with no user agent when called without arguments', async () => {
      await service.createGuest();

      expect(sessionService.issue).toHaveBeenCalledWith({
        userId: expect.any(String),
        userAgent: undefined,
        linked: false,
      });
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      sessionService.rotate.mockResolvedValue({
        session: { id: 's1', familyId: 'f1', userId: 'p1' } as Session,
        refreshToken: 'new-rt',
      });
    });

    it('rotates directly when no idempotency key is supplied', async () => {
      const result = await service.refresh({ refreshToken: 'session-1.secret' });

      expect(result).toEqual({ accessToken: 'access', refreshToken: 'new-rt', expiresInSeconds: 900 });
      expect(tokenService.signAccessToken).toHaveBeenCalledWith({ userId: 'p1', sessionId: 's1', familyId: 'f1' });
      expect(idempotencyService.execute).not.toHaveBeenCalled();
      expect(sessionService.rotate).toHaveBeenCalledTimes(1);
    });

    it('wraps the rotation in a session-scoped idempotent execution', async () => {
      idempotencyService.execute.mockImplementation(async (options) => await options.compute());
      const refreshToken = 'session-1.secret';

      const result = await service.refresh({ refreshToken, idempotencyKey: 'k'.repeat(16) });

      expect(idempotencyService.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'auth:refresh',
          principal: 'session-1',
          key: 'k'.repeat(16),
          fingerprint: createHash('sha256').update(refreshToken).digest('hex'),
          lockTtlSeconds: IDEMPOTENCY_LOCK_TTL_SECONDS,
          responseTtlSeconds: IDEMPOTENCY_REFRESH_TTL_SECONDS,
        }),
      );
      expect(result).toEqual({ accessToken: 'access', refreshToken: 'new-rt', expiresInSeconds: 900 });
    });
  });

  describe('logout', () => {
    it('revokes the session behind the access token', async () => {
      await service.logout({ sessionId: 's1' });

      expect(sessionService.revoke).toHaveBeenCalledWith({ sessionId: 's1' });
    });
  });
});
