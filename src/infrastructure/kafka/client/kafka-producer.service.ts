import { Injectable, Logger } from '@nestjs/common';
import { Message, Partitioners, Producer } from 'kafkajs';

import { BaseKafkaService } from '@infrastructure/kafka/client/base-kafka-service.abstract';
import { buildMetadataHeaders } from '@infrastructure/kafka/client/event-headers.util';
import { KafkaHeader } from '@infrastructure/kafka/constants/kafka-headers.constant';
import { IKafkaProducerMessage } from '@infrastructure/kafka/interfaces/kafka-message.interface';
import { IKafkaMessage } from '@infrastructure/kafka/interfaces/kafka-message.interface';
import { injectTraceContext } from '@infrastructure/kafka/observability/kafka-trace.util';

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;

@Injectable()
export class KafkaProducerService extends BaseKafkaService {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer!: Producer;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private connected = false;

  onModuleInit(): void {
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      idempotent: true,
      maxInFlightRequests: 1,
    });

    void this.connectWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.connected = false;

    try {
      await this.producer?.disconnect();
    } catch (error) {
      this.logger.error('Failed to disconnect Kafka producer', error);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async sendMessage(data: IKafkaProducerMessage): Promise<void> {
    await this.producer.send({
      topic: data.topic.toString(),
      acks: -1,
      messages: data.messages.map((message) => this.toKafkaMessage(message)),
    });
  }

  async sendMessages(messages: IKafkaProducerMessage[]): Promise<void> {
    await this.producer.sendBatch({
      acks: -1,
      topicMessages: messages.map((message) => ({
        topic: message.topic.toString(),
        messages: message.messages.map((entry) => this.toKafkaMessage(entry)),
      })),
    });
  }

  async sendRaw(params: {
    topic: string;
    message: { key?: Buffer | null; value: Buffer | null; headers?: Record<string, string | Buffer> };
  }): Promise<void> {
    const { topic, message } = params;

    await this.producer.send({
      topic,
      acks: -1,
      messages: [{ key: message.key ?? undefined, value: message.value, headers: message.headers }],
    });
  }

  private toKafkaMessage(message: IKafkaMessage): Message {
    const headers: Record<string, string | Buffer> = { ...buildMetadataHeaders(message.value), ...message.headers };

    if (!headers[KafkaHeader.Traceparent]) {
      injectTraceContext(headers);
    }

    return {
      key: message.key,
      partition: message.partition,
      timestamp: message.timestamp,
      value: JSON.stringify(message.value),
      headers,
    };
  }

  private async connectWithRetry(): Promise<void> {
    try {
      await this.producer.connect();
      this.reconnectTimer = undefined;
      this.reconnectAttempts = 0;
      this.connected = true;
      this.logger.log('Kafka producer connected');
    } catch (error) {
      this.connected = false;
      const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
      this.reconnectAttempts += 1;
      this.logger.error(`Kafka producer connection failed; retrying in ${delay}ms`, error);
      this.reconnectTimer = setTimeout(() => void this.connectWithRetry(), delay);
    }
  }
}
