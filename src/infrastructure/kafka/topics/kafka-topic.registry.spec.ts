import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { kafkaTopicRegistry } from '@infrastructure/kafka/topics/kafka-topic.registry';

describe('kafkaTopicRegistry', () => {
  it('declares config for every KafkaTopic', () => {
    for (const topic of Object.values(KafkaTopic)) {
      expect(kafkaTopicRegistry[topic]).toBeDefined();
    }
  });

  it('uses positive partition and replication-factor defaults', () => {
    const config = kafkaTopicRegistry[KafkaTopic.SessionRevoked];

    expect(config.partitions).toBeGreaterThan(0);
    expect(config.replicationFactor).toBeGreaterThan(0);
  });
});
