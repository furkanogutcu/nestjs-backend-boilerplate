import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { RedisService } from '@infrastructure/redis/redis.service';
import { SensitiveService } from '@infrastructure/sensitive/sensitive.service';
import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppIdempotencyInProgressException } from '@shared/exceptions/idempotency-in-progress.exception';
import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';

import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService', () => {
  let redis: DeepMocked<Redis>;
  let sensitiveService: DeepMocked<SensitiveService>;
  let service: IdempotencyService;

  const baseArgs = { scope: 'auth:guest', principal: 'p', key: 'k', lockTtlSeconds: 30, responseTtlSeconds: 60 };

  beforeEach(() => {
    redis = createMock<Redis>();
    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    sensitiveService = createMock<SensitiveService>();
    service = new IdempotencyService(redisService, sensitiveService);
  });

  it('reserves with SET NX then stores the completed entry on a cache miss', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    sensitiveService.encrypt.mockReturnValue('encrypted');
    const compute = jest.fn().mockResolvedValue({ value: 1 });

    const result = await service.execute({ ...baseArgs, fingerprint: 'fp', compute });

    expect(result).toEqual({ value: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/^[0-9a-f]{32}\|encrypted$/),
      'EX',
      30,
      'NX',
    );
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('returns the cached response without recomputing on a completed hit', async () => {
    redis.get.mockResolvedValue('encrypted');
    sensitiveService.decrypt.mockReturnValue({ state: 'completed', fingerprint: 'fp', response: { value: 1 } });
    const compute = jest.fn();

    const result = await service.execute({ ...baseArgs, fingerprint: 'fp', compute });

    expect(result).toEqual({ value: 1 });
    expect(compute).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('strips the lock-token frame before decrypting a stored entry', async () => {
    redis.get.mockResolvedValue('lock-token-abc|encrypted-ciphertext');
    sensitiveService.decrypt.mockReturnValue({ state: 'completed', fingerprint: 'fp', response: { ok: true } });

    const result = await service.execute({ ...baseArgs, fingerprint: 'fp', compute: jest.fn() });

    expect(result).toEqual({ ok: true });
    expect(sensitiveService.decrypt).toHaveBeenCalledWith(expect.objectContaining({ input: 'encrypted-ciphertext' }));
  });

  it('rejects a hit whose fingerprint differs with a key conflict', async () => {
    redis.get.mockResolvedValue('encrypted');
    sensitiveService.decrypt.mockReturnValue({ state: 'completed', fingerprint: 'other', response: { value: 1 } });

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute: jest.fn() })).rejects.toMatchObject({
      code: ExceptionCode.IdempotencyKeyConflict,
    });
  });

  it('rejects a concurrent in-flight request with a 409', async () => {
    redis.get.mockResolvedValue('encrypted');
    sensitiveService.decrypt.mockReturnValue({ state: 'in_progress', fingerprint: 'fp' });

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute: jest.fn() })).rejects.toBeInstanceOf(
      AppIdempotencyInProgressException,
    );
  });

  it('prefers the fingerprint conflict over the in-flight signal', async () => {
    redis.get.mockResolvedValue('encrypted');
    sensitiveService.decrypt.mockReturnValue({ state: 'in_progress', fingerprint: 'other' });

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute: jest.fn() })).rejects.toBeInstanceOf(
      AppBadRequestException,
    );
  });

  it('re-reads after losing the SET NX race and surfaces the holder state (409)', async () => {
    redis.get.mockResolvedValueOnce(null).mockResolvedValueOnce('encrypted');
    redis.set.mockResolvedValue(null);
    sensitiveService.encrypt.mockReturnValue('encrypted');
    sensitiveService.decrypt.mockReturnValue({ state: 'in_progress', fingerprint: 'fp' });
    const compute = jest.fn();

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute })).rejects.toBeInstanceOf(
      AppIdempotencyInProgressException,
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('releases the lock and propagates when compute throws', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    sensitiveService.encrypt.mockReturnValue('encrypted');
    const compute = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute })).rejects.toThrow('boom');
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it('propagates the original compute error even when the best-effort lock release fails', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    // * eval here is the RELEASE_IF_OWNED script; its failure must not mask the compute error.
    redis.eval.mockRejectedValue(new Error('release script failed'));
    sensitiveService.encrypt.mockReturnValue('encrypted');
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const compute = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute })).rejects.toThrow('boom');

    expect(warn).toHaveBeenCalled();
  });

  it('fails closed with a 503 when the Redis read errors, without computing', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    const compute = jest.fn();

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('fails closed with a 503 when the reserve write errors, without computing', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockRejectedValue(new Error('redis down'));
    sensitiveService.encrypt.mockReturnValue('encrypted');
    const compute = jest.fn();

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('fails closed with a 503 when the lock is lost but the holder entry vanished', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue(null);
    sensitiveService.encrypt.mockReturnValue('encrypted');
    const compute = jest.fn();

    await expect(service.execute({ ...baseArgs, fingerprint: 'fp', compute })).rejects.toBeInstanceOf(
      AppServiceUnavailableException,
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('treats an undecryptable entry as a miss and recomputes (does not fail closed)', async () => {
    redis.get.mockResolvedValueOnce('garbage').mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    sensitiveService.encrypt.mockReturnValue('encrypted');
    sensitiveService.decrypt.mockImplementation(() => {
      throw new Error('bad ciphertext');
    });
    const compute = jest.fn().mockResolvedValue({ value: 3 });

    const result = await service.execute({ ...baseArgs, fingerprint: 'fp', compute });

    expect(result).toEqual({ value: 3 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes after an undecryptable entry even when purging the garbage fails', async () => {
    redis.get.mockResolvedValueOnce('garbage').mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    // * Purge is best-effort: a failed DEL must not stop the request from reclaiming the slot and recomputing.
    redis.del.mockRejectedValue(new Error('purge failed'));
    sensitiveService.encrypt.mockReturnValue('encrypted');
    sensitiveService.decrypt.mockImplementation(() => {
      throw new Error('bad ciphertext');
    });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const compute = jest.fn().mockResolvedValue({ value: 9 });

    const result = await service.execute({ ...baseArgs, fingerprint: 'fp', compute });

    expect(result).toEqual({ value: 9 });
    expect(compute).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
  });

  it('delivers the computed response even when caching it fails (post-compute write is best-effort)', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    redis.eval.mockRejectedValue(new Error('redis down'));
    sensitiveService.encrypt.mockReturnValue('encrypted');
    const compute = jest.fn().mockResolvedValue({ value: 7 });

    const result = await service.execute({ ...baseArgs, fingerprint: 'fp', compute });

    expect(result).toEqual({ value: 7 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('namespaces the cache key by principal', async () => {
    redis.get.mockResolvedValue(null);
    redis.set.mockResolvedValue('OK');
    sensitiveService.encrypt.mockReturnValue('encrypted');

    await service.execute({ ...baseArgs, principal: 'p1', fingerprint: '', compute: jest.fn().mockResolvedValue(1) });
    const firstKey = redis.set.mock.calls[0][0];
    redis.set.mockClear();

    await service.execute({ ...baseArgs, principal: 'p2', fingerprint: '', compute: jest.fn().mockResolvedValue(1) });
    const secondKey = redis.set.mock.calls[0][0];

    expect(firstKey).not.toEqual(secondKey);
  });
});
