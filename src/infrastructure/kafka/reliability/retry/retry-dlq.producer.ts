import { Injectable, Optional } from '@nestjs/common';

import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaHeader } from '@infrastructure/kafka/constants/kafka-headers.constant';
import { RETRY_TIERS } from '@infrastructure/kafka/constants/retry.constant';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerMessage } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { matchRetryTier } from '@infrastructure/kafka/reliability/retry/retry-policy.util';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

export interface IDispatchParams {
  destinationTopic: string;
  event: KafkaEvent;
  key?: string;
  attempt: number;
  firstFailedAt: string;
  traceparent?: string;
  baggage?: string;
  error: unknown;
}

@Injectable()
export class RetryDlqProducer {
  constructor(
    private readonly producer: KafkaProducerService,
    @Optional() private readonly metrics?: KafkaMetricsService,
  ) {}

  async dispatch(params: IDispatchParams): Promise<void> {
    const headers: Record<string, string> = {
      [KafkaHeader.OriginalTopic]: params.event.topic,
      [KafkaHeader.RetryAttempt]: String(params.attempt),
      [KafkaHeader.FirstFailedAt]: params.firstFailedAt,
      [KafkaHeader.LastError]: params.error instanceof Error ? params.error.message : String(params.error),
    };

    if (params.traceparent) {
      headers[KafkaHeader.Traceparent] = params.traceparent;
    }

    if (params.baggage) {
      headers[KafkaHeader.Baggage] = params.baggage;
    }

    await this.producer.sendMessage({
      topic: params.destinationTopic as KafkaTopic,
      messages: [{ key: params.key, value: params.event, headers }],
    });

    this.recordMetric(params.destinationTopic);
  }

  // * Routes an unparseable (poison) message to the DLQ with raw bytes preserved, so it is never silently dropped and an operator can inspect it.
  async dispatchPoison(params: { dlqTopic: string; message: IKafkaConsumerMessage; reason: string }): Promise<void> {
    const { dlqTopic, message, reason } = params;

    await this.producer.sendRaw({
      topic: dlqTopic,
      message: {
        key: message.message.key,
        value: message.message.value,
        headers: {
          ...message.message.headers,
          [KafkaHeader.OriginalTopic]: message.topic,
          [KafkaHeader.LastError]: reason,
        },
      },
    });

    this.metrics?.recordDlq(dlqTopic);
  }

  private recordMetric(destinationTopic: string): void {
    const tier = matchRetryTier(destinationTopic);

    if (tier) {
      this.metrics?.recordRetry(RETRY_TIERS[tier.index].suffix);
    } else {
      this.metrics?.recordDlq(destinationTopic);
    }
  }
}
