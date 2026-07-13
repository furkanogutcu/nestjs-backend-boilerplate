import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';

import { env } from '@config/env.config';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaProducerMessage } from '@infrastructure/kafka/interfaces/kafka-message.interface';
import { IKafkaMessage } from '@infrastructure/kafka/interfaces/kafka-message.interface';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { BaseIntervalProcessor } from '@infrastructure/queues/base-interval.processor';
import { AdvisoryLock } from '@shared/enums/advisory-lock.enum';
import { AppQueue } from '@shared/enums/queue.enum';

interface IPendingOutboxRow {
  id: string;
  topic: string;
  partition_key: string | null;
  payload: KafkaEvent;
  headers: Record<string, string> | null;
}

@Processor(AppQueue.OutboxRelay, { concurrency: 1 })
export class OutboxRelayProcessor extends BaseIntervalProcessor {
  protected readonly schedulerId = 'outbox-relay';
  protected readonly intervalMs = env.KAFKA_OUTBOX_RELAY_INTERVAL_MS;

  private readonly batchSize = env.KAFKA_OUTBOX_BATCH_SIZE;
  private readonly maxAttempts = env.KAFKA_OUTBOX_MAX_ATTEMPTS;
  private readonly backoffMs = env.KAFKA_OUTBOX_BACKOFF_MS;
  private readonly backoffMaxMs = env.KAFKA_OUTBOX_BACKOFF_MAX_MS;

  constructor(
    @InjectQueue(AppQueue.OutboxRelay) queue: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly producer: KafkaProducerService,
    @Optional() private readonly metrics?: KafkaMetricsService,
  ) {
    super(queue);
  }

  async process(): Promise<void> {
    const claimed: string[] = [];

    try {
      await this.dataSource.transaction(async (manager) => {
        if (!(await this.acquireLock(manager))) {
          return;
        }

        const rows = await this.selectPending(manager);

        if (rows.length === 0) {
          return;
        }

        claimed.push(...rows.map((row) => row.id));

        // * At-least-once: a crash after publish but before commit re-publishes these rows next tick, so consumers MUST be idempotent (BaseIdempotentConsumer / inbox dedup).
        await this.producer.sendMessages(this.toProducerMessages(rows));
        await this.markPublished({ manager, ids: claimed });
      });

      if (claimed.length > 0) {
        this.metrics?.recordOutboxPublished(claimed.length);
      }
    } catch (error) {
      if (claimed.length > 0) {
        await this.applyBackoff({ ids: claimed, error });
      } else {
        this.logger.error('Outbox relay failed before claiming any rows', error);
      }
    }

    await this.updateGauges();
  }

  private async acquireLock(manager: EntityManager): Promise<boolean> {
    const result = await manager.query<{ locked: boolean }[]>('SELECT pg_try_advisory_xact_lock($1) AS locked', [
      AdvisoryLock.OutboxRelay,
    ]);

    return result[0]?.locked === true;
  }

  private async selectPending(manager: EntityManager): Promise<IPendingOutboxRow[]> {
    return await manager.query<IPendingOutboxRow[]>(
      `SELECT id, topic, partition_key, payload, headers
       FROM outbox_messages
       WHERE status = $1 AND available_at <= now()
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [OutboxStatus.Pending, this.batchSize],
    );
  }

  private toProducerMessages(rows: IPendingOutboxRow[]): IKafkaProducerMessage[] {
    const byTopic = new Map<string, IKafkaMessage[]>();

    for (const row of rows) {
      const messages = byTopic.get(row.topic) ?? [];
      messages.push({ key: row.partition_key ?? undefined, value: row.payload, headers: row.headers ?? undefined });
      byTopic.set(row.topic, messages);
    }

    return Array.from(byTopic, ([topic, messages]) => ({ topic: topic as KafkaTopic, messages }));
  }

  private async markPublished(params: { manager: EntityManager; ids: string[] }): Promise<void> {
    const { manager, ids } = params;
    await manager.query('UPDATE outbox_messages SET status = $1, published_at = now() WHERE id = ANY($2)', [
      OutboxStatus.Published,
      ids,
    ]);
  }

  private async applyBackoff(params: { ids: string[]; error: unknown }): Promise<void> {
    const { ids, error } = params;
    const reason = error instanceof Error ? error.message : String(error);

    this.logger.error(`Outbox relay publish failed for ${ids.length} row(s); applying backoff`, error);

    // ! TypeORM returns [rows, affectedCount] for UPDATE ... RETURNING; the rows are in the first element.
    const [rows] = await this.dataSource.query<[{ status: OutboxStatus }[], number]>(
      `UPDATE outbox_messages
       SET attempts = attempts + 1,
           last_error = $2,
           available_at = now() + (LEAST($3::double precision * power(2, attempts), $7::double precision) * interval '1 millisecond'),
           status = CASE WHEN attempts + 1 >= $4 THEN $5 ELSE status END
       WHERE id = ANY($1) AND status = $6
       RETURNING status`,
      [ids, reason, this.backoffMs, this.maxAttempts, OutboxStatus.Failed, OutboxStatus.Pending, this.backoffMaxMs],
    );

    const failed = (rows ?? []).filter((row) => row.status === OutboxStatus.Failed).length;

    if (failed > 0) {
      this.metrics?.recordOutboxFailed(failed);
    }
  }

  private async updateGauges(): Promise<void> {
    if (!this.metrics) {
      return;
    }

    const rows = await this.dataSource.query<{ status: OutboxStatus; count: string }[]>(
      `SELECT status, count(*)::text AS count
       FROM outbox_messages
       WHERE status = ANY($1)
       GROUP BY status`,
      [[OutboxStatus.Pending, OutboxStatus.Failed]],
    );

    const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));

    this.metrics.setOutboxPending(counts.get(OutboxStatus.Pending) ?? 0);
    this.metrics.setOutboxFailed(counts.get(OutboxStatus.Failed) ?? 0);
  }
}
