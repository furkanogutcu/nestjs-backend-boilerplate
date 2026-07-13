import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseRetryableConsumer } from '@infrastructure/kafka/consumers/base-retryable-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerConfig,
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessageHandler,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { RetryDlqProducer } from '@infrastructure/kafka/reliability/retry/retry-dlq.producer';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { createMockEntityManager } from '@test/helpers';

const EVENT_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

class TestConsumer extends BaseRetryableConsumer {
  readonly handleSpy = jest.fn();

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return { groupId: 'g', topics: [KafkaTopic.SessionRevoked] };
  }

  protected handleEvent({ event, manager }: { event: KafkaEvent; manager: EntityManager }): Promise<void> | void {
    return this.handleSpy(event, manager) as Promise<void>;
  }
}

interface IMessageOptions {
  offset?: string;
  timestamp?: string;
  headers?: Record<string, Buffer>;
}

function messageFor({ topic, offset, timestamp, headers }: { topic: string } & IMessageOptions): IKafkaConsumerMessage {
  const event = {
    meta: { eventId: EVENT_ID, eventVersion: 1, timestamp: '1' },
    topic: KafkaTopic.SessionRevoked,
    data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
  };

  return {
    topic: topic as KafkaTopic,
    partition: 0,
    message: {
      key: null,
      value: Buffer.from(JSON.stringify(event)),
      timestamp: timestamp ?? '1',
      offset: offset ?? '1',
      headers: headers ?? {},
    },
  };
}

