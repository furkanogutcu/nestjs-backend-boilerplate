import { Injectable } from '@nestjs/common';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';

import { appConfig } from '@config/app.config';
import { IRateLimitOptions, RateLimitContext } from '@shared/interfaces/rate-limit-rule.interface';
import { CacheKey } from '@shared/utils/cache-key.util';

import { RedisService } from '../redis/redis.service';

@Injectable()
export class RateLimitService {
  private readonly limiters: Map<string, RateLimiterRedis> = new Map();
  private readonly keyPrefix = appConfig.redis.keyPrefixes.rateLimit;

  constructor(private readonly redisService: RedisService) {}

  async consume(params: { options: IRateLimitOptions; rateLimitContext: RateLimitContext }): Promise<RateLimiterRes> {
    const { options, rateLimitContext } = params;

    return await this.consumeByKey({ options, key: this.generateRateLimitKey(rateLimitContext) });
  }

  async consumeByKey(params: { options: IRateLimitOptions; key: string }): Promise<RateLimiterRes> {
    const { options, key } = params;

    return await this.getOrCreateLimiter(options).consume(key);
  }

  private generateRateLimitKey(rateLimitContext: RateLimitContext): string {
    const {
      request: { ip_address, path, method, user_id },
    } = rateLimitContext;

    const subject = user_id ?? ip_address;

    return CacheKey.join(subject, path, method);
  }

  private getOrCreateLimiter(options: IRateLimitOptions): RateLimiterRedis {
    const {
      points,
      duration,
      blockDuration = duration,
      inMemoryBlockOnConsumed = points,
      inMemoryBlockDuration = blockDuration,
    } = options;

    const key = CacheKey.join(points, duration, blockDuration, inMemoryBlockOnConsumed, inMemoryBlockDuration);

    let limiter = this.limiters.get(key);

    if (!limiter) {
      limiter = new RateLimiterRedis({
        storeClient: this.redisService.getClient(),
        points,
        duration,
        blockDuration,
        inMemoryBlockOnConsumed,
        inMemoryBlockDuration,
        keyPrefix: CacheKey.join(this.keyPrefix, key),
      });

      this.limiters.set(key, limiter);
    }

    return limiter;
  }
}
