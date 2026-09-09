import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Repository } from 'typeorm';

import { CacheService } from '@infrastructure/cache/cache.service';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { FeatureFlag } from '../entities/feature-flag.entity';
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  let flags: DeepMocked<Repository<FeatureFlag>>;
  let cacheService: DeepMocked<CacheService>;
  let service: FeatureFlagsService;

  beforeEach(() => {
    flags = createMock<Repository<FeatureFlag>>();
    cacheService = createMock<CacheService>();
    service = new FeatureFlagsService(flags, cacheService);
  });

  describe('isEnabled', () => {
    it('returns the cached value without touching the database', async () => {
      cacheService.get.mockResolvedValue(true);

      await expect(service.isEnabled({ key: 'new-checkout' })).resolves.toBe(true);
      expect(flags.findOne).not.toHaveBeenCalled();
    });

    it('honours a cached false rather than treating it as a miss', async () => {
      cacheService.get.mockResolvedValue(false);

      await expect(service.isEnabled({ key: 'new-checkout' })).resolves.toBe(false);
      expect(flags.findOne).not.toHaveBeenCalled();
    });

    it('reads through on a miss and caches the result', async () => {
      cacheService.get.mockResolvedValue(null);
      flags.findOne.mockResolvedValue({ key: 'new-checkout', enabled: true } as FeatureFlag);

      await expect(service.isEnabled({ key: 'new-checkout' })).resolves.toBe(true);
      expect(cacheService.set).toHaveBeenCalledWith(expect.objectContaining({ data: true }));
    });

    it('fails closed for a flag that does not exist', async () => {
      cacheService.get.mockResolvedValue(null);
      flags.findOne.mockResolvedValue(null);

      await expect(service.isEnabled({ key: 'typo' })).resolves.toBe(false);
    });
  });

  describe('upsert', () => {
    it('stores the flag and drops its cached value', async () => {
      flags.findOne.mockResolvedValue({ key: 'k', enabled: true } as FeatureFlag);

      await service.upsert({ key: 'k', enabled: true, description: 'why' });

      expect(flags.upsert).toHaveBeenCalledWith({ key: 'k', enabled: true, description: 'why' }, ['key']);
      expect(cacheService.delete).toHaveBeenCalledWith({ key: expect.stringContaining('k') });
    });

    it('defaults a missing description to null', async () => {
      flags.findOne.mockResolvedValue({ key: 'k' } as FeatureFlag);

      await service.upsert({ key: 'k', enabled: false });

      expect(flags.upsert).toHaveBeenCalledWith(expect.objectContaining({ description: null }), ['key']);
    });
  });

  describe('remove', () => {
    it('deletes the flag and drops its cached value', async () => {
      flags.delete.mockResolvedValue({ affected: 1, raw: [] });

      await service.remove({ key: 'k' });

      expect(cacheService.delete).toHaveBeenCalledWith({ key: expect.stringContaining('k') });
    });

    it('fails when the flag does not exist', async () => {
      flags.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(service.remove({ key: 'k' })).rejects.toBeInstanceOf(AppNotFoundException);
    });
  });

  describe('list and require', () => {
    it('lists flags in key order', async () => {
      flags.find.mockResolvedValue([]);

      await service.list();

      expect(flags.find).toHaveBeenCalledWith({ order: { key: 'ASC' } });
    });

    it('fails when a required flag is missing', async () => {
      flags.findOne.mockResolvedValue(null);

      await expect(service.require({ key: 'k' })).rejects.toBeInstanceOf(AppNotFoundException);
    });
  });
});
