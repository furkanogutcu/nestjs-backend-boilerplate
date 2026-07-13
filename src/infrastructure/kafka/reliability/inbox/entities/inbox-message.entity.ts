import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('inbox_messages')
@Index('idx_inbox_messages_processed_at', ['processedAt'])
export class InboxMessage {
  @PrimaryColumn()
  consumer!: string;

  @PrimaryColumn()
  dedupId!: string;

  @Column()
  topic!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  processedAt!: Date;
}
