import { InjectQueue, Processor } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { env } from '@config/env.config';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { BaseScheduledProcessor } from '@infrastructure/queues/base-scheduled.processor';
import { AppQueue } from '@shared/enums/queue.enum';

@Processor(AppQueue.OutboxPrune)
export class OutboxPruneProcessor extends BaseScheduledProcessor {
  protected readonly schedulerId = 'outbox-prune';
  protected readonly cronPattern = env.KAFKA_OUTBOX_PRUNE_CRON;

  constructor(
    @InjectQueue(AppQueue.OutboxPrune) queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    super(queue);
  }

  async process(): Promise<void> {
    // ! TypeORM returns [rows, affectedCount] for DELETE ... RETURNING; the rows are in the first element.
    const [deleted] = await this.dataSource.query<[{ id: string }[], number]>(
      `DELETE FROM outbox_messages
       WHERE status = $1 AND published_at < now() - ($2 * interval '1 millisecond')
       RETURNING id`,
      [OutboxStatus.Published, env.KAFKA_OUTBOX_RETENTION_MS],
    );

    this.logger.log(`Pruned ${deleted.length} published outbox row(s)`);
  }
}
