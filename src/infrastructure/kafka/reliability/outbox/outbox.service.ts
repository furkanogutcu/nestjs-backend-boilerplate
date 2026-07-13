import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { appConfig } from '@config/app.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { buildMetadataHeaders } from '@infrastructure/kafka/client/event-headers.util';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { injectTraceContext } from '@infrastructure/kafka/observability/kafka-trace.util';
import { OutboxMessage } from '@infrastructure/kafka/reliability/outbox/entities/outbox-message.entity';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { KafkaEvent, KafkaEventData } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { getCurrentTraceIds } from '@infrastructure/observability/otel.helpers';
import { generateUuid } from '@shared/utils/uuid.util';

export interface IOutboxEnqueueParams<T extends KafkaTopic> {
  topic: T;
  data: KafkaEventData<T>;
  key?: string;
  dedupKey?: string;
  eventVersion?: number;
  correlationId?: string;
}

@Injectable()
export class OutboxService {
  constructor(private readonly clock: ClockService) {}

  /**
   * Writes an event to the outbox in the caller's transaction (atomic with the business write).
   * Pass a stable `dedupKey` for business-level idempotency — it must be identical across retries
   * of the same logical operation, otherwise consumer inbox dedup is bypassed. When omitted, a
   * fresh `eventId` is used (transport-level dedup only).
   */
  async enqueue<T extends KafkaTopic>(args: {
    manager: EntityManager;
    params: IOutboxEnqueueParams<T>;
  }): Promise<OutboxMessage> {
    const { manager, params } = args;
    const event = this.buildEvent(params);
    const repository = manager.getRepository(OutboxMessage);

    const message = repository.create({
      id: event.meta.eventId,
      topic: params.topic,
      partitionKey: params.key ?? null,
      payload: event,
      headers: injectTraceContext(buildMetadataHeaders(event)),
      status: OutboxStatus.Pending,
    });

    await repository.insert(message);

    return message;
  }

  private buildEvent<T extends KafkaTopic>(params: IOutboxEnqueueParams<T>): KafkaEvent<T> {
    return {
      meta: {
        eventId: generateUuid(),
        eventVersion: params.eventVersion ?? 1,
        timestamp: this.clock.epochMillis().toString(),
        dedupKey: params.dedupKey,
        traceId: getCurrentTraceIds()?.trace_id,
        correlationId: params.correlationId,
        producer: appConfig.slug,
      },
      topic: params.topic,
      data: params.data,
    } as KafkaEvent<T>;
  }
}
