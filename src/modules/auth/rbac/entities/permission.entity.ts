import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('permissions')
export class PermissionRecord {
  @PrimaryColumn({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 255 })
  description!: string;

  // ! Retired, never deleted: a role may still reference it, and removing the row would silently widen that role.
  @Column({ type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;
}
