import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryColumn('uuid')
  id!: string;

  @Index({ unique: true, where: 'email IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', nullable: true })
  passwordHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  displayName!: string | null;

  @Column({ type: 'boolean', default: true })
  isAnonymous!: boolean;

  @Column({ type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  suspendedAt!: Date | null;

  // ! Erasure is deferred: the scheduled job only acts past the grace window, and clearing this cancels it.
  @Column({ type: 'timestamptz', nullable: true })
  deletionRequestedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
