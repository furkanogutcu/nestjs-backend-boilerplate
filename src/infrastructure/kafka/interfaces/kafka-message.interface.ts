import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

export interface IKafkaMessage {
  key?: string;
  value: KafkaEvent;
  partition?: number;
  headers?: Record<string, string | Buffer>;
  timestamp?: string;
}

export interface IKafkaProducerMessage {
  topic: KafkaTopic;
  messages: IKafkaMessage[];
}
