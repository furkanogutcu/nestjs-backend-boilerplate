import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { appConfig } from '@config/app.config';
import { AppInternalException } from '@shared/exceptions/internal.exception';
import { CacheKey } from '@shared/utils/cache-key.util';

import { RedisService } from '../redis/redis.service';
import { SensitiveService } from '../sensitive/sensitive.service';

const { keyPrefixes } = appConfig.redis;
const { defaultTtl } = appConfig.cache;

@Injectable()
export class CacheService {
  private readonly client: Redis;
  private readonly logger = new Logger(CacheService.name);

  constructor(
    private readonly sensitiveService: SensitiveService,
    private readonly redisService: RedisService,
  ) {
    this.client = this.redisService.getClient();
  }

  async get<T = unknown>({ key, decrypt }: { key: string; decrypt?: boolean }): Promise<T | null> {
    let value: string | null;

    try {
      value = await this.client.get(this.buildKey(key));
    } catch (error) {
      this.logger.error(`Cache get failed for "${key}": ${(error as Error).message}`);
      return null;
    }

    if (value === null) return null;

    if (decrypt) {
      return this.sensitiveService.decrypt({ input: value }) as T;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  async set({
    key,
    data,
    ttl,
    encrypt,
  }: {
    key: string;
    data: unknown;
    ttl?: number | null;
    encrypt?: boolean;
  }): Promise<void> {
    if (!encrypt && data === undefined) {
      throw new AppInternalException({ message: 'Cannot cache an undefined value' });
    }

    const value = encrypt ? this.sensitiveService.encrypt({ input: data }) : JSON.stringify(data);
    const resolvedTtl = ttl === undefined ? defaultTtl : ttl;

    if (resolvedTtl !== null && (!Number.isInteger(resolvedTtl) || resolvedTtl <= 0)) {
      throw new AppInternalException({ message: 'Cache ttl must be a positive integer (seconds)' });
    }

    try {
      if (resolvedTtl === null) {
        await this.client.set(this.buildKey(key), value);
      } else {
        await this.client.setex(this.buildKey(key), resolvedTtl, value);
      }
    } catch (error) {
      this.logger.error(`Cache set failed for "${key}": ${(error as Error).message}`);
    }
  }

  // * Invalidation is best-effort like set(): a cache that cannot be reached must not fail the caller's
  // * write. Callers that need the stale value gone for correctness read through the database instead.
  async delete({ key }: { key: string }): Promise<void> {
    try {
      await this.client.del(this.buildKey(key));
    } catch (error) {
      this.logger.error(`Cache delete failed for "${key}": ${(error as Error).message}`);
    }
  }

  private buildKey(key: string): string {
    return CacheKey.join(keyPrefixes.cache, key);
  }
}
