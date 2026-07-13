import { Injectable, Logger } from '@nestjs/common';
import { Consumer, EachMessagePayload } from 'kafkajs';

import { BaseKafkaService } from '@infrastructure/kafka/client/base-kafka-service.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerConfig,
  IKafkaConsumerMessage,
  IKafkaMessageHandler,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { AppInternalException } from '@shared/exceptions/internal.exception';

@Injectable()
export class KafkaConsumerService extends BaseKafkaService {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumers = new Map<string, Consumer>();
  private readonly consumerTopics = new Map<string, string[]>();

  onModuleInit(): void {}

  async onModuleDestroy(): Promise<void> {
    try {
      await Promise.all(Array.from(this.consumers.values()).map(async (consumer) => await consumer.disconnect()));
      this.consumers.clear();
      this.consumerTopics.clear();
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka consumers', error);
    }
  }

  async consume(params: { config: IKafkaConsumerConfig; messageHandler: IKafkaMessageHandler }): Promise<void> {
    const { config, messageHandler } = params;

    await this.createConsumer(config);
    await this.startConsumer({ config, messageHandler });
  }

  pauseTopic(params: { groupId: string; topics?: string[] }): void {
    const { groupId, topics } = params;

    const consumer = this.get(groupId);
    const targetTopics = topics?.length ? topics : (this.consumerTopics.get(groupId) ?? []);

    if (targetTopics.length === 0) {
      this.logger.warn(`No topics to pause for group: ${groupId}`);
      return;
    }

    consumer.pause(targetTopics.map((topic) => ({ topic })));
  }

  resumeTopic(params: { groupId: string; topics?: string[] }): void {
    const { groupId, topics } = params;

    const consumer = this.get(groupId);
    const targetTopics = topics?.length ? topics : (this.consumerTopics.get(groupId) ?? []);

    if (targetTopics.length === 0) {
      this.logger.warn(`No topics to resume for group: ${groupId}`);
      return;
    }

    consumer.resume(targetTopics.map((topic) => ({ topic })));
  }

  seekToOffset(params: { groupId: string; topic: string; partition: number; offset: string }): void {
    const { groupId, topic, partition, offset } = params;

    const consumer = this.get(groupId);

    try {
      consumer.seek({ topic, partition, offset });
    } catch (error) {
      this.logger.error(`Failed to seek Kafka consumer for group: ${groupId}`, error);
      throw error;
    }
  }

  async disconnect(groupId: string): Promise<void> {
    const consumer = this.get(groupId);

    try {
      await consumer.disconnect();
      this.consumers.delete(groupId);
      this.consumerTopics.delete(groupId);
    } catch (error) {
      this.logger.error(`Failed to disconnect Kafka consumer for group: ${groupId}`, error);
      throw error;
    }
  }

  list(): Map<string, Consumer> {
    return new Map(this.consumers);
  }

  get(groupId: string): Consumer {
    const consumer = this.consumers.get(groupId);

    if (!consumer) {
      throw new AppInternalException({ message: `Consumer with group ID ${groupId} not found` });
    }

    return consumer;
  }

  private async createConsumer(config: IKafkaConsumerConfig): Promise<Consumer> {
    const consumer = this.kafka.consumer({ groupId: config.groupId });

    consumer.on(consumer.events.CRASH, (event) => {
      this.logger.error(`Kafka consumer crashed (group: ${config.groupId})`, event.payload.error);
      config.onRebalance?.();
    });

    consumer.on(consumer.events.REBALANCING, () => config.onRebalance?.());

    try {
      await consumer.connect();
      await consumer.subscribe({
        topics: config.topics,
        fromBeginning: config.fromBeginning ?? false,
      });

      this.consumers.set(config.groupId, consumer);
      this.consumerTopics.set(config.groupId, config.topics);

      return consumer;
    } catch (error) {
      this.logger.error(`Failed to create Kafka consumer for group: ${config.groupId}`, error);
      await consumer.disconnect().catch(() => undefined);

      throw error;
    }
  }

  private async startConsumer(params: {
    config: IKafkaConsumerConfig;
    messageHandler: IKafkaMessageHandler;
  }): Promise<void> {
    const { config, messageHandler } = params;

    const consumer = this.get(config.groupId);

    await consumer.run({
      autoCommit: config.autoCommit ?? true,
      partitionsConsumedConcurrently: config.partitionsConsumedConcurrently,
      eachMessage: async (payload: EachMessagePayload) => {
        const kafkaMessage: IKafkaConsumerMessage = {
          topic: payload.topic as KafkaTopic,
          partition: payload.partition,
          message: {
            key: payload.message.key,
            value: payload.message.value,
            timestamp: payload.message.timestamp,
            offset: payload.message.offset,
            headers: (payload.message.headers ?? {}) as Record<string, Buffer>,
          },
        };

        await messageHandler({
          message: kafkaMessage,
          controls: {
            pause: payload.pause,
            heartbeat: payload.heartbeat,
            seek: (offset) => consumer.seek({ topic: payload.topic, partition: payload.partition, offset }),
            commit: async (offset) =>
              await consumer.commitOffsets([{ topic: payload.topic, partition: payload.partition, offset }]),
          },
        });
      },
    });
  }
}
