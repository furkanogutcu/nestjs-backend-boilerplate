import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';

import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { generateUuid } from '@shared/utils/uuid.util';

import { PermissionRecord } from '../../../auth/rbac/entities/permission.entity';
import { Role } from '../../../auth/rbac/entities/role.entity';
import { RolePermission } from '../../../auth/rbac/entities/role-permission.entity';
import { UserRole } from '../../../auth/rbac/entities/user-role.entity';
import { UserPermissionsService } from '../../../auth/rbac/services/user-permissions.service';

export interface IRoleWithPermissions {
  role: Role;
  permissions: string[];
}

@Injectable()
export class AdminRolesService {
  constructor(
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(RolePermission) private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(PermissionRecord) private readonly permissions: Repository<PermissionRecord>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    private readonly userPermissions: UserPermissionsService,
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
  ) {}

  async listPermissions(): Promise<PermissionRecord[]> {
    return await this.permissions.find({ where: { retiredAt: IsNull() }, order: { name: 'ASC' } });
  }

  async list(): Promise<IRoleWithPermissions[]> {
    const roles = await this.roles.find({ order: { name: 'ASC' } });
    const grants = await this.rolePermissions.find();

    return roles.map((role) => ({
      role,
      permissions: grants.filter((grant) => grant.roleId === role.id).map((grant) => grant.permissionName),
    }));
  }

  async get({ roleId }: { roleId: string }): Promise<IRoleWithPermissions> {
    const role = await this.requireRole(roleId);
    const grants = await this.rolePermissions.find({ where: { roleId } });

    return { role, permissions: grants.map((grant) => grant.permissionName) };
  }

  async create(params: {
    name: string;
    description?: string;
    permissions: string[];
    actorUserId: string;
  }): Promise<IRoleWithPermissions> {
    const { name, description, permissions, actorUserId } = params;
    await this.assertNameAvailable({ name });
    await this.assertPermissionsExist({ permissions });

    const role = { id: generateUuid(), name, description: description ?? null, isSystem: false };

    await this.databaseService.runInTransaction(async (manager) => {
      await manager.insert(Role, role);
      await this.replaceGrants({ manager, roleId: role.id, permissions });
      await this.auditService.record({
        action: AuditAction.AdminRoleCreated,
        actorUserId,
        subjectType: AuditSubjectType.Role,
        subjectId: role.id,
        metadata: { name, permissions },
        manager,
      });
    });

    return await this.get({ roleId: role.id });
  }

  async update(params: {
    roleId: string;
    name?: string;
    description?: string | null;
    permissions?: string[];
    actorUserId: string;
  }): Promise<IRoleWithPermissions> {
    const { roleId, name, description, permissions, actorUserId } = params;
    const role = await this.requireRole(roleId);

    // ! A system role is the last way back in; the API that broke the configuration must not be able to narrow it.
    if (role.isSystem) {
      throw new AppForbiddenException({ message: 'System roles cannot be modified.' });
    }

    if (name && name !== role.name) {
      await this.assertNameAvailable({ name });
    }

    if (permissions) {
      await this.assertPermissionsExist({ permissions });
    }

    await this.databaseService.runInTransaction(async (manager) => {
      if (name !== undefined || description !== undefined) {
        await manager.update(
          Role,
          { id: roleId },
          { ...(name && { name }), ...(description !== undefined && { description }) },
        );
      }

      if (permissions) {
        await this.replaceGrants({ manager, roleId, permissions });
      }

      await this.auditService.record({
        action: AuditAction.AdminRoleUpdated,
        actorUserId,
        subjectType: AuditSubjectType.Role,
        subjectId: roleId,
        metadata: { name, description, permissions },
        manager,
      });
    });

    await this.invalidateHolders({ roleId });

    return await this.get({ roleId });
  }

  async remove({ roleId, actorUserId }: { roleId: string; actorUserId: string }): Promise<void> {
    const role = await this.requireRole(roleId);

    if (role.isSystem) {
      throw new AppForbiddenException({ message: 'System roles cannot be deleted.' });
    }

    const holders = await this.userRoles.find({ where: { roleId }, select: { userId: true } });

    await this.databaseService.runInTransaction(async (manager) => {
      // * user_roles and role_permissions cascade on the foreign key, so deleting the role is enough.
      await manager.delete(Role, { id: roleId });
      await this.auditService.record({
        action: AuditAction.AdminRoleDeleted,
        actorUserId,
        subjectType: AuditSubjectType.Role,
        subjectId: roleId,
        metadata: { name: role.name, holderCount: holders.length },
        manager,
      });
    });

    await Promise.all(holders.map(async ({ userId }) => await this.userPermissions.invalidate({ userId })));
  }

  private async replaceGrants(params: {
    manager: EntityManager;
    roleId: string;
    permissions: string[];
  }): Promise<void> {
    const { manager, roleId, permissions } = params;

    await manager.delete(RolePermission, { roleId });

    if (permissions.length > 0) {
      await manager.insert(
        RolePermission,
        permissions.map((permissionName) => ({ roleId, permissionName })),
      );
    }
  }

  // ! Drop every holder's cached set, or a narrowed role keeps working for the whole cache TTL.
  private async invalidateHolders({ roleId }: { roleId: string }): Promise<void> {
    const holders = await this.userRoles.find({ where: { roleId }, select: { userId: true } });

    await Promise.all(holders.map(async ({ userId }) => await this.userPermissions.invalidate({ userId })));
  }

  private async requireRole(roleId: string): Promise<Role> {
    const role = await this.roles.findOne({ where: { id: roleId } });

    if (!role) {
      throw new AppNotFoundException({ resourceName: 'Role' });
    }

    return role;
  }

  private async assertNameAvailable({ name }: { name: string }): Promise<void> {
    if (await this.roles.findOne({ where: { name }, select: { id: true } })) {
      throw new AppConflictException({ conflictedFields: ['name'], message: 'A role with this name already exists.' });
    }
  }

  private async assertPermissionsExist({ permissions }: { permissions: string[] }): Promise<void> {
    if (permissions.length === 0) {
      return;
    }

    const found = await this.permissions.find({ where: { name: In(permissions), retiredAt: IsNull() } });

    if (found.length !== new Set(permissions).size) {
      throw new AppConflictException({
        conflictedFields: ['permissions'],
        message: 'One or more permissions do not exist or have been retired.',
      });
    }
  }
}
