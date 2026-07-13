import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';

export interface IKafkaConsumerConfig {
  groupId: string;
  topics: KafkaTopic[];
  fromBeginning?: boolean;
  autoCommit?: boolean;
  partitionsConsumedConcurrently?: number;
  onRebalance?: () => void;
}

export interface IKafkaConsumerMessage {
  topic: KafkaTopic;
  partition: number;
  message: {
    key: Buffer | null;
    value: Buffer | null;
    timestamp: string;
    offset: string;
    headers: Record<string, Buffer>;
  };
}

export interface IKafkaMessageControls {
  pause: () => () => void;
  heartbeat: () => Promise<void>;
  seek: (offset: string) => void;
  commit: (offset: string) => Promise<void>;
}

export interface IKafkaMessagePayload {
  message: IKafkaConsumerMessage;
  controls: IKafkaMessageControls;
}

export type IKafkaMessageHandler = (payload: IKafkaMessagePayload) => Promise<void>;
