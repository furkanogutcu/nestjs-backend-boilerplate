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

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
