import { Injectable, Logger } from '@nestjs/common';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';
import { CacheKey } from '@shared/utils/cache-key.util';
import { exponentialRetry } from '@shared/utils/exponential-retry.util';

import { SessionsRepository } from '../repositories/sessions.repository';

@Injectable()
export class RevocationService {
  private readonly logger = new Logger(RevocationService.name);
  private readonly keyPrefix = appConfig.redis.keyPrefixes.revocation;
  private readonly ttlSeconds = env.JWT_ACCESS_TTL_SECONDS;

  private readonly dbFailureThreshold = 5;
  private readonly dbCooldownMs = 5000;
  private dbFailureCount = 0;
  private circuitOpenedAt: number | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly sessionsRepository: SessionsRepository,
    private readonly clock: ClockService,
  ) {}

  // ! The denylist key is what actually stops an already-issued access token, so this write must not be
  // ! swallowed: a lost write leaves a revoked session's token honoured until JWT_ACCESS_TTL_SECONDS expiry.
  // ! Revocation is a cold path (logout, reuse detection, password reset), so retrying and then failing the
  // ! caller is the right trade — never trade this durability back for latency.
  async revokeSession({ sessionId }: { sessionId: string }): Promise<void> {
    await this.write(this.key({ kind: 'sid', id: sessionId }));
  }

  async revokeFamily({ familyId }: { familyId: string }): Promise<void> {
    await this.write(this.key({ kind: 'fid', id: familyId }));
  }

  async isRevoked({ sessionId, familyId }: { sessionId: string; familyId: string }): Promise<boolean> {
    try {
      const revokedCount = await this.redisService
        .getClient()
        .exists(this.key({ kind: 'sid', id: sessionId }), this.key({ kind: 'fid', id: familyId }));

      return revokedCount > 0;
    } catch (error) {
      this.logger.warn(`Revocation denylist unavailable, falling back to database: ${this.toMessage(error)}`);

      return await this.isRevokedInDatabase(sessionId);
    }
  }

  // * Short, jittered retries: a Redis blip is usually transient, and the caller is already off the hot path.
  // * Setting an existing key again just refreshes its TTL, so retrying is safe.
  private async write(key: string): Promise<void> {
    try {
      await exponentialRetry({
        fn: async () => await this.redisService.getClient().set(key, '1', 'EX', this.ttlSeconds),
        maxAttempts: 3,
        baseDelayMs: 50,
        maxDelayMs: 200,
      });
    } catch (error) {
      this.logger.error(`Failed to write revocation denylist key: ${this.toMessage(error)}`);

      throw new AppServiceUnavailableException();
    }
  }

  private async isRevokedInDatabase(sessionId: string): Promise<boolean> {
    if (this.isCircuitOpen()) {
      throw new AppServiceUnavailableException();
    }

    try {
      const session = await this.sessionsRepository.findOne({
        where: { id: sessionId },
        select: { id: true, revokedAt: true },
      });
      this.recordDatabaseSuccess();

      return !session || session.revokedAt !== null;
    } catch (error) {
      this.recordDatabaseFailure();
      this.logger.error(`Revocation database fallback failed: ${this.toMessage(error)}`);

      throw new AppServiceUnavailableException();
    }
  }

  private isCircuitOpen(): boolean {
    if (this.circuitOpenedAt === null) {
      return false;
    }

    return this.clock.epochMillis() - this.circuitOpenedAt < this.dbCooldownMs;
  }

  private recordDatabaseSuccess(): void {
    this.dbFailureCount = 0;
    this.circuitOpenedAt = null;
  }

  private recordDatabaseFailure(): void {
    this.dbFailureCount += 1;

    if (this.dbFailureCount >= this.dbFailureThreshold) {
      this.circuitOpenedAt = this.clock.epochMillis();
    }
  }

  private key({ kind, id }: { kind: 'sid' | 'fid'; id: string }): string {
    return CacheKey.join(this.keyPrefix, kind, id);
  }

  private toMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
