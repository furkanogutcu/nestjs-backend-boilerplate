import { Injectable, Optional } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

@Injectable()
export class InboxService {
  constructor(@Optional() private readonly metrics?: KafkaMetricsService) {}

  async tryConsume(params: { manager: EntityManager; consumer: string; event: KafkaEvent }): Promise<boolean> {
    const { manager, consumer, event } = params;
    const dedupId = event.meta.dedupKey ?? event.meta.eventId;

    const inserted = await manager.query<unknown[]>(
      `INSERT INTO inbox_messages (consumer, dedup_id, topic)
       VALUES ($1, $2, $3)
       ON CONFLICT (consumer, dedup_id) DO NOTHING
       RETURNING dedup_id`,
      [consumer, dedupId, event.topic],
    );

    if (inserted.length === 0) {
      this.metrics?.recordInboxDuplicate();

      return false;
    }

    return true;
  }
}
