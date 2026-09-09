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
  manager?: EntityManager;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditEvent) private readonly auditEvents: Repository<AuditEvent>) {}

  // ! A failed audit insert must never fail the request it describes; callers needing atomicity pass `manager`.
  async record(params: IAuditRecordParams): Promise<void> {
    // ! insert(), never save(): save() would UPDATE an existing id and this table is append-only.
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
