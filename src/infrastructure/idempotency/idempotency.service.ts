import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';

import { appConfig } from '@config/app.config';
import { AppBadRequestException } from '@shared/exceptions/bad-request.exception';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppIdempotencyInProgressException } from '@shared/exceptions/idempotency-in-progress.exception';
import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';
import { CacheKey } from '@shared/utils/cache-key.util';

import { RedisService } from '../redis/redis.service';
import { SensitiveService } from '../sensitive/sensitive.service';
import { IDEMPOTENCY_RELEASE_IF_OWNED_SCRIPT, IDEMPOTENCY_STORE_IF_OWNED_SCRIPT } from './idempotency-scripts.constant';

type CachedEntry<T> =
  { state: 'in_progress'; fingerprint: string } | { state: 'completed'; fingerprint: string; response: T };

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly keyPrefix = appConfig.redis.keyPrefixes.idempotency;

  // * Lock fencing: a per-execution random token is stored as a plaintext prefix so the Lua guards verify ownership without decrypting; it holds no secret, and the payload stays AES-GCM encrypted after the prefix.
  // ! Invariant: lockTtlSeconds MUST exceed worst-case compute() duration, or the lock can expire mid-compute and a second request runs a duplicate side effect.
  private readonly lockTokenBytes = 16;
  private readonly lockFrameSeparator = '|';

  constructor(
    private readonly redisService: RedisService,
    private readonly sensitiveService: SensitiveService,
  ) {}

  async execute<T>({
    scope,
    principal,
    key,
    fingerprint,
    lockTtlSeconds,
    responseTtlSeconds,
    compute,
  }: {
    scope: string;
    principal: string;
    key: string;
    fingerprint: string;
    lockTtlSeconds: number;
    responseTtlSeconds: number;
    compute: () => Promise<T>;
  }): Promise<T> {
    const cacheKey = this.cacheKey({ scope, principal, key });

    const existing = await this.read<T>(cacheKey);

    if (existing) {
      return this.resolveExisting({ existing, fingerprint });
    }

    const { acquired, lockToken } = await this.reserve({ cacheKey, fingerprint, lockTtlSeconds });

    if (!acquired) {
      const afterRace = await this.read<T>(cacheKey);

      // * Lost the SET NX race: the holder's entry is now visible (typically in_progress → 409). If it already vanished, fail closed rather than run compute() without the lock and risk a duplicate side effect.
      if (!afterRace) {
        throw new AppServiceUnavailableException();
      }

      return this.resolveExisting({ existing: afterRace, fingerprint });
    }

    return await this.computeAndStore({ cacheKey, fingerprint, responseTtlSeconds, lockToken, compute });
  }

  private resolveExisting<T>({ existing, fingerprint }: { existing: CachedEntry<T>; fingerprint: string }): T {
    if (existing.fingerprint !== fingerprint) {
      throw new AppBadRequestException({
        message: 'Idempotency key was reused with a different request.',
        code: ExceptionCode.IdempotencyKeyConflict,
      });
    }

    if (existing.state === 'in_progress') {
      throw new AppIdempotencyInProgressException();
    }

    return existing.response;
  }

  private async reserve({
    cacheKey,
    fingerprint,
    lockTtlSeconds,
  }: {
    cacheKey: string;
    fingerprint: string;
    lockTtlSeconds: number;
  }): Promise<{ acquired: boolean; lockToken: string }> {
    const lockToken = randomBytes(this.lockTokenBytes).toString('hex');
    const entry: CachedEntry<never> = { state: 'in_progress', fingerprint };
    const value = this.frame({ lockToken, encrypted: this.sensitiveService.encrypt({ input: entry, aad: cacheKey }) });

    try {
      const result = await this.redisService.getClient().set(cacheKey, value, 'EX', lockTtlSeconds, 'NX');

      // * `result === null` is a normal lost-race (the key already exists), not a Redis failure.
      return { acquired: result === 'OK', lockToken };
    } catch (error) {
      // * Fail closed: could not establish the lock, so surface a 503 rather than run compute() and risk a duplicate side effect.
      this.logger.error(`Idempotency reserve failed: ${this.toMessage(error)}`);

      throw new AppServiceUnavailableException();
    }
  }

  private async computeAndStore<T>({
    cacheKey,
    fingerprint,
    responseTtlSeconds,
    lockToken,
    compute,
  }: {
    cacheKey: string;
    fingerprint: string;
    responseTtlSeconds: number;
    lockToken: string;
    compute: () => Promise<T>;
  }): Promise<T> {
    let response: T;

    try {
      response = await compute();
    } catch (error) {
      await this.releaseIfOwned({ cacheKey, lockToken });

      throw error;
    }

    await this.store({ cacheKey, fingerprint, response, responseTtlSeconds, lockToken });

    return response;
  }

  private async store<T>({
    cacheKey,
    fingerprint,
    response,
    responseTtlSeconds,
    lockToken,
  }: {
    cacheKey: string;
    fingerprint: string;
    response: T;
    responseTtlSeconds: number;
    lockToken: string;
  }): Promise<void> {
    try {
      const entry: CachedEntry<T> = { state: 'completed', fingerprint, response };
      // * Completed entries carry no owner (empty token prefix); the guard reads the existing in_progress token to confirm we still hold the lock before overwriting.
      const value = this.frame({
        lockToken: '',
        encrypted: this.sensitiveService.encrypt({ input: entry, aad: cacheKey }),
      });

      await this.redisService
        .getClient()
        .eval(IDEMPOTENCY_STORE_IF_OWNED_SCRIPT, 1, cacheKey, lockToken, value, responseTtlSeconds);
    } catch (error) {
      // * Best-effort: compute() already committed its side effect, so we cannot fail now — log and return uncached; the stale in_progress lock expires on its own (409 to retries until then).
      this.logger.error(`Idempotency write failed; response delivered but not cached: ${this.toMessage(error)}`);
    }
  }

  private async releaseIfOwned({ cacheKey, lockToken }: { cacheKey: string; lockToken: string }): Promise<void> {
    try {
      await this.redisService.getClient().eval(IDEMPOTENCY_RELEASE_IF_OWNED_SCRIPT, 1, cacheKey, lockToken);
    } catch (error) {
      this.logger.warn(`Idempotency lock release failed: ${this.toMessage(error)}`);
    }
  }

  private async purge(cacheKey: string): Promise<void> {
    try {
      await this.redisService.getClient().del(cacheKey);
    } catch (error) {
      this.logger.warn(`Idempotency garbage purge failed: ${this.toMessage(error)}`);
    }
  }

  private async read<T>(cacheKey: string): Promise<CachedEntry<T> | null> {
    let stored: string | null;

    try {
      stored = await this.redisService.getClient().get(cacheKey);
    } catch (error) {
      // * Fail closed: a Redis transport error means we cannot prove this is a fresh request, so surface a 503 instead of treating it as a miss.
      this.logger.error(`Idempotency read failed: ${this.toMessage(error)}`);

      throw new AppServiceUnavailableException();
    }

    if (!stored) {
      return null;
    }

    try {
      return this.sensitiveService.decrypt({ input: this.unframe(stored), aad: cacheKey }) as CachedEntry<T>;
    } catch (error) {
      // * A decrypt failure (e.g. relocated ciphertext failing AAD) is provably garbage; a legitimate in_progress lock would decrypt under the same AAD, so purging here cannot drop another holder's lock. Reclaim via SET NX and recompute.
      this.logger.warn(`Idempotency entry failed to decrypt; purging and treating as miss: ${this.toMessage(error)}`);
      await this.purge(cacheKey);

      return null;
    }
  }

  private frame({ lockToken, encrypted }: { lockToken: string; encrypted: string }): string {
    return `${lockToken}${this.lockFrameSeparator}${encrypted}`;
  }

  private unframe(stored: string): string {
    const index = stored.indexOf(this.lockFrameSeparator);

    return index === -1 ? stored : stored.slice(index + 1);
  }

  private cacheKey({ scope, principal, key }: { scope: string; principal: string; key: string }): string {
    const hashed = createHash('sha256').update(`${principal}:${key}`).digest('hex');

    return CacheKey.join(this.keyPrefix, scope, hashed);
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
