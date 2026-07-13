import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';

import { KafkaMetric } from '@infrastructure/kafka/observability/kafka-metrics.providers';

@Injectable()
export class KafkaMetricsService {
  constructor(
    @InjectMetric(KafkaMetric.OutboxPublished) private readonly outboxPublished: Counter,
    @InjectMetric(KafkaMetric.OutboxFailed) private readonly outboxFailed: Counter,
    @InjectMetric(KafkaMetric.OutboxPending) private readonly outboxPending: Gauge,
    @InjectMetric(KafkaMetric.OutboxFailedRows) private readonly outboxFailedRows: Gauge,
    @InjectMetric(KafkaMetric.Retry) private readonly retry: Counter<'tier'>,
    @InjectMetric(KafkaMetric.Dlq) private readonly dlq: Counter<'topic'>,
    @InjectMetric(KafkaMetric.InboxDuplicates) private readonly inboxDuplicates: Counter,
    @InjectMetric(KafkaMetric.DlqReplayed) private readonly dlqReplayed: Counter<'topic'>,
  ) {}

  recordOutboxPublished(count: number): void {
    this.outboxPublished.inc(count);
  }

  recordOutboxFailed(count: number): void {
    this.outboxFailed.inc(count);
  }

  setOutboxPending(count: number): void {
    this.outboxPending.set(count);
  }

  setOutboxFailed(count: number): void {
    this.outboxFailedRows.set(count);
  }

  recordRetry(tier: string): void {
    this.retry.inc({ tier });
  }

  recordDlq(topic: string): void {
    this.dlq.inc({ topic });
  }

  recordInboxDuplicate(): void {
    this.inboxDuplicates.inc();
  }

  recordDlqReplayed(topic: string): void {
    this.dlqReplayed.inc({ topic });
  }
}
