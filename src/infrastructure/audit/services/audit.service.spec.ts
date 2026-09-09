import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';

import { AuditAction, AuditSubjectType } from '../audit-action.enum';
import { AuditEvent } from '../entities/audit-event.entity';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  let auditEvents: DeepMocked<Repository<AuditEvent>>;
  let service: AuditService;

  beforeEach(() => {
    auditEvents = createMock<Repository<AuditEvent>>();
    service = new AuditService(auditEvents);
  });

  it('records an event with its actor, subject and context', async () => {
    await service.record({
      action: AuditAction.AuthLoginSucceeded,
      actorUserId: 'user-1',
      subjectType: AuditSubjectType.User,
      subjectId: 'user-1',
      metadata: { reason: 'password' },
      ipAddress: '203.0.113.7',
      requestId: 'req-1',
    });

    expect(auditEvents.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.AuthLoginSucceeded,
        actorUserId: 'user-1',
        subjectType: AuditSubjectType.User,
        subjectId: 'user-1',
        metadata: { reason: 'password' },
        ipAddress: '203.0.113.7',
        requestId: 'req-1',
      }),
    );
  });

  it('generates an id for every event', async () => {
    await service.record({ action: AuditAction.AuthLogout });

    const [row] = auditEvents.insert.mock.calls[0] as unknown as [{ id: string }];
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('defaults the optional context to null rather than leaving it undefined', async () => {
    await service.record({ action: AuditAction.AuthLogout });

    expect(auditEvents.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: null,
        subjectType: null,
        subjectId: null,
        metadata: null,
        ipAddress: null,
        requestId: null,
      }),
    );
  });

  it('swallows a write failure on the best-effort path so the request still succeeds', async () => {
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    auditEvents.insert.mockRejectedValue(new Error('database down'));

    await expect(service.record({ action: AuditAction.AuthLoginSucceeded })).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });

  it('writes through the caller transaction when a manager is supplied', async () => {
    const manager = createMock<EntityManager>();

    await service.record({ action: AuditAction.AdminRoleGranted, manager });

    expect(manager.insert).toHaveBeenCalledWith(AuditEvent, expect.objectContaining({ action: 'admin.role.granted' }));
    expect(auditEvents.insert).not.toHaveBeenCalled();
  });

  it('lets a transactional write fail so the caller can roll back', async () => {
    const manager = createMock<EntityManager>();
    manager.insert.mockRejectedValue(new Error('constraint violation'));

    await expect(service.record({ action: AuditAction.AdminRoleGranted, manager })).rejects.toThrow(
      'constraint violation',
    );
  });
});
