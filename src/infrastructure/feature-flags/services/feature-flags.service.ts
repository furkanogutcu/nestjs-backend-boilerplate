import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CacheService } from '@infrastructure/cache/cache.service';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { CacheKey } from '@shared/utils/cache-key.util';

import { FeatureFlag } from '../entities/feature-flag.entity';
import { FEATURE_FLAG_CACHE_TTL_SECONDS } from '../feature-flags.constant';

@Injectable()
export class FeatureFlagsService {
  constructor(
    @InjectRepository(FeatureFlag) private readonly flags: Repository<FeatureFlag>,
    private readonly cacheService: CacheService,
  ) {}

  // ! An unknown key is disabled, never enabled: a typo in @RequireFeature must fail closed, and a flag that
  // ! has not been created yet is by definition not rolled out.
  async isEnabled({ key }: { key: string }): Promise<boolean> {
    const cached = await this.cacheService.get<boolean>({ key: this.cacheKey(key) });

    if (cached !== null) {
      return cached;
    }

    const flag = await this.flags.findOne({ where: { key }, select: { key: true, enabled: true } });
    const enabled = flag?.enabled ?? false;

    await this.cacheService.set({ key: this.cacheKey(key), data: enabled, ttl: FEATURE_FLAG_CACHE_TTL_SECONDS });

    return enabled;
  }

  async list(): Promise<FeatureFlag[]> {
    return await this.flags.find({ order: { key: 'ASC' } });
  }

  async upsert(params: { key: string; enabled: boolean; description?: string | null }): Promise<FeatureFlag> {
    const { key, enabled, description } = params;

    await this.flags.upsert({ key, enabled, description: description ?? null }, ['key']);
    await this.cacheService.delete({ key: this.cacheKey(key) });

    return await this.require({ key });
  }

  async remove({ key }: { key: string }): Promise<void> {
    const result = await this.flags.delete({ key });

    if ((result.affected ?? 0) === 0) {
      throw new AppNotFoundException({ resourceName: 'Feature flag' });
    }

    await this.cacheService.delete({ key: this.cacheKey(key) });
  }

  async require({ key }: { key: string }): Promise<FeatureFlag> {
    const flag = await this.flags.findOne({ where: { key } });

    if (!flag) {
      throw new AppNotFoundException({ resourceName: 'Feature flag' });
    }

    return flag;
  }

  private cacheKey(key: string): string {
    return CacheKey.join('feature-flag', key);
  }
}
