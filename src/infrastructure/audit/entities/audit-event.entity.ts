import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { AuditAction, AuditSubjectType } from '../audit-action.enum';

@Entity('audit_events')
@Index(['subjectType', 'subjectId'])
export class AuditEvent {
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  action!: AuditAction;

  // ! Deliberately not a foreign key. An audit row outlives the account it describes: erasing a user must not
  // ! erase the record that an administrator suspended them, and a cascade here would do exactly that.
  // ! Null means the actor was the system itself (a scheduled job, a CLI, an unauthenticated attempt).
  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  subjectType!: AuditSubjectType | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  subjectId!: string | null;

  // * Free-form context for the event: which fields changed, which role was granted, why a login failed. Never
  // * put credentials, tokens or full request bodies here — this table is read by more people than the logs.
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  requestId!: string | null;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
