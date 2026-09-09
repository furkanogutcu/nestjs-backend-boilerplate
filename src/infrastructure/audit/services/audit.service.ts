import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { generateUuid } from '@shared/utils/uuid.util';

import { AuditAction, AuditSubjectType } from '../audit-action.enum';
import { AuditEvent } from '../entities/audit-event.entity';

export interface IAuditRecordParams {
  action: AuditAction;
  actorUserId?: string | null;
  subjectType?: AuditSubjectType;
  subjectId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  requestId?: string | null;
  // * Pass the caller's manager to make the audit row part of their transaction — use it when the record and
  // * the change must stand or fall together (role grants, suspensions).
  manager?: EntityManager;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditEvent) private readonly auditEvents: Repository<AuditEvent>) {}

  // ! Never let auditing break the request it describes: on the best-effort path a failed insert is logged
  // ! loudly and swallowed, because failing a completed login just to record it trades a real outage for a
  // ! record. Callers that need the record and the change to stand or fall together pass `manager`, and then
  // ! the failure is theirs to handle.
  async record(params: IAuditRecordParams): Promise<void> {
    // * insert(), never save(): save() would issue an UPDATE for an id that already exists, and this table is
    // * append-only by design. The cast is needed because TypeORM maps the jsonb column through
    // * QueryDeepPartialEntity, which does not accept an arbitrary Record<string, unknown>.
    const row = {
      id: generateUuid(),
      action: params.action,
      actorUserId: params.actorUserId ?? null,
      subjectType: params.subjectType ?? null,
      subjectId: params.subjectId ?? null,
      metadata: params.metadata ?? null,
      ipAddress: params.ipAddress ?? null,
      requestId: params.requestId ?? null,
    } as QueryDeepPartialEntity<AuditEvent>;

    if (params.manager) {
      await params.manager.insert(AuditEvent, row);

      return;
    }

    try {
      await this.auditEvents.insert(row);
    } catch (error) {
      this.logger.error(
        `Failed to record audit event ${params.action}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
