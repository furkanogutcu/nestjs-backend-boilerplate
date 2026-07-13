import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

import { MailSuppressionReason } from '../enums/mail-suppression-reason.enum';

@Entity('mail_suppressions')
export class MailSuppression {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  email!: string;

  @Column({ type: 'varchar' })
  reason!: MailSuppressionReason;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  // * When the suppression lapses. Bounded so a false-positive / now-fixed address recovers; a repeat bounce refreshes
  // * it. Null would be a permanent suppression, but the webhook always writes a finite value.
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
