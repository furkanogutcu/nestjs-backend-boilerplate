import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

import { AuditAction } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';

import { User } from '../../entities/user.entity';
import { SessionService } from '../../services/session.service';
import { AccountDeletionService } from './account-deletion.service';

const NOW = new Date('2026-02-01T00:00:00.000Z');
const GRACE_DAYS = 30;

describe('AccountDeletionService', () => {
  let users: DeepMocked<Repository<User>>;
  let sessionService: DeepMocked<SessionService>;
  let auditService: DeepMocked<AuditService>;
  let service: AccountDeletionService;

  beforeEach(() => {
    users = createMock<Repository<User>>();
    sessionService = createMock<SessionService>();
    auditService = createMock<AuditService>();
    const clock = createMock<ClockService>();
    clock.date.mockReturnValue(NOW);
    clock.epochMillis.mockReturnValue(NOW.getTime());

    users.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });
    users.findOne.mockResolvedValue({ id: 'u1', deletionRequestedAt: NOW } as User);
    users.find.mockResolvedValue([]);

    service = new AccountDeletionService(users, sessionService, auditService, clock);
  });

  describe('request', () => {
    it('schedules erasure for the end of the grace period and records the request', async () => {
      await expect(service.request({ userId: 'u1' })).resolves.toEqual({
        requestedAt: NOW,
        scheduledFor: new Date(NOW.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000),
      });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AccountDeletionRequested }),
      );
    });

    it('leaves the account usable so the request can be withdrawn', async () => {
      await service.request({ userId: 'u1' });

      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects a second request while one is pending', async () => {
      users.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await expect(service.request({ userId: 'u1' })).rejects.toBeInstanceOf(AppConflictException);
    });
  });

  describe('cancel', () => {
    it('clears the request and records it', async () => {
      await service.cancel({ userId: 'u1' });

      expect(users.update).toHaveBeenCalledWith(expect.anything(), { deletionRequestedAt: null });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AccountDeletionCancelled }),
      );
    });

    it('rejects a withdrawal when nothing is pending', async () => {
      users.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await expect(service.cancel({ userId: 'u1' })).rejects.toBeInstanceOf(AppConflictException);
    });
  });

  describe('status', () => {
    it('reports no schedule when nothing is pending', async () => {
      users.findOne.mockResolvedValue({ id: 'u1', deletionRequestedAt: null } as User);

      await expect(service.status({ userId: 'u1' })).resolves.toEqual({ requestedAt: null, scheduledFor: null });
    });
  });

  describe('erase', () => {
    it('revokes sessions, records the erasure before deleting, and deletes the row', async () => {
      await service.erase({ userId: 'u1' });

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith({ userId: 'u1' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AccountErased, subjectId: 'u1' }),
      );
      expect(users.delete).toHaveBeenCalledWith({ id: 'u1' });
    });

    it('records the erasure without naming an actor, since the account is gone', async () => {
      await service.erase({ userId: 'u1' });

      const [call] = auditService.record.mock.calls.at(-1) as unknown as [{ actorUserId?: string }];
      expect(call.actorUserId).toBeUndefined();
    });
  });

  describe('eraseExpired', () => {
    it('erases only accounts past the grace period', async () => {
      users.find.mockResolvedValue([{ id: 'u1' } as User, { id: 'u2' } as User]);

      await expect(service.eraseExpired()).resolves.toBe(2);
      expect(users.delete).toHaveBeenCalledTimes(2);
    });

    it('keeps going when one account fails to erase', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      users.find.mockResolvedValue([{ id: 'u1' } as User, { id: 'u2' } as User]);
      users.delete.mockRejectedValueOnce(new Error('constraint')).mockResolvedValue({ affected: 1, raw: [] });

      await expect(service.eraseExpired()).resolves.toBe(1);
    });

    it('does nothing when no request has matured', async () => {
      await expect(service.eraseExpired()).resolves.toBe(0);
      expect(users.delete).not.toHaveBeenCalled();
    });
  });
});
