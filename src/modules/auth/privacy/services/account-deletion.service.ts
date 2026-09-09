import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';

import { env } from '@config/env.config';
import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';

import { User } from '../../entities/user.entity';
import { SessionService } from '../../services/session.service';

export interface IDeletionStatus {
  requestedAt: Date | null;
  scheduledFor: Date | null;
}

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly sessionService: SessionService,
    private readonly auditService: AuditService,
    private readonly clock: ClockService,
  ) {}

  async request({ userId }: { userId: string }): Promise<IDeletionStatus> {
    const result = await this.users.update(
      { id: userId, deletionRequestedAt: IsNull() },
      { deletionRequestedAt: this.clock.date() },
    );

    if ((result.affected ?? 0) === 0) {
      throw new AppConflictException({
        conflictedFields: ['deletionRequestedAt'],
        message: 'Deletion has already been requested for this account.',
      });
    }

    await this.auditService.record({
      action: AuditAction.AccountDeletionRequested,
      actorUserId: userId,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
      metadata: { graceDays: env.ACCOUNT_DELETION_GRACE_DAYS },
    });

    return await this.status({ userId });
  }

  async cancel({ userId }: { userId: string }): Promise<void> {
    const result = await this.users.update(
      { id: userId, deletionRequestedAt: Not(IsNull()) },
      { deletionRequestedAt: null },
    );

    if ((result.affected ?? 0) === 0) {
      throw new AppConflictException({
        conflictedFields: ['deletionRequestedAt'],
        message: 'No deletion request is pending for this account.',
      });
    }

    await this.auditService.record({
      action: AuditAction.AccountDeletionCancelled,
      actorUserId: userId,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
    });
  }

  async status({ userId }: { userId: string }): Promise<IDeletionStatus> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true, deletionRequestedAt: true } });
    const requestedAt = user?.deletionRequestedAt ?? null;

    return { requestedAt, scheduledFor: requestedAt ? this.scheduledFor(requestedAt) : null };
  }

  async eraseExpired(): Promise<number> {
    const cutoff = new Date(this.clock.epochMillis() - env.ACCOUNT_DELETION_GRACE_DAYS * MILLISECONDS_PER_DAY);
    const due = await this.users.find({
      where: { deletionRequestedAt: LessThanOrEqual(cutoff) },
      select: { id: true },
    });

    let erased = 0;

    for (const user of due) {
      try {
        await this.erase({ userId: user.id });
        erased += 1;
      } catch (error) {
        this.logger.error(
          `Failed to erase account ${user.id}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return erased;
  }

  // ! Irreversible. The audit row is written BEFORE the delete and carries no personal data.
  async erase({ userId }: { userId: string }): Promise<void> {
    await this.sessionService.revokeAllForUser({ userId });

    await this.auditService.record({
      action: AuditAction.AccountErased,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
    });

    // * Sessions, OAuth links, MFA credentials and role assignments all cascade from the user row.
    await this.users.delete({ id: userId });

    this.logger.log(`Erased account ${userId}`);
  }

  private scheduledFor(requestedAt: Date): Date {
    return new Date(requestedAt.getTime() + env.ACCOUNT_DELETION_GRACE_DAYS * MILLISECONDS_PER_DAY);
  }
}
