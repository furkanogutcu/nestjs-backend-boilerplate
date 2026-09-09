import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('permissions')
export class PermissionRecord {
  // * The Permission enum value; the enum is the source of truth and this table is its projection.
  @PrimaryColumn({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  description!: string;

  // ! Retired instead of deleted: a role may still reference a permission that left the code, and deleting the
  // ! row would either break that grant or silently widen the role. Retired permissions are never granted.
  @Column({ type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;
}
