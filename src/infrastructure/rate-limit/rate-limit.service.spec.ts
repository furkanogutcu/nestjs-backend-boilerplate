import { createMock } from '@golevelup/ts-jest';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { IRateLimitOptions, RateLimitContext } from '@shared/interfaces/rate-limit-rule.interface';

import { RedisService } from '../redis/redis.service';
import { RateLimitService } from './rate-limit.service';

jest.mock('rate-limiter-flexible', () => {
  const actual = jest.requireActual('rate-limiter-flexible');

  return { ...actual, RateLimiterRedis: jest.fn() };
});

function buildOptions(options: Partial<IRateLimitOptions> = {}): IRateLimitOptions {
  return { points: 100, duration: 60, ...options };
}

const context: RateLimitContext = {
  request: { ip_address: '1.2.3.4', path: '/orders', method: 'GET' },
};

describe('RateLimitService', () => {
  let service: RateLimitService;
  let consume: jest.Mock;

  beforeEach(() => {
    consume = jest.fn().mockResolvedValue(createMock<RateLimiterRes>());
    jest.mocked(RateLimiterRedis).mockImplementation(() => ({ consume }) as unknown as RateLimiterRedis);

    const redisService = createMock<RedisService>();
    service = new RateLimitService(redisService);
  });

  it('keys on the user id and endpoint when authenticated', async () => {
    await service.consume({
      options: buildOptions(),
      rateLimitContext: { request: { ...context.request, user_id: 'user-1' } },
    });

    expect(consume).toHaveBeenCalledWith('user-1:/orders:GET');
  });

  it('falls back to the ip address and endpoint when anonymous', async () => {
    await service.consume({ options: buildOptions(), rateLimitContext: context });

    expect(consume).toHaveBeenCalledWith('1.2.3.4:/orders:GET');
  });

  it('returns the limiter result', async () => {
    const result = createMock<RateLimiterRes>();
    consume.mockResolvedValue(result);

    await expect(service.consume({ options: buildOptions(), rateLimitContext: context })).resolves.toBe(result);
  });

  it('reuses a cached limiter for identical options', async () => {
    await service.consume({ options: buildOptions(), rateLimitContext: context });
    await service.consume({ options: buildOptions(), rateLimitContext: context });

    expect(RateLimiterRedis).toHaveBeenCalledTimes(1);
  });

  it('creates a separate limiter when options differ', async () => {
    await service.consume({ options: buildOptions({ points: 100 }), rateLimitContext: context });
    await service.consume({ options: buildOptions({ points: 10 }), rateLimitContext: context });

    expect(RateLimiterRedis).toHaveBeenCalledTimes(2);
  });
});
