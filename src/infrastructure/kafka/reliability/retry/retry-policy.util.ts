import { RETRY_TIERS } from '@infrastructure/kafka/constants/retry.constant';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { dlqTopicName, retryTopicName } from '@infrastructure/kafka/topics/topic-naming.util';

export interface IRetryTierMatch {
  index: number;
  delayMs: number;
}

export function matchRetryTier(topic: string): IRetryTierMatch | null {
  const index = RETRY_TIERS.findIndex((tier) => topic.endsWith(`.${tier.suffix}`));

  return index === -1 ? null : { index, delayMs: RETRY_TIERS[index].delayMs };
}

export function nextDestination(params: { baseTopic: KafkaTopic; currentTierIndex: number | null }): string {
  const { baseTopic, currentTierIndex } = params;
  const nextIndex = currentTierIndex === null ? 0 : currentTierIndex + 1;
  const tier = RETRY_TIERS[nextIndex];

  return tier ? retryTopicName({ topic: baseTopic, suffix: tier.suffix }) : dlqTopicName(baseTopic);
}

export function attemptNumber(currentTierIndex: number | null): number {
  return currentTierIndex === null ? 1 : currentTierIndex + 2;
}

export function baseTopicOf(topic: string): string {
  const tier = matchRetryTier(topic);

  return tier ? topic.slice(0, -`.${RETRY_TIERS[tier.index].suffix}`.length) : topic;
}
