import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { BaseEventConsumer } from '@infrastructure/kafka/consumers/base-event-consumer.abstract';
import { ConsumerErrorPolicy } from '@infrastructure/kafka/enums/consumer-error-policy.enum';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerConfig,
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

class TestConsumer extends BaseEventConsumer {
  readonly processSpy = jest.fn();

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return { groupId: 'group-1', topics: [KafkaTopic.SessionRevoked] };
  }

  protected processEvent(event: KafkaEvent): Promise<void> | void {
    return this.processSpy(event) as Promise<void>;
  }
}

class HaltConsumer extends TestConsumer {
  protected readonly errorPolicy = ConsumerErrorPolicy.Halt;
}

const validEvent = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 1, timestamp: '1' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
};

function messageWith(value: string | null): IKafkaConsumerMessage {
  return {
    topic: KafkaTopic.SessionRevoked,
    partition: 0,
    message: {
      key: null,
      value: value === null ? null : Buffer.from(value),
      timestamp: '1',
      offset: '10',
      headers: {},
    },
  };
}

function payloadWith(value: string | null): IKafkaMessagePayload {
  return { message: messageWith(value), controls: createMock<IKafkaMessageControls>() };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('BaseEventConsumer', () => {
  let kafkaConsumerService: DeepMocked<KafkaConsumerService>;
  let consumer: TestConsumer;

  beforeEach(() => {
    kafkaConsumerService = createMock<KafkaConsumerService>();
    consumer = new TestConsumer(kafkaConsumerService);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  describe('handleMessage', () => {
    it('parses and processes a valid event', async () => {
      await consumer.handleMessage(payloadWith(JSON.stringify(validEvent)));

      expect(consumer.processSpy).toHaveBeenCalledWith(validEvent);
    });

    it('skips an empty message under the Skip policy', async () => {
      await consumer.handleMessage(payloadWith(null));

      expect(consumer.processSpy).not.toHaveBeenCalled();
      expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('[SKIP]'), expect.anything());
    });

    it('skips a non-JSON message under the Skip policy', async () => {
      await consumer.handleMessage(payloadWith('not-json'));

      expect(consumer.processSpy).not.toHaveBeenCalled();
    });

    it('skips a schema-invalid message under the Skip policy', async () => {
      await consumer.handleMessage(payloadWith(JSON.stringify({ topic: 'unknown' })));

      expect(consumer.processSpy).not.toHaveBeenCalled();
    });

    it('halts (rethrows) an unprocessable message under the Halt policy', async () => {
      const haltConsumer = new HaltConsumer(kafkaConsumerService);

      await expect(haltConsumer.handleMessage(payloadWith(null))).rejects.toBeInstanceOf(Error);
      expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('[HALT]'), expect.anything());
    });

    it('rethrows when processing the event fails', async () => {
      consumer.processSpy.mockRejectedValue(new Error('processing failed'));

      await expect(consumer.handleMessage(payloadWith(JSON.stringify(validEvent)))).rejects.toThrow(
        'processing failed',
      );
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('Processing failed'),
        expect.anything(),
      );
    });
  });

  describe('lifecycle', () => {
    it('starts consuming on init with a bound message handler', async () => {
      kafkaConsumerService.consume.mockResolvedValue(undefined);

      consumer.onModuleInit();
      await flushMicrotasks();

      expect(kafkaConsumerService.consume).toHaveBeenCalledWith({
        config: { groupId: 'group-1', topics: [KafkaTopic.SessionRevoked] },
        messageHandler: expect.any(Function),
      });
    });

    it('retries starting the consumer after a failure', async () => {
      jest.useFakeTimers();
      kafkaConsumerService.consume.mockRejectedValueOnce(new Error('no brokers')).mockResolvedValue(undefined);

      consumer.onModuleInit();
      await flushMicrotasks();
      expect(kafkaConsumerService.consume).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(5000);
      expect(kafkaConsumerService.consume).toHaveBeenCalledTimes(2);

      jest.useRealTimers();
    });

    it('clears a pending reconnect timer on destroy', async () => {
      jest.useFakeTimers();
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      kafkaConsumerService.consume.mockRejectedValue(new Error('no brokers'));

      consumer.onModuleInit();
      await flushMicrotasks();
      consumer.onModuleDestroy();

      expect(clearTimeoutSpy).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('does nothing on destroy when there is no pending timer', () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      consumer.onModuleDestroy();

      expect(clearTimeoutSpy).not.toHaveBeenCalled();
    });
  });
});
