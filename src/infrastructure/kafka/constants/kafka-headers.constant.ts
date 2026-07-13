export const KafkaHeader = {
  EventId: 'x-event-id',
  EventType: 'x-event-type',
  EventVersion: 'x-event-version',
  TraceId: 'x-trace-id',
  Traceparent: 'traceparent',
  Baggage: 'baggage',
  CorrelationId: 'x-correlation-id',
  OriginalTopic: 'x-original-topic',
  RetryAttempt: 'x-retry-attempt',
  FirstFailedAt: 'x-first-failed-at',
  LastError: 'x-last-error',
} as const;
