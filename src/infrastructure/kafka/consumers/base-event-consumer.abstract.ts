import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { ConsumerErrorPolicy } from '@infrastructure/kafka/enums/consumer-error-policy.enum';
import {
  IKafkaConsumerConfig,
  IKafkaConsumerMessage,
  IKafkaMessageHandler,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { extractTraceContext } from '@infrastructure/kafka/observability/kafka-trace.util';
import { KafkaEvent, kafkaEventSchema } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { AppInternalException } from '@shared/exceptions/internal.exception';

const RECONNECT_DELAY_MS = 5000;

export abstract class BaseEventConsumer implements OnModuleInit, OnModuleDestroy {
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly errorPolicy: ConsumerErrorPolicy = ConsumerErrorPolicy.Skip;
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();

  constructor(protected readonly kafkaConsumerService: KafkaConsumerService) {}

  abstract getKafkaConsumerConfig(): IKafkaConsumerConfig;

  protected abstract processEvent(kafkaEvent: KafkaEvent): Promise<void> | void;

  onModuleInit(): void {
    void this.startConsumerWithRetry({ config: this.getKafkaConsumerConfig(), handler: this.handleMessage.bind(this) });
  }

  onModuleDestroy(): void {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }

    this.reconnectTimers.clear();
  }

  async handleMessage({ message }: IKafkaMessagePayload): Promise<void> {
    const location = `${message.topic} p${message.partition} o${message.message.offset}`;

    let event: KafkaEvent;

    try {
      event = this.parseMessage(message);
    } catch (error) {
      if (this.errorPolicy === ConsumerErrorPolicy.Halt) {
        this.logger.error(`[HALT] Unprocessable message (${location}); halting partition for fix-forward`, error);
        throw error;
      }

      this.logger.error(`[SKIP] Dropping unprocessable message (${location})`, error);
      return;
    }

    try {
      await this.traceProcessing({ message, event, run: async () => await this.processEvent(event) });
    } catch (error) {
      this.logger.error(`Processing failed (${location}); will retry`, error);
      throw error;
    }
  }

  // * Continues the producer's trace (from message headers) so the HTTP -> outbox -> publish -> consume chain is one waterfall.
  protected async traceProcessing(params: {
    message: IKafkaConsumerMessage;
    event: KafkaEvent;
    run: () => Promise<void> | void;
  }): Promise<void> {
    const { message, event, run } = params;
    const parentContext = extractTraceContext(message.message.headers);

    await context.with(
      parentContext,
      async () =>
        await trace.getTracer('kafka-consumer').startActiveSpan(
          `kafka.consume ${event.topic}`,
          {
            kind: SpanKind.CONSUMER,
            attributes: {
              'messaging.system': 'kafka',
              'messaging.operation': 'process',
              'messaging.destination.name': event.topic,
              'kafka.event_id': event.meta.eventId,
            },
          },
          async (span) => {
            try {
              await run();
            } catch (error) {
              span.recordException(error as Error);
              span.setStatus({ code: SpanStatusCode.ERROR });
              throw error;
            } finally {
              span.end();
            }
          },
        ),
    );
  }

  protected parseMessage({ message }: IKafkaConsumerMessage): KafkaEvent {
    const messageValue = message.value?.toString();

    if (!messageValue) {
      throw new AppInternalException({ message: 'Message value is empty' });
    }

    const parsedPayload: unknown = JSON.parse(messageValue);

    return this.validateKafkaEvent(parsedPayload);
  }

  protected validateKafkaEvent(payload: unknown): KafkaEvent {
    try {
      return kafkaEventSchema.parse(payload);
    } catch (error) {
      throw new AppInternalException({
        message: 'Failed to validate event payload',
        error: error instanceof Error ? error : undefined,
      });
    }
  }

  protected async startConsumerWithRetry(params: {
    config: IKafkaConsumerConfig;
    handler: IKafkaMessageHandler;
  }): Promise<void> {
    const { config, handler } = params;

    try {
      await this.kafkaConsumerService.consume({ config, messageHandler: handler });

      this.reconnectTimers.delete(config.groupId);
    } catch (error) {
      this.logger.error(`Failed to start consumer ${config.groupId}; retrying in ${RECONNECT_DELAY_MS}ms`, error);
      this.reconnectTimers.set(
        config.groupId,
        setTimeout(() => void this.startConsumerWithRetry({ config, handler }), RECONNECT_DELAY_MS),
      );
    }
  }
}
