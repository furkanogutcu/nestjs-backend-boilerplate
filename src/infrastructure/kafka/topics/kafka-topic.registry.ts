import { env } from '@config/env.config';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';

export interface IKafkaTopicConfig {
  partitions: number;
  replicationFactor: number;
  retentionMs?: number;
  retryEnabled: boolean;
}

// * Realtime topics carry purely ephemeral kick events: a message is only useful the instant it is consumed, so
// * there is nothing to replay. A short retention keeps the broker default (~7 days) from hoarding dead events
// * and, more importantly, bounds the stale-kick flood a consumer-group offset reset would otherwise replay to a
// * value that is at most an hour old.
const REALTIME_TOPIC_RETENTION_MS = 3_600_000;

export const kafkaTopicRegistry: Record<KafkaTopic, IKafkaTopicConfig> = {
  // * No retry tiers: the Redis denylist (checked at every token verify) is the enforcement; the socket kick is
  // * best-effort UX — a missed kick only leaves a socket alive until token exp, so no retry/DLQ escalation.
  [KafkaTopic.SessionRevoked]: {
    partitions: env.KAFKA_TOPIC_PARTITIONS,
    replicationFactor: env.KAFKA_TOPIC_REPLICATION_FACTOR,
    retentionMs: REALTIME_TOPIC_RETENTION_MS,
    retryEnabled: false,
  },
};
