import { createMock } from '@golevelup/ts-jest';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

import { RedisService } from '../redis/redis.service';
import { SensitiveService } from '../sensitive/sensitive.service';
import { CacheService } from './cache.service';

describe('CacheService (integration)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let service: CacheService;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    service = new CacheService(new SensitiveService(), redisService);
  });

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('round-trips a JSON value', async () => {
    await service.set({ key: 'orders:1', data: { id: 1, name: 'wheat' } });

    await expect(service.get({ key: 'orders:1' })).resolves.toEqual({ id: 1, name: 'wheat' });
  });

  it('applies a TTL via setex', async () => {
    await service.set({ key: 'temp', data: { x: 1 }, ttl: 100 });

    expect(await redis.ttl('app:cache:temp')).toBeGreaterThan(0);
  });

  it('persists without a TTL when ttl is null', async () => {
    await service.set({ key: 'persistent', data: { x: 1 }, ttl: null });

    expect(await redis.ttl('app:cache:persistent')).toBe(-1);
  });

  it('encrypts and decrypts a round-trip', async () => {
    await service.set({ key: 'secret', data: { token: 'abc' }, encrypt: true });

    await expect(service.get({ key: 'secret', decrypt: true })).resolves.toEqual({ token: 'abc' });
  });
});
