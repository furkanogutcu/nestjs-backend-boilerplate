import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { SpanKind, trace } from '@opentelemetry/api';
import { DataSource } from 'typeorm';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerMessage } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import {
  dedupIdOf,
  IReplayOptions,
  resolveReplayTarget,
  shouldReplay,
} from '@infrastructure/kafka/reliability/dlq/replay.util';
import { kafkaEventSchema } from '@infrastructure/kafka/schemas/kafka-event.schema';

const IDLE_MS = 5000;

@Injectable()
export class DlqReplayService {
  private readonly logger = new Logger(DlqReplayService.name);

  constructor(
    private readonly consumerService: KafkaConsumerService,
    private readonly producer: KafkaProducerService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly metrics?: KafkaMetricsService,
  ) {}

  async run(options: IReplayOptions): Promise<number> {
    const groupId = `dlq-replay-${Date.now()}`;
    let processed = 0;
    let idleTimer: NodeJS.Timeout | undefined;
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const scheduleIdleStop = (): void => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => finish(), IDLE_MS);
    };

    scheduleIdleStop();

    await this.consumerService.consume({
      config: { groupId, topics: [options.topic as KafkaTopic], fromBeginning: true, autoCommit: false },
      messageHandler: async ({ message, controls }) => {
        scheduleIdleStop();

        if (await this.replayMessage({ message, options })) {
          processed += 1;
        }

        await controls.commit((Number(message.message.offset) + 1).toString());

        if (options.limit && processed >= options.limit) {
          finish();
        }
      },
    });

    await done;
    clearTimeout(idleTimer);
    await this.consumerService.disconnect(groupId);

    this.logger.log(
      `DLQ replay finished: ${processed} message(s) ${options.dryRun ? 'matched (dry-run)' : 'replayed'}`,
    );

    return processed;
  }

  async replayMessage(params: { message: IKafkaConsumerMessage; options: IReplayOptions }): Promise<boolean> {
    const { message, options } = params;
    const value = message.message.value?.toString();

    if (!value) {
      return false;
    }

    let json: unknown;

    try {
      json = JSON.parse(value);
    } catch {
      this.logger.warn(`Skipping unparseable DLQ message at offset ${message.message.offset}`);

      return false;
    }

    const parsed = kafkaEventSchema.safeParse(json);

    if (!parsed.success || !shouldReplay({ event: parsed.data, filter: options.filter })) {
      return false;
    }

    const target = resolveReplayTarget({ message, event: parsed.data });

    if (options.dryRun) {
      this.logger.log(`[dry-run] would replay ${parsed.data.meta.eventId} -> ${target.topic}`);

      return true;
    }

    await trace.getTracer('kafka-dlq-replay').startActiveSpan(
      `kafka.replay ${target.topic}`,
      {
        kind: SpanKind.PRODUCER,
        root: true,
        attributes: {
          'messaging.system': 'kafka',
          'messaging.destination.name': target.topic,
          'kafka.event_id': parsed.data.meta.eventId,
          'kafka.replay.origin_trace_id': parsed.data.meta.traceId ?? '',
        },
      },
      async (span) => {
        try {
          if (options.force && options.consumer) {
            await this.dataSource.query('DELETE FROM inbox_messages WHERE consumer = $1 AND dedup_id = $2', [
              options.consumer,
              dedupIdOf(parsed.data),
            ]);
          }

          await this.producer.sendMessage({
            topic: target.topic as KafkaTopic,
            messages: [{ key: target.key, value: parsed.data }],
          });
          this.metrics?.recordDlqReplayed(options.topic);
          this.logger.log(`Replayed ${parsed.data.meta.eventId} -> ${target.topic}`);
        } finally {
          span.end();
        }
      },
    );

    return true;
  }
}
