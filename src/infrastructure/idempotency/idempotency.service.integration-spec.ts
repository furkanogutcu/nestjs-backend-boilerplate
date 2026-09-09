import { createMock } from '@golevelup/ts-vitest';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Redis } from 'ioredis';

import { RedisService } from '@infrastructure/redis/redis.service';
import { SensitiveService } from '@infrastructure/sensitive/sensitive.service';
import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { AppIdempotencyInProgressException } from '@shared/exceptions/idempotency-in-progress.exception';

import { IdempotencyService } from './idempotency.service';

describe('IdempotencyService (integration)', () => {
  let container: StartedRedisContainer;
  let redis: Redis;
  let service: IdempotencyService;

  beforeAll(async () => {
    container = await new RedisContainer('redis:7-alpine').start();
    redis = new Redis(container.getConnectionUrl());

    const redisService = createMock<RedisService>();
    redisService.getClient.mockReturnValue(redis);
    service = new IdempotencyService(redisService, new SensitiveService());
  });

  afterAll(async () => {
    redis.disconnect();
    await container.stop();
  });

  afterEach(async () => {
    await redis.flushall();
  });

  it('returns the first response on a retry with the same key and stores it encrypted', async () => {
    const args = {
      scope: 'auth:guest',
      principal: 'p',
      key: 'idempotency-key-1',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
    };

    const first = await service.execute({
      ...args,
      compute: vi.fn().mockResolvedValue({ token: 'secret-token-value' }),
    });
    const compute = vi.fn().mockResolvedValue({ token: 'a-different-token' });
    const second = await service.execute({ ...args, compute });

    expect(second).toEqual(first);
    expect(compute).not.toHaveBeenCalled();

    const [storedKey] = await redis.keys('*');
    const storedValue = await redis.get(storedKey);
    expect(storedValue).not.toContain('secret-token-value');
  });

  it('rejects reusing a key with a different request fingerprint', async () => {
    const args = {
      scope: 'auth:guest',
      principal: 'p',
      key: 'idempotency-key-1',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
    };

    await service.execute({ ...args, fingerprint: 'fp-1', compute: vi.fn().mockResolvedValue({ ok: true }) });

    await expect(
      service.execute({ ...args, fingerprint: 'fp-2', compute: vi.fn().mockResolvedValue({ ok: true }) }),
    ).rejects.toBeInstanceOf(AppBadRequestException);
  });

  it('does not return a ciphertext relocated under a different cache key (AAD binding)', async () => {
    await service.execute({
      scope: 'auth:guest',
      principal: 'p',
      key: 'victim-key',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
      compute: vi.fn().mockResolvedValue({ token: 'victim-token' }),
    });
    const [victimSlot] = await redis.keys('*');
    const victimCiphertext = (await redis.get(victimSlot)) as string;

    const attackerArgs = {
      scope: 'auth:guest',
      principal: 'p',
      key: 'attacker-key',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
    };
    await service.execute({ ...attackerArgs, compute: vi.fn().mockResolvedValue({ token: 'attacker-token' }) });
    const [attackerSlot] = (await redis.keys('*')).filter((key) => key !== victimSlot);
    await redis.set(attackerSlot, victimCiphertext);

    const recompute = vi.fn().mockResolvedValue({ token: 'recomputed-token' });
    const result = await service.execute({ ...attackerArgs, compute: recompute });

    expect(recompute).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ token: 'recomputed-token' });
  });

  it('serializes concurrent requests: one computes while the other is rejected as in-progress', async () => {
    const args = {
      scope: 'auth:guest',
      principal: 'p',
      key: 'concurrent-key',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
    };

    let releaseFirst: () => void = () => undefined;
    let signalEntered: () => void = () => undefined;
    const entered = new Promise<void>((resolve) => (signalEntered = resolve));
    const barrier = new Promise<void>((resolve) => (releaseFirst = resolve));

    const firstCompute = vi.fn().mockImplementation(async () => {
      signalEntered();
      await barrier;

      return { token: 'first' };
    });

    const firstFlight = service.execute({ ...args, compute: firstCompute });
    await entered;

    const secondCompute = vi.fn();
    await expect(service.execute({ ...args, compute: secondCompute })).rejects.toBeInstanceOf(
      AppIdempotencyInProgressException,
    );
    expect(secondCompute).not.toHaveBeenCalled();

    releaseFirst();
    await expect(firstFlight).resolves.toEqual({ token: 'first' });
    expect(firstCompute).toHaveBeenCalledTimes(1);

    const retry = await service.execute({ ...args, compute: vi.fn() });
    expect(retry).toEqual({ token: 'first' });
  });

  it('stores the completed entry under the response TTL', async () => {
    await service.execute({
      scope: 'auth:guest',
      principal: 'p',
      key: 'ttl-key',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 120,
      compute: vi.fn().mockResolvedValue({ ok: true }),
    });

    const [slot] = await redis.keys('*');
    const ttl = await redis.ttl(slot);

    expect(ttl).toBeGreaterThan(110);
    expect(ttl).toBeLessThanOrEqual(120);
  });

  it('releases the lock when compute throws so a retry can recompute', async () => {
    const args = {
      scope: 'auth:guest',
      principal: 'p',
      key: 'fail-key',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
    };

    await expect(
      service.execute({ ...args, compute: vi.fn().mockRejectedValue(new Error('compute failed')) }),
    ).rejects.toThrow('compute failed');
    expect(await redis.keys('*')).toHaveLength(0);

    const retry = await service.execute({ ...args, compute: vi.fn().mockResolvedValue({ ok: true }) });
    expect(retry).toEqual({ ok: true });
  });

  it('isolates entries by principal for the same scope and key', async () => {
    const base = {
      scope: 'auth:guest',
      key: 'shared-key',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
    };

    const a = await service.execute({
      ...base,
      principal: 'user-a',
      compute: vi.fn().mockResolvedValue({ who: 'a' }),
    });
    const b = await service.execute({
      ...base,
      principal: 'user-b',
      compute: vi.fn().mockResolvedValue({ who: 'b' }),
    });

    expect(a).toEqual({ who: 'a' });
    expect(b).toEqual({ who: 'b' });
    expect(await redis.keys('*')).toHaveLength(2);
  });

  it('does not overwrite the entry once the lock has been taken over (store fencing)', async () => {
    const foreign = `${'deadbeef'.repeat(4)}|foreign-holder-ciphertext`;
    let slot = '';

    const result = await service.execute({
      scope: 'auth:guest',
      principal: 'p',
      key: 'fence-store',
      fingerprint: 'fp',
      lockTtlSeconds: 30,
      responseTtlSeconds: 60,
      compute: async () => {
        // * Simulate our lock expiring and another holder re-acquiring the slot under a different token.
        [slot] = await redis.keys('*');
        await redis.set(slot, foreign);

        return { token: 'mine' };
      },
    });

    expect(result).toEqual({ token: 'mine' });
    expect(await redis.get(slot)).toBe(foreign);
  });

  it('does not delete the entry once the lock has been taken over (release fencing)', async () => {
    const foreign = `${'deadbeef'.repeat(4)}|foreign-holder-ciphertext`;
    let slot = '';

    await expect(
      service.execute({
        scope: 'auth:guest',
        principal: 'p',
        key: 'fence-release',
        fingerprint: 'fp',
        lockTtlSeconds: 30,
        responseTtlSeconds: 60,
        compute: async () => {
          [slot] = await redis.keys('*');
          await redis.set(slot, foreign);

          throw new Error('compute failed after lock takeover');
        },
      }),
    ).rejects.toThrow('compute failed after lock takeover');

    expect(await redis.get(slot)).toBe(foreign);
  });
});
