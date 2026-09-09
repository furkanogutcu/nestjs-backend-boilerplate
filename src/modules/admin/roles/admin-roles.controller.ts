import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermission } from '@modules/auth/rbac/decorators/require-permission.decorator';
import { Permission } from '@modules/auth/rbac/permission.enum';
import { ResponseDto } from '@shared/decorators/response-dto.decorator';

import type { CreateRoleRequest, UpdateRoleRequest } from './schemas/admin-role.request';
import {
  AdminPermissionResponse,
  adminPermissionResponseSchema,
  AdminRoleResponse,
  adminRoleResponseSchema,
} from './schemas/admin-role.response';
import { AdminRolesService, IRoleWithPermissions } from './services/admin-roles.service';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
export class AdminRolesController {
  constructor(private readonly adminRolesService: AdminRolesService) {}

  @Get('permissions')
  @RequirePermission(Permission.RolesRead)
  @ApiOperation({
    summary: 'List permissions',
    description: 'The permissions this build enforces — the pick list for building a role.',
  })
  @ResponseDto({
    schema: adminPermissionResponseSchema,
    description: 'Every permission still declared in code.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN],
  })
  async listPermissions(): Promise<AdminPermissionResponse[]> {
    return (await this.adminRolesService.listPermissions()).map((permission) => ({
      name: permission.name,
      description: permission.description,
    }));
  }

  @Get('roles')
  @RequirePermission(Permission.RolesRead)
  @ApiOperation({ summary: 'List roles', description: 'Every role with the permissions it grants.' })
  @ResponseDto({
    schema: adminRoleResponseSchema,
    description: 'All roles.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN],
  })
  async list(): Promise<AdminRoleResponse[]> {
    return (await this.adminRolesService.list()).map((entry) => this.toResponse(entry));
  }

  @Get('roles/:roleId')
  @RequirePermission(Permission.RolesRead)
  @ApiOperation({ summary: 'Get a role' })
  @ResponseDto({
    schema: adminRoleResponseSchema,
    description: 'The role and its permissions.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND],
  })
  async get(@Param('roleId', ParseUUIDPipe) roleId: string): Promise<AdminRoleResponse> {
    return this.toResponse(await this.adminRolesService.get({ roleId }));
  }

  @Post('roles')
  @RequirePermission(Permission.RolesWrite)
  @ApiOperation({ summary: 'Create a role', description: 'Recorded in the audit log.' })
  @ResponseDto({
    schema: adminRoleResponseSchema,
    status: HttpStatus.CREATED,
    description: 'The created role.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.CONFLICT],
  })
  async create(@Body() body: CreateRoleRequest, @CurrentUser() actor: { id: string }): Promise<AdminRoleResponse> {
    return this.toResponse(
      await this.adminRolesService.create({
        name: body.name,
        description: body.description,
        permissions: body.permissions,
        actorUserId: actor.id,
      }),
    );
  }

  @Patch('roles/:roleId')
  @RequirePermission(Permission.RolesWrite)
  @ApiOperation({
    summary: 'Update a role',
    description: 'Supplying `permissions` replaces the whole set. System roles are rejected.',
  })
  @ResponseDto({
    schema: adminRoleResponseSchema,
    description: 'The updated role.',
    errors: [HttpStatus.UNAUTHORIZED, HttpStatus.FORBIDDEN, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT],
  })
  async update(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() body: UpdateRoleRequest,
    @CurrentUser() actor: { id: string },
  ): Promise<AdminRoleResponse> {
    return this.toResponse(
      await this.adminRolesService.update({
        roleId,
        name: body.name,
        description: body.description,
        permissions: body.permissions,
        actorUserId: actor.id,
      }),
    );
  }

  @Delete('roles/:roleId')
  @RequirePermission(Permission.RolesWrite)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role', description: 'System roles are rejected. Recorded in the audit log.' })
  async remove(@Param('roleId', ParseUUIDPipe) roleId: string, @CurrentUser() actor: { id: string }): Promise<void> {
    await this.adminRolesService.remove({ roleId, actorUserId: actor.id });
  }

  private toResponse({ role, permissions }: IRoleWithPermissions): AdminRoleResponse {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      is_system: role.isSystem,
      permissions,
    };
  }
}
