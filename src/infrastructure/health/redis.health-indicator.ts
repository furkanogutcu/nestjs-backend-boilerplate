import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { RedisService } from '../redis/redis.service';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly redisService: RedisService,
  ) {}

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const indicator = this.healthIndicatorService.check(key);

    try {
      const pong = await this.redisService.getClient().ping();

      return pong === 'PONG' ? indicator.up() : indicator.down({ message: 'Unexpected ping response' });
    } catch (error) {
      return indicator.down({ message: error instanceof Error ? error.message : 'Redis is unreachable' });
    }
  }
}
