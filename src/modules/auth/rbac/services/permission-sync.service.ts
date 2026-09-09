import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { EntityManager, In, IsNull, Not } from 'typeorm';

import { ClockService } from '@infrastructure/clock/clock.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { generateUuid } from '@shared/utils/uuid.util';

import { PermissionRecord } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Permission, PERMISSION_DESCRIPTIONS } from '../permission.enum';
import { SUPERUSER_ROLE_NAME } from '../rbac.constant';

@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly clock: ClockService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  // * Projects the Permission enum onto the database so the admin API can offer a pick list, then keeps the
  // * superuser role holding everything. Idempotent: safe on every boot and on every instance.
  async sync(): Promise<void> {
    await this.databaseService.runInTransaction(async (manager) => {
      const codeNames = Object.values(Permission);

      await manager.upsert(
        PermissionRecord,
        codeNames.map((name) => ({ name, description: PERMISSION_DESCRIPTIONS[name], retiredAt: null })),
        ['name'],
      );

      const retired = await manager.update(
        PermissionRecord,
        { name: Not(In(codeNames)), retiredAt: IsNull() },
        { retiredAt: this.clock.date() },
      );

      if ((retired.affected ?? 0) > 0) {
        this.logger.warn(`Retired ${retired.affected} permission(s) no longer declared in code`);
      }

      await this.ensureSuperuserRole({ manager, codeNames });
    });
  }

  private async ensureSuperuserRole({
    manager,
    codeNames,
  }: {
    manager: EntityManager;
    codeNames: Permission[];
  }): Promise<void> {
    let role = await manager.findOne(Role, { where: { name: SUPERUSER_ROLE_NAME } });

    if (!role) {
      role = manager.create(Role, {
        id: generateUuid(),
        name: SUPERUSER_ROLE_NAME,
        description: 'Holds every permission. Created and kept in sync automatically.',
        isSystem: true,
      });
      await manager.insert(Role, role);
      this.logger.log(`Created the ${SUPERUSER_ROLE_NAME} role`);
    }

    // * Re-granted every boot so a permission added in code is never missing from the one role that must have it.
    await manager.upsert(
      RolePermission,
      codeNames.map((permissionName) => ({ roleId: role.id, permissionName })),
      ['roleId', 'permissionName'],
    );

    await manager.delete(RolePermission, { roleId: role.id, permissionName: Not(In(codeNames)) });
  }
}
