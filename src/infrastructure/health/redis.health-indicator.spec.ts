import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import type { Mock } from 'vitest';

import { createMockRedis } from '@test/helpers';

import { RedisService } from '../redis/redis.service';
import { RedisHealthIndicator } from './redis.health-indicator';

describe('RedisHealthIndicator', () => {
  let redis: DeepMocked<Redis>;
  let indicator: { up: Mock; down: Mock };
  let healthIndicator: RedisHealthIndicator;

  const upResult = { redis: { status: 'up' } };
  const downResult = { redis: { status: 'down' } };

  beforeEach(() => {
    redis = createMockRedis();
    indicator = { up: vi.fn().mockReturnValue(upResult), down: vi.fn().mockReturnValue(downResult) };

    const healthIndicatorService = createMock<HealthIndicatorService>();
    healthIndicatorService.check.mockReturnValue(indicator as never);

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);

    healthIndicator = new RedisHealthIndicator(healthIndicatorService, redisService);
  });

  it('reports up when redis replies PONG', async () => {
    redis.ping.mockResolvedValue('PONG');

    await expect(healthIndicator.isHealthy('redis')).resolves.toBe(upResult);
    expect(indicator.up).toHaveBeenCalled();
  });

  it('reports down on an unexpected ping response', async () => {
    redis.ping.mockResolvedValue('NOPE');

    await expect(healthIndicator.isHealthy('redis')).resolves.toBe(downResult);
    expect(indicator.down).toHaveBeenCalledWith({ message: 'Unexpected ping response' });
  });

  it('reports down with the error message when ping throws an Error', async () => {
    redis.ping.mockRejectedValue(new Error('connection refused'));

    await expect(healthIndicator.isHealthy('redis')).resolves.toBe(downResult);
    expect(indicator.down).toHaveBeenCalledWith({ message: 'connection refused' });
  });

  it('reports down with a generic message for a non-Error throw', async () => {
    redis.ping.mockRejectedValue('boom');

    await expect(healthIndicator.isHealthy('redis')).resolves.toBe(downResult);
    expect(indicator.down).toHaveBeenCalledWith({ message: 'Redis is unreachable' });
  });
});
