import { createMock } from '@golevelup/ts-vitest';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';

import { SessionsRepository } from '../repositories/sessions.repository';
import { RevocationService } from './revocation.service';

describe('RevocationService (integration)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let service: RevocationService;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    service = new RevocationService(redisService, createMock<SessionsRepository>(), new ClockService());
  });

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('marks a session revoked and reports it via the denylist', async () => {
    await service.revokeSession({ sessionId: 'session-1' });

    await expect(service.isRevoked({ sessionId: 'session-1', familyId: 'family-1' })).resolves.toBe(true);
    await expect(service.isRevoked({ sessionId: 'session-2', familyId: 'family-2' })).resolves.toBe(false);
  });

  it('marks a whole family revoked via the family key', async () => {
    await service.revokeFamily({ familyId: 'family-1' });

    await expect(service.isRevoked({ sessionId: 'any-session', familyId: 'family-1' })).resolves.toBe(true);
  });

  it('expires denylist keys with the configured TTL', async () => {
    await service.revokeSession({ sessionId: 'session-1' });

    const ttl = await redis.ttl('app:revocation:sid:session-1');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(900);
  });
});
