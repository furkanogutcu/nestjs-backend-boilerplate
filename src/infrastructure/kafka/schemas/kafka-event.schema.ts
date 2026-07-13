import z from 'zod';

import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';

const metaSchema = z.object({
  eventId: z.uuid(),
  eventVersion: z.number().int().positive().default(1),
  timestamp: z.string().refine((value) => !isNaN(Number(value)), 'Timestamp must be a number'),
  dedupKey: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  correlationId: z.string().min(1).optional(),
  producer: z.string().min(1).optional(),
});

const baseSchema = z.object({
  meta: metaSchema,
  topic: z.enum(Object.values(KafkaTopic)),
});

// * Carries the kick target directly (`session:<sid>` / `family:<fid>` rooms route it) — no session resolution
// * at publish or consume time, so it cannot race newly issued sessions. Not client-visible.
const sessionRevokedEvent = baseSchema.extend({
  topic: z.literal(KafkaTopic.SessionRevoked),
  data: z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('session'), sessionId: z.uuid() }),
    z.object({ scope: z.literal('family'), familyId: z.uuid() }),
  ]),
});

export const kafkaEventSchema = z.discriminatedUnion('topic', [sessionRevokedEvent]);

export type KafkaEvent<T extends KafkaTopic = KafkaTopic> = Extract<z.infer<typeof kafkaEventSchema>, { topic: T }>;
export type KafkaEventData<T extends KafkaTopic = KafkaTopic> = KafkaEvent<T>['data'];
export type KafkaEventMeta = z.infer<typeof metaSchema>;
