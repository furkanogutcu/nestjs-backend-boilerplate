import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaHeader } from '@infrastructure/kafka/constants/kafka-headers.constant';
import { BaseIdempotentConsumer } from '@infrastructure/kafka/consumers/base-idempotent-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerConfig,
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { IPendingDeferral } from '@infrastructure/kafka/interfaces/pending-deferral.interface';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { RetryDlqProducer } from '@infrastructure/kafka/reliability/retry/retry-dlq.producer';
import {
  attemptNumber,
  baseTopicOf,
  matchRetryTier,
  nextDestination,
} from '@infrastructure/kafka/reliability/retry/retry-policy.util';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { dlqTopicName, retryTopicNames } from '@infrastructure/kafka/topics/topic-naming.util';

export abstract class BaseRetryableConsumer extends BaseIdempotentConsumer {
  private readonly pending = new Set<IPendingDeferral>();

  constructor(
    kafkaConsumerService: KafkaConsumerService,
    databaseService: DatabaseService,
    inboxService: InboxService,
    protected readonly retryDlqProducer: RetryDlqProducer,
  ) {
    super(kafkaConsumerService, databaseService, inboxService);
  }

  onModuleInit(): void {
    void this.startConsumerWithRetry({
      config: this.getKafkaConsumerConfig(),
      handler: this.handleMainMessage.bind(this),
    });
    void this.startConsumerWithRetry({
      config: this.getRetryConsumerConfig(),
      handler: this.handleRetryMessage.bind(this),
    });
  }

  onModuleDestroy(): void {
    super.onModuleDestroy();
    this.cancelDeferrals();
  }

  // * Cancelled on shutdown and on retry-group rebalance/crash: a stale resume() could target a partition this instance no longer owns, leaving it paused forever. Resuming here un-pauses any still-owned partition.
  private cancelDeferrals(): void {
    for (const deferral of this.pending) {
      clearTimeout(deferral.timer);
      deferral.resume();
    }

    this.pending.clear();
  }

  private getRetryConsumerConfig(): IKafkaConsumerConfig {
    const main = this.getKafkaConsumerConfig();
    const topics = main.topics.flatMap((topic) => retryTopicNames(topic)) as KafkaTopic[];

    return { groupId: `${main.groupId}.retry`, topics, autoCommit: false, onRebalance: () => this.cancelDeferrals() };
  }

  private async handleMainMessage({ message }: IKafkaMessagePayload): Promise<void> {
    const event = this.tryParse(message);

    if (!event) {
      await this.retryDlqProducer.dispatchPoison({
        dlqTopic: dlqTopicName(message.topic),
        message,
        reason: 'unparseable message',
      });

      return;
    }

    try {
      await this.traceProcessing({ message, event, run: async () => await this.processEvent(event) });
    } catch (error) {
      await this.escalate({ message, event, currentTierIndex: null, error });
    }
  }

  private async handleRetryMessage({ message, controls }: IKafkaMessagePayload): Promise<void> {
    const tier = matchRetryTier(message.topic);

    if (tier && this.deferUntilReady({ message, controls, delayMs: tier.delayMs })) {
      return;
    }

    const event = this.tryParse(message);

    if (event) {
      try {
        await this.traceProcessing({ message, event, run: async () => await this.processEvent(event) });
      } catch (error) {
        await this.escalate({ message, event, currentTierIndex: tier ? tier.index : null, error });
      }
    } else {
      await this.retryDlqProducer.dispatchPoison({
        dlqTopic: dlqTopicName(baseTopicOf(message.topic) as KafkaTopic),
        message,
        reason: 'unparseable message',
      });
    }

    await this.commitNext({ message, controls });
  }

  private deferUntilReady(params: {
    message: IKafkaConsumerMessage;
    controls: IKafkaMessageControls;
    delayMs: number;
  }): boolean {
    const { message, controls, delayMs } = params;
    const remaining = Number(message.message.timestamp) + delayMs - Date.now();

    if (remaining <= 0) {
      return false;
    }

    const resume = controls.pause();
    controls.seek(message.message.offset);

    const deferral: IPendingDeferral = { resume } as IPendingDeferral;
    deferral.timer = setTimeout(() => {
      this.pending.delete(deferral);
      resume();
    }, remaining);

    this.pending.add(deferral);

    return true;
  }

  private async escalate(params: {
    message: IKafkaConsumerMessage;
    event: KafkaEvent;
    currentTierIndex: number | null;
    error: unknown;
  }): Promise<void> {
    const { message, event, currentTierIndex, error } = params;

    await this.retryDlqProducer.dispatch({
      destinationTopic: nextDestination({ baseTopic: event.topic, currentTierIndex }),
      event,
      key: message.message.key?.toString(),
      attempt: attemptNumber(currentTierIndex),
      firstFailedAt: message.message.headers[KafkaHeader.FirstFailedAt]?.toString() ?? Date.now().toString(),
      traceparent: message.message.headers[KafkaHeader.Traceparent]?.toString(),
      baggage: message.message.headers[KafkaHeader.Baggage]?.toString(),
      error,
    });
  }

  private tryParse(message: IKafkaConsumerMessage): KafkaEvent | undefined {
    try {
      return this.parseMessage(message);
    } catch (error) {
      this.logger.error(`Dropping unparseable message (${message.topic} o${message.message.offset})`, error);

      return undefined;
    }
  }

  private async commitNext({ message, controls }: IKafkaMessagePayload): Promise<void> {
    await controls.commit((Number(message.message.offset) + 1).toString());
  }
}
