import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { kafkaEventSchema } from '@infrastructure/kafka/schemas/kafka-event.schema';

const validSessionRevoked = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 1, timestamp: '1700000000000' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session' as const, sessionId: '0192f8a0-4444-7abc-8def-000000000004' },
};

describe('kafkaEventSchema (shared envelope)', () => {
  it('defaults eventVersion to 1 when omitted', () => {
    const { eventVersion: _omitted, ...meta } = validSessionRevoked.meta;
    const parsed = kafkaEventSchema.parse({ ...validSessionRevoked, meta });

    expect(parsed.meta.eventVersion).toBe(1);
  });

  it('accepts optional tracing and dedup metadata', () => {
    const parsed = kafkaEventSchema.parse({
      ...validSessionRevoked,
      meta: {
        ...validSessionRevoked.meta,
        dedupKey: 'trade:42',
        traceId: 'trace-1',
        correlationId: 'corr-1',
        producer: 'svc',
      },
    });

    expect(parsed.meta).toMatchObject({ dedupKey: 'trade:42', traceId: 'trace-1', correlationId: 'corr-1' });
  });

  it('rejects a missing or invalid eventId', () => {
    expect(kafkaEventSchema.safeParse({ ...validSessionRevoked, meta: { timestamp: '1' } }).success).toBe(false);
    expect(
      kafkaEventSchema.safeParse({
        ...validSessionRevoked,
        meta: { ...validSessionRevoked.meta, eventId: 'nope' },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown topic', () => {
    expect(kafkaEventSchema.safeParse({ ...validSessionRevoked, topic: 'unknown' }).success).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    expect(
      kafkaEventSchema.safeParse({
        ...validSessionRevoked,
        meta: { ...validSessionRevoked.meta, timestamp: 'not-a-number' },
      }).success,
    ).toBe(false);
  });

  it('rejects when meta is missing', () => {
    expect(
      kafkaEventSchema.safeParse({ topic: validSessionRevoked.topic, data: validSessionRevoked.data }).success,
    ).toBe(false);
  });
});

describe('kafkaEventSchema (session_revoked)', () => {
  it('parses a session-scoped revocation', () => {
    expect(kafkaEventSchema.parse(validSessionRevoked)).toEqual(validSessionRevoked);
  });

  it('parses a family-scoped revocation', () => {
    const familyEvent = {
      ...validSessionRevoked,
      data: { scope: 'family' as const, familyId: '0192f8a0-5555-7abc-8def-000000000005' },
    };

    expect(kafkaEventSchema.parse(familyEvent)).toEqual(familyEvent);
  });

  it('rejects a scope outside the declared set', () => {
    expect(
      kafkaEventSchema.safeParse({
        ...validSessionRevoked,
        data: { scope: 'user', userId: '0192f8a0-6666-7abc-8def-000000000006' },
      }).success,
    ).toBe(false);
  });

  it('rejects a session scope carrying a familyId instead of a sessionId', () => {
    expect(
      kafkaEventSchema.safeParse({
        ...validSessionRevoked,
        data: { scope: 'session', familyId: '0192f8a0-5555-7abc-8def-000000000005' },
      }).success,
    ).toBe(false);
  });

  it('rejects a non-uuid sessionId', () => {
    expect(
      kafkaEventSchema.safeParse({
        ...validSessionRevoked,
        data: { scope: 'session', sessionId: 'sess-1' },
      }).success,
    ).toBe(false);
  });
});
