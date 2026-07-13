import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';

import { env } from '@config/env.config';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { OutboxRelayProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-relay.processor';
import { createMockDataSource, createMockEntityManager } from '@test/helpers';

const payloadA = {
  meta: { eventId: 'a', eventVersion: 1, timestamp: '1' },
  topic: 'session_revoked',
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
};
const payloadB = {
  meta: { eventId: 'b', eventVersion: 1, timestamp: '2' },
  topic: 'session_revoked',
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
};

const pendingRows = [
  { id: 'a', topic: 'session_revoked', partition_key: 'k-a', payload: payloadA, headers: { 'x-event-id': 'a' } },
  { id: 'b', topic: 'session_revoked', partition_key: 'k-b', payload: payloadB, headers: null },
];

interface IQueryStub {
  locked?: boolean;
  rows?: unknown[];
}

function stubManagerQueries({
  manager,
  locked = true,
  rows = [],
}: { manager: DeepMocked<EntityManager> } & IQueryStub): void {
  manager.query.mockImplementation(async (sql: string) => {
    await Promise.resolve();
    if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked }];
    if (sql.includes('FOR UPDATE SKIP LOCKED')) return rows;
    return [];
  });
}

describe('OutboxRelayProcessor', () => {
  let manager: DeepMocked<EntityManager>;
  let dataSource: DeepMocked<DataSource>;
  let producer: DeepMocked<KafkaProducerService>;
  let processor: OutboxRelayProcessor;

  beforeEach(() => {
    manager = createMockEntityManager();
    dataSource = createMockDataSource(manager);
    producer = createMock<KafkaProducerService>();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    processor = new OutboxRelayProcessor(createMock<Queue>(), dataSource, producer);
  });

  it('does nothing when the advisory lock is not acquired', async () => {
    stubManagerQueries({ manager, locked: false });

    await processor.process();

    expect(producer.sendMessages).not.toHaveBeenCalled();
  });

  it('does nothing when there are no pending rows', async () => {
    stubManagerQueries({ manager, locked: true, rows: [] });

    await processor.process();

    expect(producer.sendMessages).not.toHaveBeenCalled();
  });

  it('publishes pending rows in order grouped by topic and marks them published', async () => {
    stubManagerQueries({ manager, locked: true, rows: pendingRows });

    await processor.process();

    expect(producer.sendMessages).toHaveBeenCalledWith([
      {
        topic: 'session_revoked',
        messages: [
          { key: 'k-a', value: payloadA, headers: { 'x-event-id': 'a' } },
          { key: 'k-b', value: payloadB, headers: undefined },
        ],
      },
    ]);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('SET status = $1, published_at = now()'), [
      OutboxStatus.Published,
      ['a', 'b'],
    ]);
  });

  it('applies exponential capped backoff to claimed rows when publishing fails', async () => {
    stubManagerQueries({ manager, locked: true, rows: pendingRows });
    producer.sendMessages.mockRejectedValue(new Error('broker down'));

    await processor.process();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('LEAST($3::double precision * power(2, attempts), $7::double precision)'),
      expect.arrayContaining([['a', 'b'], 'broker down', env.KAFKA_OUTBOX_BACKOFF_MS, env.KAFKA_OUTBOX_BACKOFF_MAX_MS]),
    );
  });

  it('publishes an unkeyed row with an undefined message key and headers', async () => {
    const unkeyed = [{ id: 'c', topic: 'session_revoked', partition_key: null, payload: payloadA, headers: null }];
    stubManagerQueries({ manager, locked: true, rows: unkeyed });

    await processor.process();

    expect(producer.sendMessages).toHaveBeenCalledWith([
      { topic: 'session_revoked', messages: [{ key: undefined, value: payloadA, headers: undefined }] },
    ]);
  });

  it('stringifies a non-Error publish rejection into the backoff reason', async () => {
    stubManagerQueries({ manager, locked: true, rows: pendingRows });
    producer.sendMessages.mockRejectedValue('broker exploded');

    await processor.process();

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('RETURNING status'),
      expect.arrayContaining([['a', 'b'], 'broker exploded']),
    );
  });

  it('logs a pre-claim failure when locking throws before any rows are claimed', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    manager.query.mockRejectedValue(new Error('lock contention'));

    await processor.process();

    expect(error).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    expect(producer.sendMessages).not.toHaveBeenCalled();
  });

  describe('with metrics wired', () => {
    let metrics: DeepMocked<KafkaMetricsService>;
    let withMetrics: OutboxRelayProcessor;

    beforeEach(() => {
      metrics = createMock<KafkaMetricsService>();
      withMetrics = new OutboxRelayProcessor(createMock<Queue>(), dataSource, producer, metrics);
    });

    it('records the published count and both outbox gauges on success', async () => {
      stubManagerQueries({ manager, locked: true, rows: pendingRows });
      dataSource.query.mockResolvedValue([
        { status: OutboxStatus.Pending, count: '7' },
        { status: OutboxStatus.Failed, count: '3' },
      ]);

      await withMetrics.process();

      expect(metrics.recordOutboxPublished).toHaveBeenCalledWith(2);
      expect(metrics.setOutboxPending).toHaveBeenCalledWith(7);
      expect(metrics.setOutboxFailed).toHaveBeenCalledWith(3);
    });

    it('defaults a missing status bucket to a zero gauge', async () => {
      stubManagerQueries({ manager, locked: true, rows: pendingRows });
      dataSource.query.mockResolvedValue([{ status: OutboxStatus.Pending, count: '5' }]);

      await withMetrics.process();

      expect(metrics.setOutboxPending).toHaveBeenCalledWith(5);
      expect(metrics.setOutboxFailed).toHaveBeenCalledWith(0);
    });

    it('records the failed count for rows whose retries are exhausted', async () => {
      stubManagerQueries({ manager, locked: true, rows: pendingRows });
      producer.sendMessages.mockRejectedValue(new Error('broker down'));
      dataSource.query.mockImplementation(async (sql: string) => {
        await Promise.resolve();
        // * UPDATE ... RETURNING yields TypeORM's [rows, affectedCount] tuple, not a flat row array.
        if (sql.includes('RETURNING status')) {
          return [[{ status: OutboxStatus.Failed }, { status: OutboxStatus.Pending }], 2];
        }
        if (sql.includes('count(*)')) return [{ status: OutboxStatus.Pending, count: '1' }];
        return [];
      });

      await withMetrics.process();

      expect(metrics.recordOutboxFailed).toHaveBeenCalledWith(1);
    });
  });
});
