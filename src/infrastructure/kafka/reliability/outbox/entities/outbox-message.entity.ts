import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import type { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

@Entity('outbox_messages')
@Index('idx_outbox_messages_pending', ['availableAt', 'createdAt'], { where: "status = 'pending'" })
@Index('idx_outbox_messages_published_at', ['publishedAt'], { where: "status = 'published'" })
export class OutboxMessage {
  @PrimaryColumn('uuid')
  id!: string;

  @Column()
  topic!: string;

  @Column({ type: 'varchar', nullable: true })
  partitionKey!: string | null;

  @Column({ type: 'jsonb' })
  payload!: KafkaEvent;

  @Column({ type: 'jsonb', nullable: true })
  headers!: Record<string, string> | null;

  @Column({ type: 'varchar', default: OutboxStatus.Pending })
  status!: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  availableAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;
}
