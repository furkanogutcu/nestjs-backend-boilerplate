import { EntityManager } from 'typeorm';

import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseEventConsumer } from '@infrastructure/kafka/consumers/base-event-consumer.abstract';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

export abstract class BaseIdempotentConsumer extends BaseEventConsumer {
  constructor(
    kafkaConsumerService: KafkaConsumerService,
    protected readonly databaseService: DatabaseService,
    protected readonly inboxService: InboxService,
  ) {
    super(kafkaConsumerService);
  }

  /**
   * Domain handler. MUST use the provided `manager` for all DB writes so the work stays atomic
   * with the inbox dedup row — do NOT open an independent transaction (e.g. another
   * `runInTransaction`/`DataSource`), or exactly-once-effect is lost. Throwing rolls back both the
   * inbox row and the work, and the message is redelivered.
   *
   * The exactly-once-effect guarantee covers ONLY DB writes made through `manager`. External
   * side-effects (email, HTTP calls, publishing another event) are NOT transactional and remain
   * at-least-once: if the effect fires and the transaction then rolls back, redelivery repeats it.
   * To make such an effect exactly-once, do NOT perform it here directly — enqueue a follow-up event
   * via `outboxService.enqueue({ manager, ... })` in this same transaction and let a dedicated
   * consumer carry it out (still at-least-once on the wire, but deduped by its own inbox row).
   */
  protected abstract handleEvent(params: { event: KafkaEvent; manager: EntityManager }): Promise<void> | void;

  protected async processEvent(event: KafkaEvent): Promise<void> {
    const consumer = this.getKafkaConsumerConfig().groupId;

    await this.databaseService.runInTransaction(async (manager) => {
      const isNew = await this.inboxService.tryConsume({ manager, consumer, event });

      if (!isNew) {
        this.logger.debug(`Duplicate event ${event.meta.eventId} skipped for consumer ${consumer}`);
        return;
      }

      await this.handleEvent({ event, manager });
    });
  }
}
