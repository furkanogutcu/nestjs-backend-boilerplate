import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { FindOptionsWhere } from 'typeorm';

import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermission } from '@modules/auth/rbac/decorators/require-permission.decorator';
import { Permission } from '@modules/auth/rbac/permission.enum';
import { OffsetPagination } from '@shared/decorators/offset-pagination.decorator';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';
import type { SearchParams } from '@shared/decorators/search.decorator';
import { Search } from '@shared/decorators/search.decorator';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';
import type { OffsetPaginationParams } from '@shared/schemas/offset-pagination.schema';

import { User } from '../../auth/entities/user.entity';
import type { AssignRoleRequest, SuspendUserRequest } from './schemas/admin-user.request';
import {
  AdminUserResponse,
  adminUserResponseSchema,
  AdminUserSummary,
  adminUserSummarySchema,
} from './schemas/admin-user.response';
import { AdminUsersService } from './services/admin-users.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @RequirePermission(Permission.UsersRead)
  @ApiOperation({ summary: 'List users', description: 'Paginated user list with optional search and status filter.' })
  @ApiQuery({ name: 'suspended', required: false, type: Boolean, description: 'Filter by suspension state.' })
  @ResponseDto({
    schema: adminUserSummarySchema,
    offsetPaginated: true,
    description: 'A page of user summaries.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN],
  })
  async list(
    @OffsetPagination() pagination: OffsetPaginationParams,
    @Search<User>(['id', 'email', 'displayName']) search: SearchParams<User>,
    @Query('suspended') suspended?: string,
  ): Promise<OffsetPaginated<AdminUserSummary>> {
    const page = await this.adminUsersService.list({
      skip: pagination.skip,
      take: pagination.take,
      // * SearchParams types each clause as a FindOperator over the column, which is exactly what TypeORM
      // * receives; the two type shapes only differ on non-string columns the search never touches.
      search: search as FindOptionsWhere<User>[] | undefined,
      suspended: suspended === undefined ? undefined : suspended === 'true',
    });

    return new OffsetPaginated(
      page.items.map((user) => this.toSummary(user)),
      page.meta,
    );
  }

  @Get(':userId')
  @RequirePermission(Permission.UsersRead)
  @ApiOperation({ summary: 'Get a user', description: 'Full user record including the roles granted to them.' })
  @ResponseDto({
    schema: adminUserResponseSchema,
    description: 'The user and their roles.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND],
  })
  async get(@Param('userId', ParseUUIDPipe) userId: string): Promise<AdminUserResponse> {
    const { user, roles } = await this.adminUsersService.get({ userId });

    return {
      ...this.toSummary(user),
      must_change_password: user.mustChangePassword,
      last_seen_at: user.lastSeenAt?.toISOString() ?? null,
      roles: roles.map((role) => ({ id: role.id, name: role.name })),
    };
  }

  @Post(':userId/suspension')
  @RequirePermission(Permission.UsersSuspend)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Suspend a user',
    description: 'Blocks sign-in and ends every existing session. Recorded in the audit log.',
  })
  async suspend(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: SuspendUserRequest,
    @CurrentUser() actor: { id: string },
  ): Promise<void> {
    await this.adminUsersService.suspend({ userId, actorUserId: actor.id, reason: body.reason });
  }

  @Delete(':userId/suspension')
  @RequirePermission(Permission.UsersSuspend)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Restore a user', description: 'Lifts a suspension. Recorded in the audit log.' })
  async restore(@Param('userId', ParseUUIDPipe) userId: string, @CurrentUser() actor: { id: string }): Promise<void> {
    await this.adminUsersService.restore({ userId, actorUserId: actor.id });
  }

  @Delete(':userId/sessions')
  @RequirePermission(Permission.UserSessionsRevoke)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Revoke a user's sessions",
    description: 'Signs the user out everywhere without suspending the account.',
  })
  async revokeSessions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: { id: string },
  ): Promise<void> {
    await this.adminUsersService.revokeSessions({ userId, actorUserId: actor.id });
  }

  @Post(':userId/roles')
  @RequirePermission(Permission.RolesAssign)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Grant a role', description: 'Idempotent. Recorded in the audit log.' })
  async assignRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: AssignRoleRequest,
    @CurrentUser() actor: { id: string },
  ): Promise<void> {
    await this.adminUsersService.assignRole({ userId, roleId: body.role_id, actorUserId: actor.id });
  }

  @Delete(':userId/roles/:roleId')
  @RequirePermission(Permission.RolesAssign)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a role', description: 'Recorded in the audit log.' })
  async revokeRole(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @CurrentUser() actor: { id: string },
  ): Promise<void> {
    await this.adminUsersService.revokeRole({ userId, roleId, actorUserId: actor.id });
  }

  private toSummary(user: User): AdminUserSummary {
    return {
      id: user.id,
      email: user.email,
      display_name: user.displayName,
      is_anonymous: user.isAnonymous,
      is_email_verified: user.emailVerifiedAt !== null,
      suspended_at: user.suspendedAt?.toISOString() ?? null,
      created_at: user.createdAt.toISOString(),
    };
  }
}
