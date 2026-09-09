import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { EntityManager, Repository } from 'typeorm';

import { AuditAction } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { PermissionRecord } from '../../../auth/rbac/entities/permission.entity';
import { Role } from '../../../auth/rbac/entities/role.entity';
import { RolePermission } from '../../../auth/rbac/entities/role-permission.entity';
import { UserRole } from '../../../auth/rbac/entities/user-role.entity';
import { UserPermissionsService } from '../../../auth/rbac/services/user-permissions.service';
import { AdminRolesService } from './admin-roles.service';

describe('AdminRolesService', () => {
  let roles: DeepMocked<Repository<Role>>;
  let rolePermissions: DeepMocked<Repository<RolePermission>>;
  let permissions: DeepMocked<Repository<PermissionRecord>>;
  let userRoles: DeepMocked<Repository<UserRole>>;
  let userPermissions: DeepMocked<UserPermissionsService>;
  let auditService: DeepMocked<AuditService>;
  let manager: DeepMocked<EntityManager>;
  let service: AdminRolesService;

  const customRole = { id: 'r1', name: 'support', isSystem: false } as Role;
  const systemRole = { id: 'r0', name: 'superuser', isSystem: true } as Role;

  beforeEach(() => {
    roles = createMock<Repository<Role>>();
    rolePermissions = createMock<Repository<RolePermission>>();
    permissions = createMock<Repository<PermissionRecord>>();
    userRoles = createMock<Repository<UserRole>>();
    userPermissions = createMock<UserPermissionsService>();
    auditService = createMock<AuditService>();
    manager = createMock<EntityManager>();
    const databaseService = createMock<DatabaseService>();
    databaseService.runInTransaction.mockImplementation(
      async (handler: (em: EntityManager) => Promise<unknown>) => await handler(manager),
    );

    roles.findOne.mockResolvedValue(customRole);
    rolePermissions.find.mockResolvedValue([]);
    userRoles.find.mockResolvedValue([]);
    permissions.find.mockResolvedValue([{ name: 'users:read' } as PermissionRecord]);

    service = new AdminRolesService(
      roles,
      rolePermissions,
      permissions,
      userRoles,
      userPermissions,
      databaseService,
      auditService,
    );
  });

  describe('create', () => {
    it('rejects a duplicate role name', async () => {
      roles.findOne.mockResolvedValue(customRole);

      await expect(service.create({ name: 'support', permissions: [], actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppConflictException,
      );
    });

    it('rejects a permission that does not exist', async () => {
      roles.findOne.mockResolvedValueOnce(null);
      permissions.find.mockResolvedValue([]);

      await expect(
        service.create({ name: 'new-role', permissions: ['made:up'], actorUserId: 'admin' }),
      ).rejects.toBeInstanceOf(AppConflictException);
    });

    it('creates the role, its grants and the audit record in one transaction', async () => {
      roles.findOne.mockResolvedValueOnce(null).mockResolvedValue(customRole);

      await service.create({ name: 'new-role', permissions: ['users:read'], actorUserId: 'admin' });

      expect(manager.insert).toHaveBeenCalledWith(Role, expect.objectContaining({ name: 'new-role' }));
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AdminRoleCreated, manager }),
      );
    });
  });

  describe('update', () => {
    it('refuses to modify a system role', async () => {
      roles.findOne.mockResolvedValue(systemRole);

      await expect(service.update({ roleId: 'r0', name: 'renamed', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppForbiddenException,
      );
    });

    it('replaces the permission set when one is supplied', async () => {
      await service.update({ roleId: 'r1', permissions: ['users:read'], actorUserId: 'admin' });

      expect(manager.delete).toHaveBeenCalledWith(RolePermission, { roleId: 'r1' });
      expect(manager.insert).toHaveBeenCalledWith(RolePermission, [{ roleId: 'r1', permissionName: 'users:read' }]);
    });

    it('drops the cached permissions of every holder', async () => {
      userRoles.find.mockResolvedValue([{ userId: 'u1' } as UserRole, { userId: 'u2' } as UserRole]);

      await service.update({ roleId: 'r1', permissions: [], actorUserId: 'admin' });

      expect(userPermissions.invalidate).toHaveBeenCalledWith({ userId: 'u1' });
      expect(userPermissions.invalidate).toHaveBeenCalledWith({ userId: 'u2' });
    });

    it('fails for an unknown role', async () => {
      roles.findOne.mockResolvedValue(null);

      await expect(service.update({ roleId: 'ghost', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppNotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('refuses to delete a system role', async () => {
      roles.findOne.mockResolvedValue(systemRole);

      await expect(service.remove({ roleId: 'r0', actorUserId: 'admin' })).rejects.toBeInstanceOf(
        AppForbiddenException,
      );
    });

    it('deletes the role and invalidates its holders', async () => {
      userRoles.find.mockResolvedValue([{ userId: 'u1' } as UserRole]);

      await service.remove({ roleId: 'r1', actorUserId: 'admin' });

      expect(manager.delete).toHaveBeenCalledWith(Role, { id: 'r1' });
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditAction.AdminRoleDeleted, manager }),
      );
      expect(userPermissions.invalidate).toHaveBeenCalledWith({ userId: 'u1' });
    });
  });

  describe('listPermissions', () => {
    it('offers only permissions that are still declared in code', async () => {
      await service.listPermissions();

      expect(permissions.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ retiredAt: expect.anything() }) }),
      );
    });
  });

  describe('list', () => {
    it('pairs each role with the permissions granted to it', async () => {
      roles.find.mockResolvedValue([customRole, { id: 'r2', name: 'other' } as Role]);
      rolePermissions.find.mockResolvedValue([
        { roleId: 'r1', permissionName: 'users:read' } as RolePermission,
        { roleId: 'r2', permissionName: 'audit:read' } as RolePermission,
      ]);

      await expect(service.list()).resolves.toEqual([
        { role: customRole, permissions: ['users:read'] },
        { role: { id: 'r2', name: 'other' }, permissions: ['audit:read'] },
      ]);
    });
  });
});
