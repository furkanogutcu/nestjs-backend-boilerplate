import { Injectable } from '@nestjs/common';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseEventConsumer } from '@infrastructure/kafka/consumers/base-event-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerConfig } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

import { REVOCATION_RECONCILE_CONSUMER_GROUP } from '../constants/auth.constant';
import { RevocationService } from '../services/revocation.service';

// * Durability net for the revocation denylist. The inline Redis write on logout / refresh-token-reuse is best-effort,
// * so a Redis blip could leave a revoked session's token accepted (by both HTTP and WS) until it expires. This
// * consumer replays the SessionRevoked outbox event and (re)writes the denylist key, retrying via Kafka redelivery
// * until it succeeds — turning "best-effort + eventually reconciled" into a durable guarantee. No inbox dedup: the
// * write is idempotent (re-setting a key just refreshes its TTL), so a duplicate delivery is a harmless no-op.
@Injectable()
export class RevocationReconcileConsumer extends BaseEventConsumer {
  constructor(
    kafkaConsumerService: KafkaConsumerService,
    private readonly revocationService: RevocationService,
  ) {
    super(kafkaConsumerService);
  }

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return {
      groupId: REVOCATION_RECONCILE_CONSUMER_GROUP,
      topics: [KafkaTopic.SessionRevoked],
    };
  }

  protected async processEvent(event: KafkaEvent): Promise<void> {
    if (event.topic !== KafkaTopic.SessionRevoked) {
      return;
    }

    if (event.data.scope === 'session') {
      await this.revocationService.reconcileSession({ sessionId: event.data.sessionId });

      return;
    }

    await this.revocationService.reconcileFamily({ familyId: event.data.familyId });
  }
}
