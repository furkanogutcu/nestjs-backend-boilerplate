import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';

import { AuditAction, AuditSubjectType } from '@infrastructure/audit/audit-action.enum';
import { AuditService } from '@infrastructure/audit/services/audit.service';
import { ClockService } from '@infrastructure/clock/clock.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { AppConflictException } from '@shared/exceptions/conflict.exception';
import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';

import { User } from '../../../auth/entities/user.entity';
import { Role } from '../../../auth/rbac/entities/role.entity';
import { UserRole } from '../../../auth/rbac/entities/user-role.entity';
import { UserPermissionsService } from '../../../auth/rbac/services/user-permissions.service';
import { SessionService } from '../../../auth/services/session.service';

export interface IAdminUserView {
  user: User;
  roles: Role[];
}

@Injectable()
export class AdminUsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRoles: Repository<UserRole>,
    private readonly sessionService: SessionService,
    private readonly userPermissions: UserPermissionsService,
    private readonly databaseService: DatabaseService,
    private readonly auditService: AuditService,
    private readonly clock: ClockService,
  ) {}

  async list(params: {
    skip: number;
    take: number;
    search?: FindOptionsWhere<User>[];
    suspended?: boolean;
  }): Promise<OffsetPaginated<User>> {
    const { skip, take, search, suspended } = params;
    const suspensionFilter: FindOptionsWhere<User> | undefined =
      suspended === undefined ? undefined : { suspendedAt: suspended ? Not(IsNull()) : IsNull() };

    // ! Search ORs one clause per column, so every clause must repeat the suspension filter.
    const where = search
      ? search.map((clause) => ({ ...clause, ...suspensionFilter }))
      : suspensionFilter && [suspensionFilter];

    return await this.users.listWithOffsetPagination({ where, skip, take, order: { createdAt: 'DESC' } });
  }

  async get({ userId }: { userId: string }): Promise<IAdminUserView> {
    const user = await this.users.findOne({ where: { id: userId } });

    if (!user) {
      throw new AppNotFoundException({ resourceName: 'User' });
    }

    return { user, roles: await this.rolesOf(userId) };
  }

  // ! Suspending must also end existing sessions, or the account keeps working until its refresh token expires.
  async suspend(params: { userId: string; actorUserId: string; reason?: string }): Promise<void> {
    const { userId, actorUserId, reason } = params;
    const result = await this.users.update({ id: userId, suspendedAt: IsNull() }, { suspendedAt: this.clock.date() });

    if ((result.affected ?? 0) === 0) {
      throw new AppConflictException({ conflictedFields: ['suspendedAt'], message: 'User is already suspended.' });
    }

    await this.sessionService.revokeAllForUser({ userId });
    await this.auditService.record({
      action: AuditAction.AdminUserSuspended,
      actorUserId,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
      metadata: reason ? { reason } : undefined,
    });
  }

  async restore({ userId, actorUserId }: { userId: string; actorUserId: string }): Promise<void> {
    const result = await this.users.update({ id: userId, suspendedAt: Not(IsNull()) }, { suspendedAt: null });

    if ((result.affected ?? 0) === 0) {
      throw new AppConflictException({ conflictedFields: ['suspendedAt'], message: 'User is not suspended.' });
    }

    await this.auditService.record({
      action: AuditAction.AdminUserRestored,
      actorUserId,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
    });
  }

  async revokeSessions({ userId, actorUserId }: { userId: string; actorUserId: string }): Promise<void> {
    await this.requireUser(userId);
    await this.sessionService.revokeAllForUser({ userId });

    await this.auditService.record({
      action: AuditAction.AdminUserSessionsRevoked,
      actorUserId,
      subjectType: AuditSubjectType.User,
      subjectId: userId,
    });
  }

  async assignRole(params: { userId: string; roleId: string; actorUserId: string }): Promise<void> {
    const { userId, roleId, actorUserId } = params;
    await this.requireUser(userId);
    const role = await this.requireRole(roleId);

    await this.databaseService.runInTransaction(async (manager) => {
      await manager.upsert(UserRole, { userId, roleId }, ['userId', 'roleId']);
      await this.auditService.record({
        action: AuditAction.AdminRoleGranted,
        actorUserId,
        subjectType: AuditSubjectType.User,
        subjectId: userId,
        metadata: { roleId, roleName: role.name },
        manager,
      });
    });

    await this.userPermissions.invalidate({ userId });
  }

  async revokeRole(params: { userId: string; roleId: string; actorUserId: string }): Promise<void> {
    const { userId, roleId, actorUserId } = params;
    const role = await this.requireRole(roleId);

    await this.databaseService.runInTransaction(async (manager) => {
      const result = await manager.delete(UserRole, { userId, roleId });

      if ((result.affected ?? 0) === 0) {
        throw new AppNotFoundException({ resourceName: 'Role assignment' });
      }

      await this.auditService.record({
        action: AuditAction.AdminRoleRevoked,
        actorUserId,
        subjectType: AuditSubjectType.User,
        subjectId: userId,
        metadata: { roleId, roleName: role.name },
        manager,
      });
    });

    await this.userPermissions.invalidate({ userId });
  }

  async rolesOf(userId: string): Promise<Role[]> {
    const assignments = await this.userRoles.find({ where: { userId }, select: { roleId: true } });

    if (assignments.length === 0) {
      return [];
    }

    return await this.roles.find({ where: assignments.map((assignment) => ({ id: assignment.roleId })) });
  }

  private async requireUser(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId }, select: { id: true } });

    if (!user) {
      throw new AppNotFoundException({ resourceName: 'User' });
    }

    return user;
  }

  private async requireRole(roleId: string): Promise<Role> {
    const role = await this.roles.findOne({ where: { id: roleId } });

    if (!role) {
      throw new AppNotFoundException({ resourceName: 'Role' });
    }

    return role;
  }
}
