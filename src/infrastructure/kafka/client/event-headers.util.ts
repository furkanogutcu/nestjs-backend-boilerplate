import { KafkaHeader } from '@infrastructure/kafka/constants/kafka-headers.constant';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

export function buildMetadataHeaders(event: KafkaEvent): Record<string, string> {
  const meta = event?.meta;

  if (!meta?.eventId) {
    return {};
  }

  const headers: Record<string, string> = {
    [KafkaHeader.EventId]: meta.eventId,
    [KafkaHeader.EventType]: event.topic,
    [KafkaHeader.EventVersion]: String(meta.eventVersion),
  };

  if (meta.traceId) {
    headers[KafkaHeader.TraceId] = meta.traceId;
  }

  if (meta.correlationId) {
    headers[KafkaHeader.CorrelationId] = meta.correlationId;
  }

  return headers;
}
