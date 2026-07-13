import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';

import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseIdempotentConsumer } from '@infrastructure/kafka/consumers/base-idempotent-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerConfig,
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { createMockEntityManager } from '@test/helpers';

class TestConsumer extends BaseIdempotentConsumer {
  readonly handleSpy = jest.fn();

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return { groupId: 'group-1', topics: [KafkaTopic.SessionRevoked] };
  }

  protected handleEvent({ event, manager }: { event: KafkaEvent; manager: EntityManager }): Promise<void> | void {
    return this.handleSpy(event, manager) as Promise<void>;
  }
}

const validEvent = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 1, timestamp: '1' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
};

function messageWith(value: string): IKafkaConsumerMessage {
  return {
    topic: KafkaTopic.SessionRevoked,
    partition: 0,
    message: { key: null, value: Buffer.from(value), timestamp: '1', offset: '1', headers: {} },
  };
}

function payloadWith(value: string): IKafkaMessagePayload {
  return { message: messageWith(value), controls: createMock<IKafkaMessageControls>() };
}

describe('BaseIdempotentConsumer', () => {
  let kafkaConsumerService: DeepMocked<KafkaConsumerService>;
  let databaseService: DeepMocked<DatabaseService>;
  let inboxService: DeepMocked<InboxService>;
  let manager: DeepMocked<EntityManager>;
  let consumer: TestConsumer;

  beforeEach(() => {
    kafkaConsumerService = createMock<KafkaConsumerService>();
    databaseService = createMock<DatabaseService>();
    inboxService = createMock<InboxService>();
    manager = createMockEntityManager();
    databaseService.runInTransaction.mockImplementation(async (handler) => await handler(manager));
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    consumer = new TestConsumer(kafkaConsumerService, databaseService, inboxService);
  });

  it('processes a new event inside the transaction with the inbox manager', async () => {
    inboxService.tryConsume.mockResolvedValue(true);

    await consumer.handleMessage(payloadWith(JSON.stringify(validEvent)));

    expect(inboxService.tryConsume).toHaveBeenCalledWith({ manager, consumer: 'group-1', event: validEvent });
    expect(consumer.handleSpy).toHaveBeenCalledWith(validEvent, manager);
  });

  it('skips a duplicate event without invoking the handler', async () => {
    inboxService.tryConsume.mockResolvedValue(false);

    await consumer.handleMessage(payloadWith(JSON.stringify(validEvent)));

    expect(consumer.handleSpy).not.toHaveBeenCalled();
  });

  it('rethrows when the handler fails so the message is redelivered', async () => {
    inboxService.tryConsume.mockResolvedValue(true);
    consumer.handleSpy.mockRejectedValue(new Error('handler failed'));

    await expect(consumer.handleMessage(payloadWith(JSON.stringify(validEvent)))).rejects.toThrow('handler failed');
  });
});
