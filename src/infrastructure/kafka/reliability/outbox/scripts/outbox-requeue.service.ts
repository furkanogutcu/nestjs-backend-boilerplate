import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { IRequeueOptions } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.util';

interface ISelectorFragment {
  fragment: string;
  params: string[];
}

// * Moves `failed` outbox rows (publish retries exhausted) back to `pending` so the relay picks them up
// * again. Manual recovery only — run AFTER the root cause is fixed; attempts reset to 0, so an unfixed
// * cause simply re-exhausts the retries. Requeueing does not re-publish here; it re-arms the relay.
@Injectable()
export class OutboxRequeueService {
  private readonly logger = new Logger(OutboxRequeueService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async run(options: IRequeueOptions): Promise<number> {
    return options.dryRun ? await this.countMatches(options) : await this.requeue(options);
  }

  private async countMatches(options: IRequeueOptions): Promise<number> {
    const selector = this.selector({ options, baseIndex: 2 });

    const rows = await this.dataSource.query<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM outbox_messages WHERE status = $1${selector.fragment}`,
      [OutboxStatus.Failed, ...selector.params],
    );

    const count = Number(rows[0].count);
    this.logger.log(`[dry-run] would requeue ${count} failed outbox row(s)`);

    return count;
  }

  private async requeue(options: IRequeueOptions): Promise<number> {
    const selector = this.selector({ options, baseIndex: 3 });
    const params: unknown[] = [OutboxStatus.Pending, OutboxStatus.Failed, ...selector.params];
    let target: string;

    if (options.limit !== undefined) {
      params.push(options.limit);
      target = `id IN (
        SELECT id FROM outbox_messages
        WHERE status = $2${selector.fragment}
        ORDER BY created_at ASC
        LIMIT $${params.length}
        FOR UPDATE SKIP LOCKED
      )`;
    } else {
      target = `status = $2${selector.fragment}`;
    }

    // ! TypeORM returns [rows, affectedCount] for UPDATE ... RETURNING (a SELECT returns the rows directly).
    const [rows] = await this.dataSource.query<[{ id: string }[], number]>(
      `UPDATE outbox_messages
       SET status = $1, attempts = 0, last_error = NULL, available_at = now()
       WHERE ${target}
       RETURNING id`,
      params,
    );

    this.logger.log(`Requeued ${rows.length} failed outbox row(s) to pending`);

    return rows.length;
  }

  private selector(params: { options: IRequeueOptions; baseIndex: number }): ISelectorFragment {
    const { options, baseIndex } = params;

    if (options.id !== undefined) {
      return { fragment: ` AND id = $${baseIndex}`, params: [options.id] };
    }

    if (options.topic !== undefined) {
      return { fragment: ` AND topic = $${baseIndex}`, params: [options.topic] };
    }

    return { fragment: '', params: [] };
  }
}