function createControls(resume = jest.fn()): jest.Mocked<IKafkaMessageControls> {
  return { pause: jest.fn(() => resume), heartbeat: jest.fn(), seek: jest.fn(), commit: jest.fn() };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BaseRetryableConsumer', () => {
  let kafkaConsumerService: DeepMocked<KafkaConsumerService>;
  let databaseService: DeepMocked<DatabaseService>;
  let inboxService: DeepMocked<InboxService>;
  let retryDlqProducer: DeepMocked<RetryDlqProducer>;
  let manager: DeepMocked<EntityManager>;
  let consumer: TestConsumer;

  beforeEach(() => {
    kafkaConsumerService = createMock<KafkaConsumerService>();
    databaseService = createMock<DatabaseService>();
    inboxService = createMock<InboxService>();
    retryDlqProducer = createMock<RetryDlqProducer>();
    manager = createMockEntityManager();
    databaseService.runInTransaction.mockImplementation(async (handler) => await handler(manager));
    inboxService.tryConsume.mockResolvedValue(true);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    consumer = new TestConsumer(kafkaConsumerService, databaseService, inboxService, retryDlqProducer);
  });

  async function getHandlers(): Promise<{ main: IKafkaMessageHandler; retry: IKafkaMessageHandler }> {
    consumer.onModuleInit();
    await flushMicrotasks();

    return {
      main: kafkaConsumerService.consume.mock.calls[0][0].messageHandler,
      retry: kafkaConsumerService.consume.mock.calls[1][0].messageHandler,
    };
  }

  it('starts a main consumer and a separate retry consumer group', async () => {
    await getHandlers();

    expect(kafkaConsumerService.consume).toHaveBeenNthCalledWith(1, {
      config: { groupId: 'g', topics: [KafkaTopic.SessionRevoked] },
      messageHandler: expect.any(Function),
    });
    expect(kafkaConsumerService.consume).toHaveBeenNthCalledWith(2, {
      config: {
        groupId: 'g.retry',
        topics: ['session_revoked.retry.5s', 'session_revoked.retry.1m', 'session_revoked.retry.10m'],
        autoCommit: false,
        onRebalance: expect.any(Function),
      },
      messageHandler: expect.any(Function),
    });
  });

  describe('main consumer', () => {
    it('processes a message through the inbox without escalating', async () => {
      const { main } = await getHandlers();

      await main({ message: messageFor({ topic: 'session_revoked' }), controls: createControls() });

      expect(consumer.handleSpy).toHaveBeenCalled();
      expect(retryDlqProducer.dispatch).not.toHaveBeenCalled();
    });

    it('escalates to the first retry tier when processing fails', async () => {
      consumer.handleSpy.mockRejectedValue(new Error('boom'));
      const { main } = await getHandlers();

      await main({ message: messageFor({ topic: 'session_revoked' }), controls: createControls() });

      expect(retryDlqProducer.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ destinationTopic: 'session_revoked.retry.5s', attempt: 1 }),
      );
    });

    it('routes an unparseable message to the dlq without escalating', async () => {
      const { main } = await getHandlers();
      const poison: IKafkaConsumerMessage = {
        topic: KafkaTopic.SessionRevoked,
        partition: 0,
        message: { key: null, value: Buffer.from('not-json'), timestamp: '1', offset: '1', headers: {} },
      };

      await main({ message: poison, controls: createControls() });

      expect(consumer.handleSpy).not.toHaveBeenCalled();
      expect(retryDlqProducer.dispatch).not.toHaveBeenCalled();
      expect(retryDlqProducer.dispatchPoison).toHaveBeenCalledWith({
        dlqTopic: 'session_revoked.dlq',
        message: poison,
        reason: expect.any(String),
      });
    });
  });

  describe('retry consumer', () => {
    it('defers an unready message by pausing and seeking without committing', async () => {
      jest.useFakeTimers();
      const controls = createControls();
      const { retry } = await getHandlers();

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.10m', offset: '5', timestamp: Date.now().toString() }),
        controls,
      });

      expect(controls.pause).toHaveBeenCalled();
      expect(controls.seek).toHaveBeenCalledWith('5');
      expect(controls.commit).not.toHaveBeenCalled();
      expect(consumer.handleSpy).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('processes a ready message and commits the next offset', async () => {
      const controls = createControls();
      const { retry } = await getHandlers();

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.5s', offset: '7', timestamp: '0' }),
        controls,
      });

      expect(consumer.handleSpy).toHaveBeenCalled();
      expect(controls.commit).toHaveBeenCalledWith('8');
    });

    it('escalates a failed retry to the next tier and still commits', async () => {
      consumer.handleSpy.mockRejectedValue(new Error('boom'));
      const controls = createControls();
      const { retry } = await getHandlers();

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.5s', offset: '7', timestamp: '0' }),
        controls,
      });

      expect(retryDlqProducer.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ destinationTopic: 'session_revoked.retry.1m', attempt: 2 }),
      );
      expect(controls.commit).toHaveBeenCalledWith('8');
    });

    it('routes a failure on the last tier to the dlq', async () => {
      consumer.handleSpy.mockRejectedValue(new Error('boom'));
      const controls = createControls();
      const { retry } = await getHandlers();

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.10m', offset: '7', timestamp: '0' }),
        controls,
      });

      expect(retryDlqProducer.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ destinationTopic: 'session_revoked.dlq' }),
      );
    });

    it('commits and drops an unparseable retry message', async () => {
      const controls = createControls();
      const { retry } = await getHandlers();
      const poison: IKafkaConsumerMessage = {
        topic: 'session_revoked.retry.5s' as KafkaTopic,
        partition: 0,
        message: { key: null, value: Buffer.from('not-json'), timestamp: '0', offset: '9', headers: {} },
      };

      await retry({ message: poison, controls });

      expect(consumer.handleSpy).not.toHaveBeenCalled();
      expect(retryDlqProducer.dispatch).not.toHaveBeenCalled();
      expect(retryDlqProducer.dispatchPoison).toHaveBeenCalledWith({
        dlqTopic: 'session_revoked.dlq',
        message: poison,
        reason: expect.any(String),
      });
      expect(controls.commit).toHaveBeenCalledWith('10');
    });

    it('resumes a deferred message once the delay elapses', async () => {
      jest.useFakeTimers();
      const resume = jest.fn();
      const controls = createControls(resume);
      const { retry } = await getHandlers();

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.5s', offset: '5', timestamp: Date.now().toString() }),
        controls,
      });
      expect(resume).not.toHaveBeenCalled();

      jest.advanceTimersByTime(5_000);
      expect(resume).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('resumes the partition and clears the timer on destroy', async () => {
      jest.useFakeTimers();
      const resume = jest.fn();
      const controls = createControls(resume);
      const { retry } = await getHandlers();

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.10m', offset: '5', timestamp: Date.now().toString() }),
        controls,
      });
      consumer.onModuleDestroy();

      expect(resume).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(600_000);
      expect(resume).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('cancels pending deferrals when the retry group rebalances', async () => {
      jest.useFakeTimers();
      const resume = jest.fn();
      const controls = createControls(resume);
      await getHandlers();
      const onRebalance = kafkaConsumerService.consume.mock.calls[1][0].config.onRebalance!;
      const { retry } = { retry: kafkaConsumerService.consume.mock.calls[1][0].messageHandler };

      await retry({
        message: messageFor({ topic: 'session_revoked.retry.10m', offset: '5', timestamp: Date.now().toString() }),
        controls,
      });
      onRebalance();

      expect(resume).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(600_000);
      expect(resume).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });
  });
});
