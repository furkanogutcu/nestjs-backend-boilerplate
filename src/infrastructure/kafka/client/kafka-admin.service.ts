import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Admin, ITopicConfig } from 'kafkajs';

import { env } from '@config/env.config';
import { BaseKafkaService } from '@infrastructure/kafka/client/base-kafka-service.abstract';
import { RETRY_TIERS } from '@infrastructure/kafka/constants/retry.constant';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaTopicConfig, kafkaTopicRegistry } from '@infrastructure/kafka/topics/kafka-topic.registry';
import { dlqTopicName, retryTopicName } from '@infrastructure/kafka/topics/topic-naming.util';

@Injectable()
export class KafkaAdminService extends BaseKafkaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KafkaAdminService.name);

  onModuleInit(): void {}

  onModuleDestroy(): void {}

  async onApplicationBootstrap(): Promise<void> {
    const admin = this.kafka.admin();

    this.warnOnUnsafeReplicationFactor();

    try {
      await admin.connect();
      await this.provisionTopics(admin);
    } catch (error) {
      this.logger.error('Failed to provision Kafka topics', error);
    } finally {
      await admin.disconnect();
    }
  }

  private warnOnUnsafeReplicationFactor(): void {
    if (env.NODE_ENV === 'production' && env.KAFKA_TOPIC_REPLICATION_FACTOR < 3) {
      this.logger.warn(
        `KAFKA_TOPIC_REPLICATION_FACTOR=${env.KAFKA_TOPIC_REPLICATION_FACTOR} in production: broker loss can lose ` +
          `published-but-unconsumed messages (acks=all behaves like acks=1). Use RF>=3 for durable production traffic.`,
      );
    }
  }

  private async provisionTopics(admin: Admin): Promise<void> {
    const existing = new Set(await admin.listTopics());
    const desired = this.buildTopicConfigs();

    const toCreate = desired.filter((topic) => !existing.has(topic.topic));
    const skipped = desired.filter((topic) => existing.has(topic.topic)).map((topic) => topic.topic);

    if (skipped.length > 0) {
      this.logger.log(`Kafka topics already present (left unchanged): ${skipped.join(', ')}`);
    }

    if (toCreate.length === 0) {
      return;
    }

    await admin.createTopics({ topics: toCreate, waitForLeaders: true });
    this.logger.log(`Provisioned Kafka topics: ${toCreate.map((topic) => topic.topic).join(', ')}`);
  }

  private buildTopicConfigs(): ITopicConfig[] {
    const configs: ITopicConfig[] = [];

    for (const [topic, config] of Object.entries(kafkaTopicRegistry) as [KafkaTopic, IKafkaTopicConfig][]) {
      configs.push(this.toTopicConfig({ topic, config, retentionMs: config.retentionMs }));

      if (config.retryEnabled) {
        for (const tier of RETRY_TIERS) {
          configs.push(
            this.toTopicConfig({
              topic: retryTopicName({ topic, suffix: tier.suffix }),
              config,
              retentionMs: env.KAFKA_RETRY_RETENTION_MS,
            }),
          );
        }
      }

      configs.push(this.toTopicConfig({ topic: dlqTopicName(topic), config, retentionMs: env.KAFKA_DLQ_RETENTION_MS }));
    }

    return configs;
  }

  private toTopicConfig(params: { topic: string; config: IKafkaTopicConfig; retentionMs?: number }): ITopicConfig {
    const { topic, config, retentionMs } = params;
    const configEntries = [{ name: 'cleanup.policy', value: 'delete' }];

    if (retentionMs !== undefined) {
      configEntries.push({ name: 'retention.ms', value: String(retentionMs) });
    }

    return {
      topic,
      numPartitions: config.partitions,
      replicationFactor: config.replicationFactor,
      configEntries,
    };
  }
}
