import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { DatabaseModule } from '@infrastructure/database/database.module';

import { AuthModule } from '../auth/auth.module';
import { User } from '../auth/entities/user.entity';
import { PermissionRecord } from '../auth/rbac/entities/permission.entity';
import { Role } from '../auth/rbac/entities/role.entity';
import { RolePermission } from '../auth/rbac/entities/role-permission.entity';
import { UserRole } from '../auth/rbac/entities/user-role.entity';
import { RbacModule } from '../auth/rbac/rbac.module';
import { AdminFeatureFlagsController } from './feature-flags/admin-feature-flags.controller';
import { AdminRolesController } from './roles/admin-roles.controller';
import { AdminRolesService } from './roles/services/admin-roles.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/services/admin-users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role, RolePermission, UserRole, PermissionRecord]),
    DatabaseModule,
    RbacModule,
    AuthModule,
  ],
  controllers: [AdminUsersController, AdminRolesController, AdminFeatureFlagsController],
  providers: [AdminUsersService, AdminRolesService],
})
export class AdminModule {}
