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

  // ! lockTtlSeconds MUST exceed worst-case compute(), or a second request duplicates the side effect.
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

      // ! Fail closed: without the holder's entry, running compute() unlocked would risk a duplicate side effect.
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

      return { acquired: result === 'OK', lockToken };
    } catch (error) {
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
      // * Completed entries carry no owner; the guard checks the existing in_progress token before overwriting.
      const value = this.frame({
        lockToken: '',
        encrypted: this.sensitiveService.encrypt({ input: entry, aad: cacheKey }),
      });

      await this.redisService
        .getClient()
        .eval(IDEMPOTENCY_STORE_IF_OWNED_SCRIPT, 1, cacheKey, lockToken, value, responseTtlSeconds);
    } catch (error) {
      // ! compute() already committed its side effect, so a failed write must not fail the request.
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
      this.logger.error(`Idempotency read failed: ${this.toMessage(error)}`);

      throw new AppServiceUnavailableException();
    }

    if (!stored) {
      return null;
    }

    try {
      return this.sensitiveService.decrypt({ input: this.unframe(stored), aad: cacheKey }) as CachedEntry<T>;
    } catch (error) {
      // ! Purging is safe: a legitimate lock decrypts under the same AAD, so this can only drop garbage.
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
