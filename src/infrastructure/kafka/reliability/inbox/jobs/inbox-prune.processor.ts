import { InjectQueue, Processor } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { env } from '@config/env.config';
import { BaseScheduledProcessor } from '@infrastructure/queues/base-scheduled.processor';
import { AppQueue } from '@shared/enums/queue.enum';

@Processor(AppQueue.InboxPrune)
export class InboxPruneProcessor extends BaseScheduledProcessor {
  protected readonly schedulerId = 'inbox-prune';
  protected readonly cronPattern = env.KAFKA_INBOX_PRUNE_CRON;

  constructor(
    @InjectQueue(AppQueue.InboxPrune) queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    super(queue);
  }

  async process(): Promise<void> {
    // ! TypeORM returns [rows, affectedCount] for DELETE ... RETURNING; the rows are in the first element.
    const [deleted] = await this.dataSource.query<[{ dedup_id: string }[], number]>(
      `DELETE FROM inbox_messages
       WHERE processed_at < now() - ($1 * interval '1 millisecond')
       RETURNING dedup_id`,
      [env.KAFKA_INBOX_RETENTION_MS],
    );

    this.logger.log(`Pruned ${deleted.length} processed inbox row(s)`);
  }
}
