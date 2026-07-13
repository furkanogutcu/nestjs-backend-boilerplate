import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { dlqTopicName, retryTopicName, retryTopicNames } from '@infrastructure/kafka/topics/topic-naming.util';

describe('topic-naming util', () => {
  it('builds a single retry topic name from a suffix', () => {
    expect(retryTopicName({ topic: KafkaTopic.SessionRevoked, suffix: 'retry.5s' })).toBe('session_revoked.retry.5s');
  });

  it('builds all retry tier topic names in order', () => {
    expect(retryTopicNames(KafkaTopic.SessionRevoked)).toEqual([
      'session_revoked.retry.5s',
      'session_revoked.retry.1m',
      'session_revoked.retry.10m',
    ]);
  });

  it('builds the dlq topic name', () => {
    expect(dlqTopicName(KafkaTopic.SessionRevoked)).toBe('session_revoked.dlq');
  });
});
