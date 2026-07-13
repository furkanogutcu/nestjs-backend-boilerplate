import { Logger } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource, Repository } from 'typeorm';

import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
import { OutboxMessage } from '@infrastructure/kafka/reliability/outbox/entities/outbox-message.entity';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { OutboxRequeueService } from '@infrastructure/kafka/reliability/outbox/scripts/outbox-requeue.service';
import type { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { generateUuid } from '@shared/utils/uuid.util';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

describe('OutboxRequeueService (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let repository: Repository<OutboxMessage>;
  let service: OutboxRequeueService;

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
    repository = dataSource.getRepository(OutboxMessage);
    service = new OutboxRequeueService(dataSource);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    await repository.clear();
  });

  async function insert(params: { status: OutboxStatus; topic?: string; attempts?: number }): Promise<string> {
    const id = generateUuid();
    await repository.insert({
      id,
      topic: params.topic ?? 'session_revoked',
      partitionKey: null,
      payload: {
        meta: { eventId: id, eventVersion: 1, timestamp: '1' },
        topic: 'session_revoked',
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
      } as KafkaEvent,
      headers: null,
      status: params.status,
      attempts: params.attempts ?? (params.status === OutboxStatus.Failed ? 10 : 0),
      lastError: params.status === OutboxStatus.Failed ? 'broker down' : null,
      availableAt: new Date('2999-01-01T00:00:00Z'),
    });

    return id;
  }

  it('requeues failed rows to pending and re-arms them (attempts, error, available_at reset)', async () => {
    const failed = await insert({ status: OutboxStatus.Failed });

    const requeued = await service.run({ all: true, dryRun: false });

    expect(requeued).toBe(1);
    const stored = await repository.findOneByOrFail({ id: failed });
    expect(stored.status).toBe(OutboxStatus.Pending);
    expect(stored.attempts).toBe(0);
    expect(stored.lastError).toBeNull();
    // ! Compare against the DATABASE clock, not the host's: `available_at` is written as SQL `now()`, and a few
    // ! milliseconds of drift between the container and the host would otherwise flake this assertion.
    const [{ now: databaseNow }] = await dataSource.query<[{ now: Date }]>('SELECT now() AS now');
    expect(stored.availableAt.getTime()).toBeLessThanOrEqual(databaseNow.getTime());
    expect(stored.availableAt.getTime()).toBeLessThan(new Date('2999-01-01T00:00:00Z').getTime());
  });

  it('leaves pending and published rows untouched', async () => {
    const pending = await insert({ status: OutboxStatus.Pending });
    const published = await insert({ status: OutboxStatus.Published });

    const requeued = await service.run({ all: true, dryRun: false });

    expect(requeued).toBe(0);
    expect((await repository.findOneByOrFail({ id: pending })).status).toBe(OutboxStatus.Pending);
    expect((await repository.findOneByOrFail({ id: published })).status).toBe(OutboxStatus.Published);
  });

  it('counts matches without mutating on dry-run', async () => {
    const failed = await insert({ status: OutboxStatus.Failed });

    const matched = await service.run({ all: true, dryRun: true });

    expect(matched).toBe(1);
    expect((await repository.findOneByOrFail({ id: failed })).status).toBe(OutboxStatus.Failed);
  });

  it('requeues only the row matching an --id selector', async () => {
    const target = await insert({ status: OutboxStatus.Failed });
    const other = await insert({ status: OutboxStatus.Failed });

    const requeued = await service.run({ id: target, all: false, dryRun: false });

    expect(requeued).toBe(1);
    expect((await repository.findOneByOrFail({ id: target })).status).toBe(OutboxStatus.Pending);
    expect((await repository.findOneByOrFail({ id: other })).status).toBe(OutboxStatus.Failed);
  });

  it('requeues only failed rows of the selected topic', async () => {
    const session_revoked = await insert({ status: OutboxStatus.Failed, topic: 'session_revoked' });
    const other = await insert({ status: OutboxStatus.Failed, topic: 'other' });

    const requeued = await service.run({ topic: 'session_revoked', all: false, dryRun: false });

    expect(requeued).toBe(1);
    expect((await repository.findOneByOrFail({ id: session_revoked })).status).toBe(OutboxStatus.Pending);
    expect((await repository.findOneByOrFail({ id: other })).status).toBe(OutboxStatus.Failed);
  });

  it('caps the number requeued with --limit', async () => {
    await insert({ status: OutboxStatus.Failed });
    await insert({ status: OutboxStatus.Failed });
    await insert({ status: OutboxStatus.Failed });

    const requeued = await service.run({ all: true, limit: 2, dryRun: false });

    expect(requeued).toBe(2);
    expect(await repository.countBy({ status: OutboxStatus.Failed })).toBe(1);
    expect(await repository.countBy({ status: OutboxStatus.Pending })).toBe(2);
  });
});
