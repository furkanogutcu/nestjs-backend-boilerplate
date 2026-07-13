import { RETRY_TIERS } from '@infrastructure/kafka/constants/retry.constant';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';

export function retryTopicName(params: { topic: KafkaTopic; suffix: string }): string {
  return `${params.topic}.${params.suffix}`;
}

export function retryTopicNames(topic: KafkaTopic): string[] {
  return RETRY_TIERS.map((tier) => retryTopicName({ topic, suffix: tier.suffix }));
}

export function dlqTopicName(topic: KafkaTopic): string {
  return `${topic}.dlq`;
}
