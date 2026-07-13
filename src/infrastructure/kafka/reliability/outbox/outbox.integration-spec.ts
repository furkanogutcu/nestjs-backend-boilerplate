import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
import { ClockService } from '@infrastructure/clock/clock.service';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaProducerMessage } from '@infrastructure/kafka/interfaces/kafka-message.interface';
import { OutboxMessage } from '@infrastructure/kafka/reliability/outbox/entities/outbox-message.entity';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { OutboxPruneProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-prune.processor';
import { OutboxRelayProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-relay.processor';
import { AdvisoryLock } from '@shared/enums/advisory-lock.enum';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

import { OutboxService } from './outbox.service';

const BACKOFF_MS = Number(process.env.KAFKA_OUTBOX_BACKOFF_MS ?? 5000);
const BACKOFF_MAX_MS = Number(process.env.KAFKA_OUTBOX_BACKOFF_MAX_MS ?? 300000);

describe('Outbox (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let service: OutboxService;
  let producer: DeepMocked<KafkaProducerService>;
  let relay: OutboxRelayProcessor;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [OutboxMessage],
      migrations: SCHEMA_MIGRATIONS,
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    service = new OutboxService(new ClockService());

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    producer = createMock<KafkaProducerService>();
    relay = new OutboxRelayProcessor(createMock<Queue>(), dataSource, producer);
    await dataSource.getRepository(OutboxMessage).clear();
  });

  async function enqueue(key: string): Promise<OutboxMessage> {
    return await dataSource.transaction(
      async (manager) =>
        await service.enqueue({
          manager,
          params: {
            topic: KafkaTopic.SessionRevoked,
            key,
            data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
          },
        }),
    );
  }

  function publishedMessages(): IKafkaProducerMessage[] {
    return producer.sendMessages.mock.calls[0][0];
  }

  // * Measured against the DB clock so host/container clock skew can't perturb the delay.
  async function backoffDelayMs(attempts: number): Promise<number> {
    const row = await enqueue('agg-backoff');

    if (attempts > 0) {
      await dataSource.getRepository(OutboxMessage).update({ id: row.id }, { attempts });
    }
    producer.sendMessages.mockRejectedValue(new Error('broker down'));

    await relay.process();

    const rows = await dataSource.query<{ delay_ms: string }[]>(
      `SELECT EXTRACT(EPOCH FROM (available_at - now())) * 1000 AS delay_ms FROM outbox_messages WHERE id = $1`,
      [row.id],
    );

    return Number(rows[0].delay_ms);
  }

  it('provisions the table and partial indexes via migration', async () => {
    const indexes = await dataSource.query<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'outbox_messages'`,
    );
    const names = indexes.map((index) => index.indexname);

    expect(names).toContain('idx_outbox_messages_pending');
    expect(names).toContain('idx_outbox_messages_published_at');
  });

  it('publishes pending rows and marks them published', async () => {
    const row = await enqueue('agg-1');

    await relay.process();

    expect(producer.sendMessages).toHaveBeenCalledTimes(1);
    const stored = await dataSource.getRepository(OutboxMessage).findOneByOrFail({ id: row.id });
    expect(stored.status).toBe(OutboxStatus.Published);
    expect(stored.publishedAt).not.toBeNull();
  });

  it('preserves created_at ordering within a topic', async () => {
    const first = await enqueue('k1');
    const second = await enqueue('k2');
    const third = await enqueue('k3');

    await relay.process();

    const ids = publishedMessages()[0].messages.map((message) => message.value.meta.eventId);
    expect(ids).toEqual([first.id, second.id, third.id]);
  });

  it('skips the batch when another session holds the relay advisory lock', async () => {
    await enqueue('agg-1');

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT pg_advisory_xact_lock($1)', [AdvisoryLock.OutboxRelay]);

    try {
      await relay.process();
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }

    expect(producer.sendMessages).not.toHaveBeenCalled();
    const counts = await dataSource.getRepository(OutboxMessage).countBy({ status: OutboxStatus.Pending });
    expect(counts).toBe(1);
  });

  it('applies backoff and keeps the row pending when publishing fails', async () => {
    const row = await enqueue('agg-1');
    producer.sendMessages.mockRejectedValue(new Error('broker down'));

    await relay.process();

    const stored = await dataSource.getRepository(OutboxMessage).findOneByOrFail({ id: row.id });
    expect(stored.status).toBe(OutboxStatus.Pending);
    expect(stored.attempts).toBe(1);
    expect(stored.lastError).toBe('broker down');
    expect(stored.availableAt.getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    { attempts: 0, expectedMs: BACKOFF_MS },
    { attempts: 3, expectedMs: BACKOFF_MS * 2 ** 3 },
    { attempts: 8, expectedMs: BACKOFF_MAX_MS },
  ])(
    'schedules the next attempt with exponential backoff clamped to the max (attempts=$attempts)',
    async ({ attempts, expectedMs }) => {
      const delayMs = await backoffDelayMs(attempts);

      // * The DB clock advances between the backoff write and this read, so the delay only shrinks.
      expect(delayMs).toBeGreaterThan(expectedMs - 2500);
      expect(delayMs).toBeLessThanOrEqual(expectedMs + 100);
    },
  );

  it('marks the row failed once max attempts are exhausted', async () => {
    const row = await enqueue('agg-1');
    await dataSource.getRepository(OutboxMessage).update({ id: row.id }, { attempts: 9 });
    producer.sendMessages.mockRejectedValue(new Error('still down'));

    await relay.process();

    const stored = await dataSource.getRepository(OutboxMessage).findOneByOrFail({ id: row.id });
    expect(stored.status).toBe(OutboxStatus.Failed);
    expect(stored.attempts).toBe(10);
  });

  it('prunes published rows older than the retention window', async () => {
    const fresh = await enqueue('fresh');
    const stale = await enqueue('stale');
    const repository = dataSource.getRepository(OutboxMessage);
    await repository.update({ id: fresh.id }, { status: OutboxStatus.Published, publishedAt: new Date() });
    await repository.update(
      { id: stale.id },
      { status: OutboxStatus.Published, publishedAt: new Date('2020-01-01T00:00:00Z') },
    );

    const prune = new OutboxPruneProcessor(createMock<Queue>(), dataSource);
    await prune.process();

    expect(await repository.findOneBy({ id: stale.id })).toBeNull();
    expect(await repository.findOneBy({ id: fresh.id })).not.toBeNull();
  });
});
