import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Kafka, Partitioners, Producer } from 'kafkajs';

import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaProducerMessage } from '@infrastructure/kafka/interfaces/kafka-message.interface';

const event = {
  meta: {
    eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    eventVersion: 1,
    timestamp: '1700000000000',
    traceId: 'trace-1',
  },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
};

const message = {
  topic: KafkaTopic.SessionRevoked,
  messages: [{ key: 'k1', value: event }],
} as unknown as IKafkaProducerMessage;

const expectedHeaders = {
  'x-event-id': 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  'x-event-type': 'session_revoked',
  'x-event-version': '1',
  'x-trace-id': 'trace-1',
};

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('KafkaProducerService', () => {
  let producer: DeepMocked<Producer>;
  let service: KafkaProducerService;

  beforeEach(() => {
    producer = createMock<Producer>();
    producer.connect.mockResolvedValue(undefined);
    jest.spyOn(Kafka.prototype, 'producer').mockReturnValue(producer);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service = new KafkaProducerService();
  });

  it('creates an idempotent producer and connects on init', async () => {
    service.onModuleInit();
    await flushMicrotasks();

    expect(Kafka.prototype.producer).toHaveBeenCalledWith({
      createPartitioner: Partitioners.DefaultPartitioner,
      idempotent: true,
      maxInFlightRequests: 1,
    });
    expect(producer.connect).toHaveBeenCalledTimes(1);
    expect(service.isConnected()).toBe(true);
  });

  it('reports disconnected until the producer connects', async () => {
    jest.useFakeTimers();
    producer.connect.mockRejectedValue(new Error('no brokers'));

    service.onModuleInit();
    await flushMicrotasks();

    expect(service.isConnected()).toBe(false);

    jest.useRealTimers();
  });

  it('serializes value, sets acks=all and mirrors metadata headers for a single message', async () => {
    service.onModuleInit();

    await service.sendMessage(message);

    expect(producer.send).toHaveBeenCalledWith({
      topic: 'session_revoked',
      acks: -1,
      messages: [{ key: 'k1', value: JSON.stringify(event), headers: expectedHeaders }],
    });
  });

  it('serializes value, sets acks=all and mirrors metadata headers for a batch', async () => {
    service.onModuleInit();

    await service.sendMessages([message]);

    expect(producer.sendBatch).toHaveBeenCalledWith({
      acks: -1,
      topicMessages: [
        {
          topic: 'session_revoked',
          messages: [{ key: 'k1', value: JSON.stringify(event), headers: expectedHeaders }],
        },
      ],
    });
  });

  it('sends raw bytes with acks=all, defaulting a null key to undefined', async () => {
    service.onModuleInit();
    const value = Buffer.from('raw-bytes');

    await service.sendRaw({
      topic: 'session_revoked.dlq',
      message: { key: null, value, headers: { 'x-original-topic': 'session_revoked' } },
    });

    expect(producer.send).toHaveBeenCalledWith({
      topic: 'session_revoked.dlq',
      acks: -1,
      messages: [{ key: undefined, value, headers: { 'x-original-topic': 'session_revoked' } }],
    });
  });

  it('preserves a provided raw key when sending raw bytes', async () => {
    service.onModuleInit();
    const key = Buffer.from('agg-1');

    await service.sendRaw({ topic: 'session_revoked.dlq', message: { key, value: Buffer.from('raw') } });

    expect(producer.send.mock.calls[0][0].messages[0].key).toBe(key);
  });

  it('schedules a reconnect after a failed connection', async () => {
    jest.useFakeTimers();
    producer.connect.mockRejectedValueOnce(new Error('no brokers')).mockResolvedValue(undefined);

    service.onModuleInit();
    await flushMicrotasks();
    expect(producer.connect).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5000);
    expect(producer.connect).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('clears a pending reconnect timer and disconnects on destroy', async () => {
    jest.useFakeTimers();
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    producer.connect.mockRejectedValue(new Error('no brokers'));

    service.onModuleInit();
    await flushMicrotasks();

    await service.onModuleDestroy();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(producer.disconnect).toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('logs and swallows errors when disconnecting fails', async () => {
    service.onModuleInit();
    await flushMicrotasks();
    producer.disconnect.mockRejectedValue(new Error('disconnect failed'));

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});
