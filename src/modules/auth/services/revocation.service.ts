import { Injectable, Logger } from '@nestjs/common';

import { appConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { RedisService } from '@infrastructure/redis/redis.service';
import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';
import { CacheKey } from '@shared/utils/cache-key.util';

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

  // * Inline (request-path) revocation: writes the denylist key best-effort. A lost write no longer means a revoked
  // * token stays valid — the SessionRevoked outbox event drives reconcileSession/reconcileFamily (below) on a
  // * separate consumer, which retries until the key exists. So here we favour latency (never fail the caller's
  // * logout/rotate on a Redis blip) and lean on that consumer for durability.
  async revokeSession({ sessionId }: { sessionId: string }): Promise<void> {
    await this.writeBestEffort(this.key({ kind: 'sid', id: sessionId }));
  }

  async revokeFamily({ familyId }: { familyId: string }): Promise<void> {
    await this.writeBestEffort(this.key({ kind: 'fid', id: familyId }));
  }

  // * Durable reconcile path, driven by the SessionRevoked consumer off the outbox event. These MUST throw on a
  // * write failure so the consumer rethrows and Kafka redelivers — that redelivery is what makes revocation
  // * durable against a lost inline write. Idempotent: re-setting an existing key just refreshes its TTL.
  async reconcileSession({ sessionId }: { sessionId: string }): Promise<void> {
    await this.write(this.key({ kind: 'sid', id: sessionId }));
  }

  async reconcileFamily({ familyId }: { familyId: string }): Promise<void> {
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

  // * Fail-loud primitive: propagates the Redis failure so the reconcile consumer can redeliver. Inline callers wrap
  // * it in writeBestEffort; the consumer path (reconcile*) lets it throw.
  private async write(key: string): Promise<void> {
    await this.redisService.getClient().set(key, '1', 'EX', this.ttlSeconds);
  }

  private async writeBestEffort(key: string): Promise<void> {
    try {
      await this.write(key);
    } catch (error) {
      this.logger.error(
        `Failed to write revocation denylist key (best-effort; reconcile consumer will retry): ${this.toMessage(error)}`,
      );
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
