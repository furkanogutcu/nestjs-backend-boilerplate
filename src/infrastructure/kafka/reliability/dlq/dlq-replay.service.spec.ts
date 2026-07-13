import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { DlqReplayService } from '@infrastructure/kafka/reliability/dlq/dlq-replay.service';
import { IReplayOptions } from '@infrastructure/kafka/reliability/dlq/replay.util';

const EVENT_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function dlqMessage({ offset, eventId = EVENT_ID }: { offset: number; eventId?: string }): IKafkaConsumerMessage {
  const event = {
    meta: { eventId, eventVersion: 1, timestamp: '1' },
    topic: KafkaTopic.SessionRevoked,
    data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
  };

  return {
    topic: 'session_revoked.dlq' as KafkaTopic,
    partition: 0,
    message: {
      key: Buffer.from('agg-1'),
      value: Buffer.from(JSON.stringify(event)),
      timestamp: '1',
      offset: String(offset),
      headers: {},
    },
  };
}

const baseOptions: IReplayOptions = { topic: 'session_revoked.dlq', dryRun: false, force: false };

describe('DlqReplayService', () => {
  let consumerService: DeepMocked<KafkaConsumerService>;
  let producer: DeepMocked<KafkaProducerService>;
  let dataSource: DeepMocked<DataSource>;
  let metrics: DeepMocked<KafkaMetricsService>;
  let service: DlqReplayService;

  beforeEach(() => {
    consumerService = createMock<KafkaConsumerService>();
    producer = createMock<KafkaProducerService>();
    dataSource = createMock<DataSource>();
    metrics = createMock<KafkaMetricsService>();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    service = new DlqReplayService(consumerService, producer, dataSource, metrics);
  });

  describe('replayMessage', () => {
    it('republishes a valid message to the original topic and records the metric', async () => {
      await expect(service.replayMessage({ message: dlqMessage({ offset: 0 }), options: baseOptions })).resolves.toBe(
        true,
      );

      expect(producer.sendMessage).toHaveBeenCalledWith({
        topic: 'session_revoked',
        messages: [{ key: 'agg-1', value: expect.objectContaining({ topic: 'session_revoked' }) }],
      });
      expect(metrics.recordDlqReplayed).toHaveBeenCalledWith('session_revoked.dlq');
    });

    it('only reports without publishing in dry-run', async () => {
      await expect(
        service.replayMessage({ message: dlqMessage({ offset: 0 }), options: { ...baseOptions, dryRun: true } }),
      ).resolves.toBe(true);

      expect(producer.sendMessage).not.toHaveBeenCalled();
    });

    it('skips a message that does not match the filter', async () => {
      await expect(
        service.replayMessage({ message: dlqMessage({ offset: 0 }), options: { ...baseOptions, filter: 'other' } }),
      ).resolves.toBe(false);

      expect(producer.sendMessage).not.toHaveBeenCalled();
    });

    it('deletes only the targeted consumer inbox row before republishing when forced', async () => {
      await service.replayMessage({
        message: dlqMessage({ offset: 0 }),
        options: { ...baseOptions, force: true, consumer: 'orders' },
      });

      expect(dataSource.query).toHaveBeenCalledWith(
        'DELETE FROM inbox_messages WHERE consumer = $1 AND dedup_id = $2',
        ['orders', EVENT_ID],
      );
      expect(producer.sendMessage).toHaveBeenCalled();
    });

    it('skips an unparseable message', async () => {
      const poison = dlqMessage({ offset: 0 });
      poison.message.value = Buffer.from('not-json');

      await expect(service.replayMessage({ message: poison, options: baseOptions })).resolves.toBe(false);
      expect(producer.sendMessage).not.toHaveBeenCalled();
    });

    it('skips a message with an empty value', async () => {
      const empty = dlqMessage({ offset: 0 });
      empty.message.value = null;

      await expect(service.replayMessage({ message: empty, options: baseOptions })).resolves.toBe(false);
      expect(producer.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('run', () => {
    function controls(): IKafkaMessageControls {
      return { pause: jest.fn(), heartbeat: jest.fn(), seek: jest.fn(), commit: jest.fn() };
    }

    it('replays delivered messages, commits the next offset and disconnects on limit', async () => {
      let handler!: (payload: IKafkaMessagePayload) => Promise<void>;
      consumerService.consume.mockImplementation(async ({ messageHandler }) => {
        await Promise.resolve();
        handler = messageHandler;
      });

      const promise = service.run({ ...baseOptions, limit: 2 });
      await Promise.resolve();

      const firstControls = controls();
      await handler({ message: dlqMessage({ offset: 5 }), controls: firstControls });
      await handler({ message: dlqMessage({ offset: 6 }), controls: controls() });

      const processed = await promise;

      expect(processed).toBe(2);
      expect(producer.sendMessage).toHaveBeenCalledTimes(2);
      expect(firstControls.commit).toHaveBeenCalledWith('6');
      expect(consumerService.disconnect).toHaveBeenCalled();
    });

    it('stops on idle when no limit is given', async () => {
      jest.useFakeTimers();
      consumerService.consume.mockResolvedValue(undefined);

      const promise = service.run(baseOptions);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(5000);

      await expect(promise).resolves.toBe(0);
      expect(consumerService.disconnect).toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('counts matches without publishing when run in dry-run', async () => {
      let handler!: (payload: IKafkaMessagePayload) => Promise<void>;
      consumerService.consume.mockImplementation(async ({ messageHandler }) => {
        await Promise.resolve();
        handler = messageHandler;
      });

      const promise = service.run({ ...baseOptions, dryRun: true, limit: 1 });
      await Promise.resolve();
      await handler({ message: dlqMessage({ offset: 5 }), controls: controls() });

      const processed = await promise;

      expect(processed).toBe(1);
      expect(producer.sendMessage).not.toHaveBeenCalled();
      expect(consumerService.disconnect).toHaveBeenCalled();
    });
  });
});
