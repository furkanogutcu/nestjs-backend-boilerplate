import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { DataSource, IsNull, MoreThan } from 'typeorm';

import { env } from '@config/env.config';
import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { AppUnauthorizedException } from '@shared/exceptions/unauthorized.exception';
import { generateUuid, isUuid } from '@shared/utils/uuid.util';

import {
  MAX_ACTIVE_FAMILIES_PER_USER,
  MAX_USER_AGENT_LENGTH,
  REFRESH_SECRET_BYTES,
  REFRESH_TOKEN_SEPARATOR,
} from '../constants/auth.constant';
import { Session } from '../entities/session.entity';
import { SessionsRepository } from '../repositories/sessions.repository';
import { RevocationService } from './revocation.service';

interface IIssuedSession {
  session: Session;
  refreshToken: string;
}

type RotateOutcome =
  | { status: 'invalid' }
  | { status: 'reuse'; familyId: string; userId: string }
  | { status: 'rotated'; session: Session; refreshToken: string; revokedSessionId: string };

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private readonly dummyHash = '0'.repeat(64);

  constructor(
    private readonly sessionsRepository: SessionsRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly revocationService: RevocationService,
    private readonly clock: ClockService,
    private readonly auditService: AuditService,
  ) {}

  async issue({
    userId,
    userAgent,
    linked,
  }: {
    userId: string;
    userAgent?: string | null;
    linked: boolean;
  }): Promise<IIssuedSession> {
    const id = generateUuid();
    const secret = this.generateSecret();
    // * Hard cap only for linked accounts (they can re-auth); guests stay capless on the sliding idle window.
    const chainExpiresAt = linked
      ? new Date(this.clock.epochMillis() + env.REFRESH_TOKEN_HARD_CAP_SECONDS * 1000)
      : null;

    const session = await this.sessionsRepository.save(
      this.sessionsRepository.create({
        id,
        userId,
        familyId: id,
        tokenHash: this.hashSecret(secret),
        expiresAt: this.nextExpiry({ chainExpiresAt }),
        chainExpiresAt,
        userAgent: this.normalizeUserAgent(userAgent),
      }),
    );

    await this.enforceFamilyCap({ userId });

    return { session, refreshToken: this.buildRefreshToken({ sessionId: id, secret }) };
  }

  async rotate({ refreshToken }: { refreshToken: string }): Promise<IIssuedSession> {
    const parsed = this.parseRefreshToken(refreshToken);

    const outcome = await this.dataSource.transaction<RotateOutcome>(async (manager) => {
      const session = parsed
        ? await manager.findOne(Session, { where: { id: parsed.sessionId }, lock: { mode: 'pessimistic_write' } })
        : null;

      if (!session || !parsed) {
        this.secretMatches({ secret: '', tokenHash: this.dummyHash });
        return { status: 'invalid' };
      }

      if (!this.secretMatches({ secret: parsed.secret, tokenHash: session.tokenHash })) {
        return { status: 'invalid' };
      }

      if (session.revokedAt) {
        return { status: 'reuse', familyId: session.familyId, userId: session.userId };
      }

      if (session.expiresAt.getTime() <= this.clock.epochMillis()) {
        return { status: 'invalid' };
      }

      const successorId = generateUuid();
      const secret = this.generateSecret();

      const successor = await manager.save(
        manager.create(Session, {
          id: successorId,
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: this.hashSecret(secret),
          // * Carry the chain's absolute deadline unchanged; the new idle window is clamped to it.
          expiresAt: this.nextExpiry({ chainExpiresAt: session.chainExpiresAt }),
          chainExpiresAt: session.chainExpiresAt,
          userAgent: session.userAgent,
        }),
      );

      await manager.update(Session, { id: session.id }, { revokedAt: this.clock.date(), rotatedToId: successorId });

      return {
        status: 'rotated',
        session: successor,
        refreshToken: this.buildRefreshToken({ sessionId: successorId, secret }),
        revokedSessionId: session.id,
      };
    });

    if (outcome.status === 'reuse') {
      // ! Own transaction: throwing inside the read transaction would roll the revoke back.
      await this.revokeFamily({ familyId: outcome.familyId });
      await this.revocationService.revokeFamily({ familyId: outcome.familyId });
      this.onReuseDetected({ familyId: outcome.familyId, userId: outcome.userId });

      throw new AppUnauthorizedException({
        code: ExceptionCode.RefreshTokenReuseDetected,
        message: 'Refresh token reuse detected.',
      });
    }

    if (outcome.status === 'invalid') {
      throw this.invalidRefreshToken();
    }

    await this.revocationService.revokeSession({ sessionId: outcome.revokedSessionId });

    return { session: outcome.session, refreshToken: outcome.refreshToken };
  }

  async revoke({ sessionId }: { sessionId: string }): Promise<void> {
    await this.sessionsRepository.update({ id: sessionId, revokedAt: IsNull() }, { revokedAt: this.clock.date() });
    await this.revocationService.revokeSession({ sessionId });

    await this.auditService.record({
      action: AuditAction.AuthSessionRevoked,
      subjectType: AuditSubjectType.Session,
      subjectId: sessionId,
    });
  }

  async revokeAllForUser({ userId }: { userId: string }): Promise<void> {
    const active = await this.sessionsRepository.find({
      where: { userId, revokedAt: IsNull() },
      select: { familyId: true },
    });
    const familyIds = [...new Set(active.map((session) => session.familyId))];

    for (const familyId of familyIds) {
      await this.revokeFamily({ familyId });
      await this.revocationService.revokeFamily({ familyId });
    }
  }

  async verifyForStepUp({ refreshToken }: { refreshToken: string }): Promise<{ userId: string; sessionId: string }> {
    const parsed = this.parseRefreshToken(refreshToken);
    const session = parsed ? await this.sessionsRepository.findOne({ where: { id: parsed.sessionId } }) : null;

    if (!session || !parsed) {
      this.secretMatches({ secret: '', tokenHash: this.dummyHash });
      throw this.invalidRefreshToken();
    }

    if (!this.secretMatches({ secret: parsed.secret, tokenHash: session.tokenHash })) {
      throw this.invalidRefreshToken();
    }

    if (session.revokedAt) {
      // ! An already-revoked session is reuse, not a generic invalid token: kill the family and surface the reuse code.
      await this.revokeFamily({ familyId: session.familyId });
      await this.revocationService.revokeFamily({ familyId: session.familyId });
      this.onReuseDetected({ familyId: session.familyId, userId: session.userId });

      throw new AppUnauthorizedException({
        code: ExceptionCode.RefreshTokenReuseDetected,
        message: 'Refresh token reuse detected.',
      });
    }

    if (session.expiresAt.getTime() <= this.clock.epochMillis()) {
      throw this.invalidRefreshToken();
    }

    return { userId: session.userId, sessionId: session.id };
  }

  private async revokeFamily({ familyId }: { familyId: string }): Promise<void> {
    await this.sessionsRepository.update({ familyId, revokedAt: IsNull() }, { revokedAt: this.clock.date() });
  }

  private async enforceFamilyCap({ userId }: { userId: string }): Promise<void> {
    const activeSessions = await this.sessionsRepository.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(this.clock.date()) },
      order: { createdAt: 'ASC' },
      select: { familyId: true, createdAt: true },
    });

    const familyIds = [...new Set(activeSessions.map((session) => session.familyId))];
    const excess = familyIds.length - MAX_ACTIVE_FAMILIES_PER_USER;

    if (excess <= 0) {
      return;
    }

    for (const familyId of familyIds.slice(0, excess)) {
      await this.revokeFamily({ familyId });
      await this.revocationService.revokeFamily({ familyId });
    }
  }

  private onReuseDetected({ familyId, userId }: { familyId: string; userId: string }): void {
    this.logger.warn(`Refresh token reuse detected; family revoked (family_id=${familyId}, user_id=${userId})`);
  }

  private parseRefreshToken(refreshToken: string): { sessionId: string; secret: string } | null {
    const [sessionId, secret, ...rest] = refreshToken.split(REFRESH_TOKEN_SEPARATOR);

    if (!sessionId || !secret || rest.length > 0 || !isUuid(sessionId)) {
      return null;
    }

    return { sessionId, secret };
  }

  private secretMatches({ secret, tokenHash }: { secret: string; tokenHash: string }): boolean {
    const computed = Buffer.from(this.hashSecret(secret), 'hex');
    const stored = Buffer.from(tokenHash, 'hex');

    if (computed.length !== stored.length) {
      return false;
    }

    return timingSafeEqual(computed, stored);
  }

  private generateSecret(): string {
    return randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(`${secret}${env.REFRESH_TOKEN_PEPPER}`).digest('hex');
  }

  private nextExpiry({ chainExpiresAt }: { chainExpiresAt: Date | null }): Date {
    const idleExpiry = this.clock.epochMillis() + env.REFRESH_TOKEN_TTL_SECONDS * 1000;

    if (chainExpiresAt && chainExpiresAt.getTime() < idleExpiry) {
      return new Date(chainExpiresAt.getTime());
    }

    return new Date(idleExpiry);
  }

  private buildRefreshToken({ sessionId, secret }: { sessionId: string; secret: string }): string {
    return `${sessionId}${REFRESH_TOKEN_SEPARATOR}${secret}`;
  }

  private normalizeUserAgent(userAgent?: string | null): string | null {
    if (!userAgent) {
      return null;
    }

    return userAgent.slice(0, MAX_USER_AGENT_LENGTH);
  }

  private invalidRefreshToken(): AppUnauthorizedException {
    return new AppUnauthorizedException({
      code: ExceptionCode.InvalidRefreshToken,
      message: 'Invalid refresh token.',
    });
  }
}
