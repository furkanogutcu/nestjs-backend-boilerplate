import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';

import { ClockService } from '@infrastructure/clock/clock.service';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { createMockDataSource, createMockEntityManager } from '@test/helpers';

import { Session } from '../entities/session.entity';
import { SessionsRepository } from '../repositories/sessions.repository';
import { RevocationService } from './revocation.service';
import { SessionService } from './session.service';

const SESSION_ID = '0190d5e0-1111-7222-8333-444444444444';

function hash(secret: string): string {
  return createHash('sha256').update(`${secret}${process.env.REFRESH_TOKEN_PEPPER}`).digest('hex');
}

function buildSession(overrides: Partial<Session>): Session {
  return {
    id: SESSION_ID,
    userId: 'user-1',
    familyId: 'family-1',
    tokenHash: hash('correct-secret'),
    revokedAt: null,
    rotatedToId: null,
    expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    chainExpiresAt: null,
    userAgent: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Session;
}

describe('SessionService', () => {
  let sessionsRepository: DeepMocked<SessionsRepository>;
  let revocationService: DeepMocked<RevocationService>;
  let manager: DeepMocked<EntityManager>;
  let service: SessionService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    sessionsRepository = createMock<SessionsRepository>();
    sessionsRepository.create.mockImplementation((session) => session as Session);
    sessionsRepository.save.mockImplementation(async (session) => await Promise.resolve(session as Session));
    sessionsRepository.find.mockResolvedValue([]);
    revocationService = createMock<RevocationService>();
    manager = createMockEntityManager();
    (manager.create as unknown as jest.Mock).mockImplementation((...args: unknown[]) => args[1]);
    (manager.save as unknown as jest.Mock).mockImplementation(async (entity: unknown) => await Promise.resolve(entity));
    (manager.update as unknown as jest.Mock).mockResolvedValue({ affected: 1 });
    service = new SessionService(
      sessionsRepository,
      createMockDataSource(manager),
      revocationService,
      new ClockService(),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issue', () => {
    it('issues a session whose first token starts a new family and expires in the configured window', async () => {
      const { session, refreshToken } = await service.issue({ userId: 'user-1', userAgent: 'jest', linked: false });
      const [sessionId] = refreshToken.split('.');

      expect(sessionId).toBe(session.id);
      expect(session.familyId).toBe(session.id);
      expect(session.userId).toBe('user-1');
      expect(session.userAgent).toBe('jest');
      expect(session.expiresAt.getTime()).toBe(new Date('2026-01-01T00:00:00.000Z').getTime() + 2592000 * 1000);
    });

    it('leaves a guest session capless (no absolute chain deadline)', async () => {
      const { session } = await service.issue({ userId: 'user-1', linked: false });

      expect(session.chainExpiresAt).toBeNull();
    });

    it('anchors an absolute hard cap for a linked session while the idle window still drives expiry', async () => {
      const now = new Date('2026-01-01T00:00:00.000Z').getTime();
      const { session } = await service.issue({ userId: 'user-1', linked: true });

      expect(session.chainExpiresAt?.getTime()).toBe(now + 7776000 * 1000);
      // * Idle window (30d) is shorter than the cap (90d), so it still governs the first expiry.
      expect(session.expiresAt.getTime()).toBe(now + 2592000 * 1000);
    });

    it('stores only a peppered hash of the secret, never the raw secret', async () => {
      const { session, refreshToken } = await service.issue({ userId: 'user-1', linked: false });
      const secret = refreshToken.split('.')[1];

      expect(session.tokenHash).toBe(hash(secret));
      expect(session.tokenHash).not.toContain(secret);
    });

    it('evicts the least-recently-active family when issuing past the active-family cap', async () => {
      const families: Session[] = [];
      for (let index = 0; index < 11; index += 1) {
        families.push(buildSession({ familyId: `family-${index}`, createdAt: new Date(2026, 0, 1, 0, index) }));
      }
      sessionsRepository.find.mockResolvedValue(families);

      await service.issue({ userId: 'user-1', linked: false });

      expect(revocationService.revokeFamily).toHaveBeenCalledTimes(1);
      expect(revocationService.revokeFamily).toHaveBeenCalledWith({ familyId: 'family-0' });
      expect(sessionsRepository.update).toHaveBeenCalledWith(
        { familyId: 'family-0', revokedAt: expect.anything() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });

    it('does not evict any family when under the cap', async () => {
      sessionsRepository.find.mockResolvedValue([buildSession({})]);

      await service.issue({ userId: 'user-1', linked: false });

      expect(revocationService.revokeFamily).not.toHaveBeenCalled();
    });
  });

  describe('rotate', () => {
    it('rotates: issues a successor in the same family and revokes the presented session', async () => {
      manager.findOne.mockResolvedValue(buildSession({}));

      const { session, refreshToken } = await service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` });

      expect(session.familyId).toBe('family-1');
      expect(refreshToken.startsWith(`${session.id}.`)).toBe(true);
      expect(manager.update).toHaveBeenCalledWith(
        Session,
        { id: SESSION_ID },
        expect.objectContaining({ revokedAt: expect.any(Date), rotatedToId: session.id }),
      );
      expect(revocationService.revokeSession).toHaveBeenCalledWith({ sessionId: SESSION_ID });
    });

    it('carries the hard-cap deadline to the successor and clamps the idle window to it when nearer', async () => {
      const cap = new Date('2026-01-10T00:00:00.000Z'); // * 9 days out, inside the 30d idle window
      manager.findOne.mockResolvedValue(buildSession({ chainExpiresAt: cap }));

      const { session } = await service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` });

      expect(session.chainExpiresAt?.getTime()).toBe(cap.getTime());
      expect(session.expiresAt.getTime()).toBe(cap.getTime());
    });

    it('carries the hard-cap deadline but keeps the idle window when the cap is further out', async () => {
      const cap = new Date('2026-04-01T00:00:00.000Z'); // * beyond the 30d idle window
      manager.findOne.mockResolvedValue(buildSession({ chainExpiresAt: cap }));

      const { session } = await service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` });

      expect(session.chainExpiresAt?.getTime()).toBe(cap.getTime());
      expect(session.expiresAt.getTime()).toBe(new Date('2026-01-01T00:00:00.000Z').getTime() + 2592000 * 1000);
    });

    it('detects reuse of an already-revoked token and revokes the whole family', async () => {
      manager.findOne.mockResolvedValue(buildSession({ revokedAt: new Date('2026-01-01T00:00:00.000Z') }));

      await expect(service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toMatchObject({
        code: ExceptionCode.RefreshTokenReuseDetected,
      });
      expect(sessionsRepository.update).toHaveBeenCalledWith(
        { familyId: 'family-1', revokedAt: expect.anything() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(revocationService.revokeFamily).toHaveBeenCalledWith({ familyId: 'family-1' });
    });

    it('rejects a wrong secret as an invalid refresh token', async () => {
      manager.findOne.mockResolvedValue(buildSession({}));

      await expect(service.rotate({ refreshToken: `${SESSION_ID}.wrong-secret` })).rejects.toMatchObject({
        code: ExceptionCode.InvalidRefreshToken,
      });
    });

    it('rejects an unknown session as an invalid refresh token', async () => {
      manager.findOne.mockResolvedValue(null);

      await expect(service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });

    it('rejects an expired session as an invalid refresh token', async () => {
      manager.findOne.mockResolvedValue(buildSession({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }));

      await expect(service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toMatchObject({
        code: ExceptionCode.InvalidRefreshToken,
      });
    });

    it('rejects a session expiring exactly now (the expiry boundary is inclusive)', async () => {
      manager.findOne.mockResolvedValue(buildSession({ expiresAt: new Date('2026-01-01T00:00:00.000Z') }));

      await expect(service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toMatchObject({
        code: ExceptionCode.InvalidRefreshToken,
      });
    });

    it('rejects a malformed refresh token', async () => {
      await expect(service.rotate({ refreshToken: 'not-a-refresh-token' })).rejects.toMatchObject({
        code: ExceptionCode.InvalidRefreshToken,
      });
    });

    it('rejects a non-uuid session id without querying the uuid-typed column', async () => {
      await expect(service.rotate({ refreshToken: 'v1.some-secret' })).rejects.toMatchObject({
        code: ExceptionCode.InvalidRefreshToken,
      });
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('treats a stored hash of the wrong length as a non-match instead of crashing timingSafeEqual', async () => {
      manager.findOne.mockResolvedValue(buildSession({ tokenHash: 'deadbeef' }));

      await expect(service.rotate({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toMatchObject({
        code: ExceptionCode.InvalidRefreshToken,
      });
    });
  });

  describe('revoke', () => {
    it('revokes the given session and writes its denylist key', async () => {
      await service.revoke({ sessionId: 'session-1' });

      expect(sessionsRepository.update).toHaveBeenCalledWith(
        { id: 'session-1', revokedAt: expect.anything() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(revocationService.revokeSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    });
  });

  describe('verifyForStepUp', () => {
    it('returns the user and session for a valid refresh token without rotating it', async () => {
      sessionsRepository.findOne.mockResolvedValue(buildSession({}));

      await expect(service.verifyForStepUp({ refreshToken: `${SESSION_ID}.correct-secret` })).resolves.toEqual({
        userId: 'user-1',
        sessionId: SESSION_ID,
      });
      expect(sessionsRepository.update).not.toHaveBeenCalled();
    });

    it('rejects a wrong secret', async () => {
      sessionsRepository.findOne.mockResolvedValue(buildSession({}));

      await expect(service.verifyForStepUp({ refreshToken: `${SESSION_ID}.wrong-secret` })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });

    it('treats a revoked session as reuse: revokes the whole family and raises the reuse code', async () => {
      sessionsRepository.findOne.mockResolvedValue(buildSession({ revokedAt: new Date('2026-01-01T00:00:00.000Z') }));

      await expect(service.verifyForStepUp({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toMatchObject({
        code: ExceptionCode.RefreshTokenReuseDetected,
      });
      expect(sessionsRepository.update).toHaveBeenCalledWith(
        { familyId: 'family-1', revokedAt: expect.anything() },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      expect(revocationService.revokeFamily).toHaveBeenCalledWith({ familyId: 'family-1' });
    });

    it('rejects a session that has expired even though it was never revoked', async () => {
      sessionsRepository.findOne.mockResolvedValue(buildSession({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }));

      await expect(service.verifyForStepUp({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });

    it('rejects an unknown session', async () => {
      sessionsRepository.findOne.mockResolvedValue(null);

      await expect(service.verifyForStepUp({ refreshToken: `${SESSION_ID}.correct-secret` })).rejects.toBeInstanceOf(
        AppUnauthorizedException,
      );
    });
  });

  describe('revokeAllForUser', () => {
    it('revokes each distinct family of the user (DB + denylist), collapsing duplicates', async () => {
      sessionsRepository.find.mockResolvedValue([
        buildSession({ familyId: 'family-1' }),
        buildSession({ familyId: 'family-1' }),
        buildSession({ familyId: 'family-2' }),
      ]);

      await service.revokeAllForUser({ userId: 'user-1' });

      expect(sessionsRepository.update).toHaveBeenCalledTimes(2);
      expect(revocationService.revokeFamily).toHaveBeenCalledWith({ familyId: 'family-1' });
      expect(revocationService.revokeFamily).toHaveBeenCalledWith({ familyId: 'family-2' });
      expect(revocationService.revokeFamily).toHaveBeenCalledTimes(2);
    });

    it('is a no-op when the user has no active sessions', async () => {
      sessionsRepository.find.mockResolvedValue([]);

      await service.revokeAllForUser({ userId: 'user-1' });

      expect(manager.update).not.toHaveBeenCalled();
      expect(revocationService.revokeFamily).not.toHaveBeenCalled();
    });
  });
});
