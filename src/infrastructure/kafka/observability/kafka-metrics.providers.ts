import { makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

export const KafkaMetric = {
  OutboxPublished: 'kafka_outbox_published_total',
  OutboxFailed: 'kafka_outbox_failed_total',
  OutboxPending: 'kafka_outbox_pending',
  OutboxFailedRows: 'kafka_outbox_failed',
  Retry: 'kafka_retry_total',
  Dlq: 'kafka_dlq_total',
  InboxDuplicates: 'kafka_inbox_duplicates_total',
  DlqReplayed: 'kafka_dlq_replayed_total',
} as const;

export const kafkaMetricProviders = [
  makeCounterProvider({ name: KafkaMetric.OutboxPublished, help: 'Total outbox messages published to Kafka' }),
  makeCounterProvider({
    name: KafkaMetric.OutboxFailed,
    help: 'Total outbox rows marked failed after exhausting publish attempts',
  }),
  makeGaugeProvider({ name: KafkaMetric.OutboxPending, help: 'Current number of pending outbox rows' }),
  makeGaugeProvider({
    name: KafkaMetric.OutboxFailedRows,
    help: 'Current number of outbox rows stuck in failed state (publish retries exhausted; awaiting requeue)',
  }),
  makeCounterProvider({
    name: KafkaMetric.Retry,
    help: 'Total messages escalated to a retry tier',
    labelNames: ['tier'],
  }),
  makeCounterProvider({
    name: KafkaMetric.Dlq,
    help: 'Total messages routed to a dead-letter topic',
    labelNames: ['topic'],
  }),
  makeCounterProvider({ name: KafkaMetric.InboxDuplicates, help: 'Total duplicate events skipped by the inbox' }),
  makeCounterProvider({
    name: KafkaMetric.DlqReplayed,
    help: 'Total DLQ messages replayed to their original topic',
    labelNames: ['topic'],
  }),
];
