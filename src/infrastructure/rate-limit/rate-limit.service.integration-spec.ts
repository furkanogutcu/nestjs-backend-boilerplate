import { createMock } from '@golevelup/ts-jest';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';
import { RateLimiterRes } from 'rate-limiter-flexible';

import { IRateLimitOptions, RateLimitContext } from '@shared/interfaces/rate-limit-rule.interface';

import { RedisService } from '../redis/redis.service';
import { RateLimitService } from './rate-limit.service';

describe('RateLimitService (integration)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let redisService: ReturnType<typeof createMock<RedisService>>;
  let service: RateLimitService;

  const options: IRateLimitOptions = { points: 2, duration: 60 };
  const context: RateLimitContext = { request: { ip_address: '1.2.3.4', path: '/orders', method: 'GET' } };

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());
    redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
  });

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  beforeEach(async () => {
    await redis.flushall();
    // * Fresh service per test so a limiter's in-memory block (rate-limiter-flexible) never bleeds across tests.
    service = new RateLimitService(redisService);
  });

  it('allows requests up to the configured point limit, then rejects', async () => {
    const first = await service.consume({ options, rateLimitContext: context });
    const second = await service.consume({ options, rateLimitContext: context });

    expect(first.consumedPoints).toBe(1);
    expect(second.consumedPoints).toBe(2);

    await expect(service.consume({ options, rateLimitContext: context })).rejects.toBeInstanceOf(RateLimiterRes);
  });

  it('enforces the point limit atomically under concurrent consumes (no double-spend)', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, async () => await service.consume({ options, rateLimitContext: context })),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');

    expect(fulfilled).toHaveLength(options.points);
    expect(rejected).toHaveLength(5 - options.points);
    expect(rejected.every((result) => result.reason instanceof RateLimiterRes)).toBe(true);
  });

  it('tracks each endpoint independently for the same subject', async () => {
    await service.consume({ options, rateLimitContext: context });
    const other = await service.consume({
      options,
      rateLimitContext: { request: { ip_address: '1.2.3.4', path: '/other', method: 'GET' } },
    });

    expect(other.consumedPoints).toBe(1);
  });

  it('keys authenticated requests per user and isolates different policies on the same user', async () => {
    const userContext: RateLimitContext = { request: { ...context.request, user_id: 'user-1' } };

    await service.consume({ options, rateLimitContext: userContext });
    const second = await service.consume({ options, rateLimitContext: userContext });
    expect(second.consumedPoints).toBe(2);

    const otherPolicy = await service.consume({ options: { points: 5, duration: 60 }, rateLimitContext: userContext });
    expect(otherPolicy.consumedPoints).toBe(1);
  });

  it('rejects instead of falling back to memory when Redis is unavailable', async () => {
    const downRedis = new Redis(container.getConnectionUrl(), { enableOfflineQueue: false });
    downRedis.on('error', () => undefined);
    downRedis.disconnect();

    const downRedisService = createMock<RedisService>();
    downRedisService.getClient.mockReturnValue(downRedis);
    const downService = new RateLimitService(downRedisService);

    await expect(downService.consume({ options, rateLimitContext: context })).rejects.toBeDefined();

    downRedis.disconnect();
  });

  describe('consumeByKey', () => {
    const key = '1.2.3.4';

    it('allows up to the point limit for a bare key, then rejects', async () => {
      const first = await service.consumeByKey({ options, key });
      const second = await service.consumeByKey({ options, key });

      expect(first.consumedPoints).toBe(1);
      expect(second.consumedPoints).toBe(2);

      await expect(service.consumeByKey({ options, key })).rejects.toBeInstanceOf(RateLimiterRes);
    });

    it('tracks distinct keys independently', async () => {
      await service.consumeByKey({ options, key });
      const other = await service.consumeByKey({ options, key: '5.6.7.8' });

      expect(other.consumedPoints).toBe(1);
    });

    it('keeps a separate counter for the same key under a different option tuple', async () => {
      await service.consumeByKey({ options, key });
      await service.consumeByKey({ options, key });

      const other = await service.consumeByKey({ options: { points: 5, duration: 60 }, key });

      expect(other.consumedPoints).toBe(1);
    });
  });
});
