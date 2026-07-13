import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerConfig, IKafkaMessagePayload } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { AppInternalException } from '@shared/exceptions/internal.exception';

const baseConfig: IKafkaConsumerConfig = { groupId: 'group-1', topics: [KafkaTopic.SessionRevoked] };

describe('KafkaConsumerService', () => {
  let consumer: DeepMocked<Consumer>;
  let service: KafkaConsumerService;

  beforeEach(() => {
    consumer = createMock<Consumer>();
    jest.spyOn(Kafka.prototype, 'consumer').mockReturnValue(consumer);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new KafkaConsumerService();
  });

  it('exposes a no-op onModuleInit', () => {
    expect(() => service.onModuleInit()).not.toThrow();
  });

  describe('consume', () => {
    it('creates, connects, subscribes and runs the consumer', async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });

      expect(Kafka.prototype.consumer).toHaveBeenCalledWith({ groupId: 'group-1' });
      expect(consumer.connect).toHaveBeenCalled();
      expect(consumer.subscribe).toHaveBeenCalledWith({
        topics: [KafkaTopic.SessionRevoked],
        fromBeginning: false,
      });
      expect(consumer.run).toHaveBeenCalled();
    });

    it('honours fromBeginning when set', async () => {
      await service.consume({ config: { ...baseConfig, fromBeginning: true }, messageHandler: jest.fn() });

      expect(consumer.subscribe).toHaveBeenCalledWith({
        topics: [KafkaTopic.SessionRevoked],
        fromBeginning: true,
      });
    });

    it('maps each message and forwards it to the handler with controls', async () => {
      const handler = jest.fn<Promise<void>, [IKafkaMessagePayload]>();
      await service.consume({ config: baseConfig, messageHandler: handler });

      const runArg = consumer.run.mock.calls[0][0] as {
        autoCommit?: boolean;
        eachMessage: (payload: EachMessagePayload) => Promise<void>;
      };
      expect(runArg.autoCommit).toBe(true);

      const pauseFn = jest.fn();
      const heartbeatFn = jest.fn();
      await runArg.eachMessage({
        topic: 'session_revoked',
        partition: 2,
        message: { key: Buffer.from('k'), value: Buffer.from('v'), timestamp: '1', offset: '10' },
        pause: pauseFn,
        heartbeat: heartbeatFn,
      } as unknown as EachMessagePayload);

      expect(handler).toHaveBeenCalledWith({
        message: {
          topic: 'session_revoked',
          partition: 2,
          message: { key: Buffer.from('k'), value: Buffer.from('v'), timestamp: '1', offset: '10', headers: {} },
        },
        controls: expect.objectContaining({
          pause: pauseFn,
          heartbeat: heartbeatFn,
          seek: expect.any(Function),
          commit: expect.any(Function),
        }),
      });
    });

    it('seeks and commits through the controls bound to the message partition', async () => {
      const handler = jest.fn<Promise<void>, [IKafkaMessagePayload]>();
      await service.consume({ config: { ...baseConfig, autoCommit: false }, messageHandler: handler });

      const runArg = consumer.run.mock.calls[0][0] as {
        autoCommit?: boolean;
        eachMessage: (payload: EachMessagePayload) => Promise<void>;
      };
      expect(runArg.autoCommit).toBe(false);

      await runArg.eachMessage({
        topic: 'session_revoked',
        partition: 3,
        message: { key: null, value: Buffer.from('v'), timestamp: '1', offset: '10' },
        pause: jest.fn(),
        heartbeat: jest.fn(),
      } as unknown as EachMessagePayload);

      const { controls } = handler.mock.calls[0][0];
      controls.seek('10');
      await controls.commit('11');

      expect(consumer.seek).toHaveBeenCalledWith({ topic: 'session_revoked', partition: 3, offset: '10' });
      expect(consumer.commitOffsets).toHaveBeenCalledWith([{ topic: 'session_revoked', partition: 3, offset: '11' }]);
    });

    it('logs and rethrows when the consumer fails to connect', async () => {
      consumer.connect.mockRejectedValue(new Error('connection refused'));

      await expect(service.consume({ config: baseConfig, messageHandler: jest.fn() })).rejects.toThrow(
        'connection refused',
      );
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('logs the crash event reported by the consumer', async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });

      const crashHandler = consumer.on.mock.calls[0][1] as (event: { payload: { error: Error } }) => void;
      crashHandler({ payload: { error: new Error('crashed') } });

      expect(Logger.prototype.error).toHaveBeenCalledWith(expect.stringContaining('crashed'), expect.anything());
    });

    it('invokes onRebalance on rebalancing and on crash', async () => {
      const onRebalance = jest.fn();
      await service.consume({ config: { ...baseConfig, onRebalance }, messageHandler: jest.fn() });

      const crashHandler = consumer.on.mock.calls[0][1] as (event: { payload: { error: Error } }) => void;
      const rebalanceHandler = consumer.on.mock.calls[1][1] as () => void;
      crashHandler({ payload: { error: new Error('crashed') } });
      rebalanceHandler();

      expect(onRebalance).toHaveBeenCalledTimes(2);
    });

    it('disconnects the consumer when subscribe fails (no leak)', async () => {
      consumer.subscribe.mockRejectedValue(new Error('subscribe failed'));

      await expect(service.consume({ config: baseConfig, messageHandler: jest.fn() })).rejects.toThrow(
        'subscribe failed',
      );
      expect(consumer.disconnect).toHaveBeenCalled();
    });

    it('surfaces the original subscribe error even when the cleanup disconnect also fails', async () => {
      consumer.subscribe.mockRejectedValue(new Error('subscribe failed'));
      consumer.disconnect.mockRejectedValue(new Error('cleanup disconnect failed'));

      await expect(service.consume({ config: baseConfig, messageHandler: jest.fn() })).rejects.toThrow(
        'subscribe failed',
      );
    });
  });

  describe('get', () => {
    it('throws when the consumer group is unknown', () => {
      expect(() => service.get('missing')).toThrow(AppInternalException);
    });
  });

  describe('pause / resume', () => {
    beforeEach(async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });
    });

    it('pauses the explicitly provided topics', () => {
      service.pauseTopic({ groupId: 'group-1', topics: ['orders'] });

      expect(consumer.pause).toHaveBeenCalledWith([{ topic: 'orders' }]);
    });

    it('pauses the stored topics when none are provided', () => {
      service.pauseTopic({ groupId: 'group-1' });

      expect(consumer.pause).toHaveBeenCalledWith([{ topic: 'session_revoked' }]);
    });

    it('resumes the stored topics when none are provided', () => {
      service.resumeTopic({ groupId: 'group-1' });

      expect(consumer.resume).toHaveBeenCalledWith([{ topic: 'session_revoked' }]);
    });
  });

  describe('pause / resume with no topics', () => {
    beforeEach(async () => {
      await service.consume({ config: { groupId: 'group-1', topics: [] }, messageHandler: jest.fn() });
    });

    it('warns and does not pause when there are no topics', () => {
      service.pauseTopic({ groupId: 'group-1' });

      expect(consumer.pause).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('warns and does not resume when there are no topics', () => {
      service.resumeTopic({ groupId: 'group-1' });

      expect(consumer.resume).not.toHaveBeenCalled();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });
  });

  describe('seekToOffset', () => {
    beforeEach(async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });
    });

    it('seeks the consumer to the requested offset', () => {
      service.seekToOffset({ groupId: 'group-1', topic: 'session_revoked', partition: 0, offset: '42' });

      expect(consumer.seek).toHaveBeenCalledWith({ topic: 'session_revoked', partition: 0, offset: '42' });
    });

    it('logs and rethrows when seeking fails', () => {
      consumer.seek.mockImplementation(() => {
        throw new Error('seek failed');
      });

      expect(() =>
        service.seekToOffset({ groupId: 'group-1', topic: 'session_revoked', partition: 0, offset: '42' }),
      ).toThrow('seek failed');
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    beforeEach(async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });
    });

    it('disconnects and forgets the consumer', async () => {
      await service.disconnect('group-1');

      expect(consumer.disconnect).toHaveBeenCalled();
      expect(() => service.get('group-1')).toThrow(AppInternalException);
    });

    it('logs and rethrows when disconnect fails', async () => {
      consumer.disconnect.mockRejectedValue(new Error('disconnect failed'));

      await expect(service.disconnect('group-1')).rejects.toThrow('disconnect failed');
      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns a copy of the registered consumers', async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });

      const list = service.list();

      expect(list.get('group-1')).toBe(consumer);
      expect(list).not.toBe(service.list());
    });
  });

  describe('onModuleDestroy', () => {
    it('disconnects all consumers and clears the registry', async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });

      await service.onModuleDestroy();

      expect(consumer.disconnect).toHaveBeenCalled();
      expect(service.list().size).toBe(0);
    });

    it('logs when disconnecting all consumers fails', async () => {
      await service.consume({ config: baseConfig, messageHandler: jest.fn() });
      consumer.disconnect.mockRejectedValue(new Error('shutdown failed'));

      await service.onModuleDestroy();

      expect(Logger.prototype.error).toHaveBeenCalled();
    });
  });
});
