import { buildMetadataHeaders } from '@infrastructure/kafka/client/event-headers.util';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

function makeEvent(meta: Partial<KafkaEvent['meta']> = {}): KafkaEvent {
  return {
    meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 2, timestamp: '1700000000000', ...meta },
    topic: KafkaTopic.SessionRevoked,
    data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
  };
}

describe('buildMetadataHeaders', () => {
  it('mirrors core metadata into headers', () => {
    expect(buildMetadataHeaders(makeEvent())).toEqual({
      'x-event-id': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      'x-event-type': 'session_revoked',
      'x-event-version': '2',
    });
  });

  it('includes optional tracing headers when present', () => {
    expect(buildMetadataHeaders(makeEvent({ traceId: 'trace-1', correlationId: 'corr-1' }))).toMatchObject({
      'x-trace-id': 'trace-1',
      'x-correlation-id': 'corr-1',
    });
  });

  it('returns an empty object for a value without event metadata', () => {
    expect(
      buildMetadataHeaders({
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
      } as unknown as KafkaEvent),
    ).toEqual({});
  });
});
