import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { AppInternalException } from '@shared/exceptions/internal.exception';
import { createMockRedis } from '@test/helpers';

import { RedisService } from '../redis/redis.service';
import { SensitiveService } from '../sensitive/sensitive.service';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  let redis: DeepMocked<Redis>;
  let sensitiveService: DeepMocked<SensitiveService>;
  let service: CacheService;

  beforeEach(() => {
    redis = createMockRedis();
    sensitiveService = createMock<SensitiveService>();

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);

    service = new CacheService(sensitiveService, redisService);

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('get', () => {
    it('namespaces the key and returns null on a miss', async () => {
      redis.get.mockResolvedValue(null);

      await expect(service.get({ key: 'orders' })).resolves.toBeNull();
      expect(redis.get).toHaveBeenCalledWith('app:cache:orders');
    });

    it('returns null and logs when redis throws', async () => {
      redis.get.mockRejectedValue(new Error('connection lost'));

      await expect(service.get({ key: 'orders' })).resolves.toBeNull();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('decrypts the value when requested', async () => {
      redis.get.mockResolvedValue('cipher-text');
      sensitiveService.decrypt.mockReturnValue({ secret: true });

      await expect(service.get({ key: 'token', decrypt: true })).resolves.toEqual({ secret: true });
      expect(sensitiveService.decrypt).toHaveBeenCalledWith({ input: 'cipher-text' });
    });

    it('parses JSON-encoded values', async () => {
      redis.get.mockResolvedValue('{"quantity":10}');

      await expect(service.get({ key: 'stock' })).resolves.toEqual({ quantity: 10 });
    });

    it('returns the raw string when the value is not JSON', async () => {
      redis.get.mockResolvedValue('plain-text');

      await expect(service.get({ key: 'label' })).resolves.toBe('plain-text');
    });
  });

  describe('set', () => {
    it('throws when caching undefined without encryption', async () => {
      await expect(service.set({ key: 'orders', data: undefined })).rejects.toBeInstanceOf(AppInternalException);
    });

    it.each([
      ['zero', 0],
      ['negative', -5],
      ['fractional', 1.5],
    ])('throws when ttl is %s', async (_label, ttl) => {
      await expect(service.set({ key: 'orders', data: { a: 1 }, ttl })).rejects.toBeInstanceOf(AppInternalException);
    });

    it('stores without expiry when ttl is null', async () => {
      await service.set({ key: 'orders', data: { a: 1 }, ttl: null });

      expect(redis.set).toHaveBeenCalledWith('app:cache:orders', '{"a":1}');
      expect(redis.setex).not.toHaveBeenCalled();
    });

    it('stores with the default ttl when none is given', async () => {
      await service.set({ key: 'orders', data: { a: 1 } });

      expect(redis.setex).toHaveBeenCalledWith('app:cache:orders', 3600, '{"a":1}');
    });

    it('stores with a custom ttl', async () => {
      await service.set({ key: 'orders', data: { a: 1 }, ttl: 60 });

      expect(redis.setex).toHaveBeenCalledWith('app:cache:orders', 60, '{"a":1}');
    });

    it('encrypts the value when requested', async () => {
      sensitiveService.encrypt.mockReturnValue('CIPHER');

      await service.set({ key: 'token', data: { a: 1 }, encrypt: true });

      expect(sensitiveService.encrypt).toHaveBeenCalledWith({ input: { a: 1 } });
      expect(redis.setex).toHaveBeenCalledWith('app:cache:token', 3600, 'CIPHER');
    });

    it('logs and does not throw when redis fails', async () => {
      redis.setex.mockRejectedValue(new Error('connection lost'));

      await expect(service.set({ key: 'orders', data: { a: 1 } })).resolves.toBeUndefined();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('removes the namespaced key', async () => {
      await service.delete({ key: 'user-permissions:u1' });

      expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('user-permissions:u1'));
    });

    it('logs and does not throw when redis fails', async () => {
      const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      redis.del.mockRejectedValue(new Error('redis down'));

      await expect(service.delete({ key: 'k' })).resolves.toBeUndefined();
      expect(errorLog).toHaveBeenCalled();
    });
  });
});
