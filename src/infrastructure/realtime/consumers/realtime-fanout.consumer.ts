import { Inject, Injectable } from '@nestjs/common';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseEventConsumer } from '@infrastructure/kafka/consumers/base-event-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerConfig } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

import { REALTIME_FANOUT_CONSUMER_GROUP } from '../constants/realtime-consumer.constant';
import { REALTIME_PUBLISHER } from '../constants/realtime-publisher.constant';
import type { IRealtimePublisher } from '../interfaces/realtime-publisher.interface';

// * The Kafka → client bridge: consumes internal domain events (produced via the outbox, atomically with the
// * business write) and turns each into a socket kick through the active IRealtimePublisher. Plain at-least-once
// * consumer, deliberately NO inbox dedup: every effect here is idempotent (disconnecting an absent socket is a
// * no-op), so a dedup row per event would buy nothing and cost a DB write on the hot path. Error semantics:
// * an unparseable message is skipped (base default); a processing throw would be redelivered — practically
// * unreachable, as the only side effect is an in-memory socket.io disconnect.
@Injectable()
export class RealtimeFanoutConsumer extends BaseEventConsumer {
  constructor(
    kafkaConsumerService: KafkaConsumerService,
    @Inject(REALTIME_PUBLISHER) private readonly publisher: IRealtimePublisher,
  ) {
    super(kafkaConsumerService);
  }

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return {
      groupId: REALTIME_FANOUT_CONSUMER_GROUP,
      topics: [KafkaTopic.SessionRevoked],
    };
  }

  protected processEvent(event: KafkaEvent): void {
    switch (event.topic) {
      case KafkaTopic.SessionRevoked:
        return this.kickRevoked(event);
      default:
        return;
    }
  }

  private kickRevoked(event: KafkaEvent<KafkaTopic.SessionRevoked>): void {
    if (event.data.scope === 'session') {
      this.publisher.disconnectSession({ sessionId: event.data.sessionId });

      return;
    }

    this.publisher.disconnectFamily({ familyId: event.data.familyId });
  }
}
