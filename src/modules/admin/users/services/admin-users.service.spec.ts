import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { EntityManager, Repository } from 'typeorm';

import { AuditAction } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { User } from '../../../auth/entities/user.entity';
import { Role } from '../../../auth/rbac/entities/role.entity';
import { UserRole } from '../../../auth/rbac/entities/user-role.entity';
import { UserPermissionsService } from '../../../auth/rbac/services/user-permissions.service';
import { SessionService } from '../../../auth/services/session.service';
import { AdminUsersService } from './admin-users.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('AdminUsersService', () => {
  let users: DeepMocked<Repository<User>>;
  let roles: DeepMocked<Repository<Role>>;
  let userRoles: DeepMocked<Repository<UserRole>>;
  let sessionService: DeepMocked<SessionService>;
  let userPermissions: DeepMocked<UserPermissionsService>;
  let databaseService: DeepMocked<DatabaseService>;
  let auditService: DeepMocked<AuditService>;
  let manager: DeepMocked<EntityManager>;
  let service: AdminUsersService;

  beforeEach(() => {
    users = createMock<Repository<User>>();
    roles = createMock<Repository<Role>>();
    userRoles = createMock<Repository<UserRole>>();
    sessionService = createMock<SessionService>();
    userPermissions = createMock<UserPermissionsService>();
    manager = createMock<EntityManager>();
    databaseService = createMock<DatabaseService>();
    databaseService.runInTransaction.mockImplementation(
      async (handler: (em: EntityManager) => Promise<unknown>) => await handler(manager),
    );
    auditService = createMock<AuditService>();
    const clock = createMock<ClockService>();
    clock.date.mockReturnValue(NOW);

    users.findOne.mockResolvedValue({ id: 'u1' } as User);
    roles.findOne.mockResolvedValue({ id: 'r1', name: 'support' } as Role);

    service = new AdminUsersService(
      users,
      roles,
      userRoles,
      sessionService,
      userPermissions,
      databaseService,
      auditService,
      clock,
    );
  });

  describe('suspend', () => {
    it('marks the account suspended, ends its sessions and records the reason', async () => {
      users.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.suspend({ userId: 'u1', actorUserId: 'admin', reason: 'abuse' });

      expect(users.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }), { suspendedAt: NOW });
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith({ userId: 'u1' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.AdminUserSuspended,
          actorUserId: 'admin',
          metadata: { reason: 'abuse' },
        }),
      );
    });

    it('rejects suspending an already-suspended account', async () => {
      users.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await expect(service.suspend({ userId: 'u1', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppConflictException,
      );
      expect(sessionService.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('lifts the suspension and records it', async () => {
      users.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

      await service.restore({ userId: 'u1', actorUserId: 'admin' });

      expect(users.update).toHaveBeenCalledWith(expect.anything(), { suspendedAt: null });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AdminUserRestored }),
      );
    });

    it('rejects restoring an account that is not suspended', async () => {
      users.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

      await expect(service.restore({ userId: 'u1', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppConflictException,
      );
    });
  });

  describe('revokeSessions', () => {
    it('signs the user out everywhere and records it', async () => {
      await service.revokeSessions({ userId: 'u1', actorUserId: 'admin' });

      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith({ userId: 'u1' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AdminUserSessionsRevoked }),
      );
    });

    it('fails for an unknown user', async () => {
      users.findOne.mockResolvedValue(null);

      await expect(service.revokeSessions({ userId: 'ghost', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });
  });

  describe('assignRole', () => {
    it('grants the role, audits it in the same transaction and drops the cached permissions', async () => {
      await service.assignRole({ userId: 'u1', roleId: 'r1', actorUserId: 'admin' });

      expect(manager.upsert).toHaveBeenCalledWith(UserRole, { userId: 'u1', roleId: 'r1' }, ['userId', 'roleId']);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AdminRoleGranted, manager }),
      );
      expect(userPermissions.invalidate).toHaveBeenCalledWith({ userId: 'u1' });
    });

    it('fails for an unknown role', async () => {
      roles.findOne.mockResolvedValue(null);

      await expect(service.assignRole({ userId: 'u1', roleId: 'ghost', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });
  });

  describe('revokeRole', () => {
    it('removes the assignment and drops the cached permissions', async () => {
      manager.delete.mockResolvedValue({ affected: 1, raw: [] });

      await service.revokeRole({ userId: 'u1', roleId: 'r1', actorUserId: 'admin' });

      expect(userPermissions.invalidate).toHaveBeenCalledWith({ userId: 'u1' });
    });

    it('fails when the user does not hold the role', async () => {
      manager.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(service.revokeRole({ userId: 'u1', roleId: 'r1', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
      expect(userPermissions.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('returns the user with the roles they hold', async () => {
      userRoles.find.mockResolvedValue([{ roleId: 'r1' } as UserRole]);
      roles.find.mockResolvedValue([{ id: 'r1', name: 'support' } as Role]);

      await expect(service.get({ userId: 'u1' })).resolves.toMatchObject({ roles: [{ name: 'support' }] });
    });

    it('returns an empty role list without querying roles', async () => {
      userRoles.find.mockResolvedValue([]);

      await expect(service.get({ userId: 'u1' })).resolves.toMatchObject({ roles: [] });
      expect(roles.find).not.toHaveBeenCalled();
    });

    it('fails for an unknown user', async () => {
      users.findOne.mockResolvedValue(null);

      await expect(service.get({ userId: 'ghost' })).rejects.toBeInstanceOf(AppNotFoundException);
    });
  });

  describe('list', () => {
    it('applies the suspension filter to every search clause', async () => {
      await service.list({ skip: 0, take: 10, search: [{ email: undefined }, { id: undefined }], suspended: true });

      const [options] = users.listWithOffsetPagination.mock.calls[0] as unknown as [{ where: object[] }];
      expect(options.where).toHaveLength(2);
      expect(options.where.every((clause) => 'suspendedAt' in clause)).toBe(true);
    });

    it('passes no filter when neither search nor status is given', async () => {
      await service.list({ skip: 0, take: 10 });

      const [options] = users.listWithOffsetPagination.mock.calls[0] as unknown as [{ where?: unknown }];
      expect(options.where).toBeUndefined();
    });
  });
});
