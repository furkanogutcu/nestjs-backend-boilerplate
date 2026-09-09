import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';

import { Session } from '../entities/session.entity';
import { SessionsRepository } from '../repositories/sessions.repository';
import { RevocationService } from './revocation.service';

describe('RevocationService', () => {
  let redis: DeepMocked<Redis>;
  let sessionsRepository: DeepMocked<SessionsRepository>;
  let service: RevocationService;

  beforeEach(() => {
    redis = createMock<Redis>();
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    sessionsRepository = createMock<SessionsRepository>();
    service = new RevocationService(redisService, sessionsRepository, new ClockService());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes a session revocation key with the access-token TTL', async () => {
    await service.revokeSession({ sessionId: 'session-1' });

    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('sid:session-1'), '1', 'EX', 900);
  });

  it('writes a family revocation key with the access-token TTL', async () => {
    await service.revokeFamily({ familyId: 'family-1' });

    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('fid:family-1'), '1', 'EX', 900);
  });

  it('throws once the denylist write has exhausted its retries', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(service.revokeSession({ sessionId: 'session-1' })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(redis.set).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalled();
  });

  it('succeeds without throwing when a retry recovers the write', async () => {
    redis.set.mockRejectedValueOnce(new Error('redis blip')).mockResolvedValue('OK');

    await expect(service.revokeSession({ sessionId: 'session-1' })).resolves.toBeUndefined();
    expect(redis.set).toHaveBeenCalledTimes(2);
  });

  it('reports revoked when the denylist has a matching key', async () => {
    redis.exists.mockResolvedValue(1);

    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(true);
  });

  it('reports not revoked when the denylist has no matching key', async () => {
    redis.exists.mockResolvedValue(0);

    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(false);
  });

  it('falls back to the database when Redis is unavailable', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));

    sessionsRepository.findOne.mockResolvedValueOnce({ id: 'session-1', revokedAt: new Date() } as Session);
    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(true);

    sessionsRepository.findOne.mockResolvedValueOnce({ id: 'session-1', revokedAt: null } as Session);
    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(false);

    sessionsRepository.findOne.mockResolvedValueOnce(null);
    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(true);
  });

  it('opens the circuit after repeated database failures during fallback', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    redis.exists.mockRejectedValue(new Error('redis down'));
    sessionsRepository.findOne.mockRejectedValue(new Error('db down'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).rejects.toBeInstanceOf(
        AppServiceUnavailableException,
      );
    }
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(5);
    expect(errorLog).toHaveBeenCalledTimes(5);

    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(5);
  });

  it('closes the circuit again once the cooldown elapses and the database recovers', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    redis.exists.mockRejectedValue(new Error('redis down'));
    sessionsRepository.findOne.mockRejectedValue(new Error('db down'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).rejects.toBeInstanceOf(
        AppServiceUnavailableException,
      );
    }

    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(5);

    vi.advanceTimersByTime(5001);
    sessionsRepository.findOne.mockResolvedValue({ id: 'session-1', revokedAt: null } as Session);
    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(false);
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(6);
  });
});
