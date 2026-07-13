import { createMock, DeepMocked } from '@golevelup/ts-jest';
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
    jest.useRealTimers();
  });

  it('writes a session revocation key with the access-token TTL', async () => {
    await service.revokeSession({ sessionId: 'session-1' });

    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('sid:session-1'), '1', 'EX', 900);
  });

  it('writes a family revocation key with the access-token TTL', async () => {
    await service.revokeFamily({ familyId: 'family-1' });

    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('fid:family-1'), '1', 'EX', 900);
  });

  it('swallows a Redis write failure so revocation stays best-effort', async () => {
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(service.revokeSession({ sessionId: 'session-1' })).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });

  it('writes the same denylist key on the durable reconcile path', async () => {
    await service.reconcileSession({ sessionId: 'session-1' });
    await service.reconcileFamily({ familyId: 'family-1' });

    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('sid:session-1'), '1', 'EX', 900);
    expect(redis.set).toHaveBeenCalledWith(expect.stringContaining('fid:family-1'), '1', 'EX', 900);
  });

  it('rethrows a Redis failure on the reconcile path (so the consumer redelivers), unlike the best-effort path', async () => {
    redis.set.mockRejectedValue(new Error('redis down'));

    await expect(service.reconcileSession({ sessionId: 'session-1' })).rejects.toThrow('redis down');
    await expect(service.reconcileFamily({ familyId: 'family-1' })).rejects.toThrow('redis down');
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
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
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
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    redis.exists.mockRejectedValue(new Error('redis down'));
    sessionsRepository.findOne.mockRejectedValue(new Error('db down'));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).rejects.toBeInstanceOf(
        AppServiceUnavailableException,
      );
    }

    // * Within the cooldown the open circuit short-circuits without touching the database.
    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(5);

    // * After the cooldown the database is queried again, and a success resets the breaker.
    jest.advanceTimersByTime(5001);
    sessionsRepository.findOne.mockResolvedValue({ id: 'session-1', revokedAt: null } as Session);
    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(false);
    expect(sessionsRepository.findOne).toHaveBeenCalledTimes(6);
  });
});
