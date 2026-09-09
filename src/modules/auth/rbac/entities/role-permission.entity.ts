import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { PermissionRecord } from './permission.entity';
import { Role } from './role.entity';

@Entity('role_permissions')
@Index(['permissionName'])
export class RolePermission {
  @PrimaryColumn('uuid')
  roleId!: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role!: Role;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  permissionName!: string;

  // ! RESTRICT, not CASCADE: a permission is never deleted while a role still grants it — the sync retires it
  // ! instead. A cascade here would silently narrow every role that held it.
  @ManyToOne(() => PermissionRecord, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'permission_name' })
  permission!: PermissionRecord;
}
