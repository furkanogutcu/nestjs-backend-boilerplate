import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from '@infrastructure/database/database.module';

import { PermissionRecord } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionGuard } from './guards/permission.guard';
import { PermissionSyncService } from './services/permission-sync.service';
import { UserPermissionsService } from './services/user-permissions.service';
import { UserRolesService } from './services/user-roles.service';

@Module({
  imports: [TypeOrmModule.forFeature([PermissionRecord, Role, RolePermission, UserRole]), DatabaseModule],
  providers: [PermissionSyncService, UserPermissionsService, UserRolesService, PermissionGuard],
  exports: [UserPermissionsService, UserRolesService, PermissionGuard],
})
export class RbacModule {}
