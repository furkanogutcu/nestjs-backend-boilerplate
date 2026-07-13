import { randomUUID } from 'node:crypto';

import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue } from 'bullmq';
import { DataSource, EntityManager } from 'typeorm';

import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
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
import { InboxMessage } from '@infrastructure/kafka/reliability/inbox/entities/inbox-message.entity';
import { InboxPruneProcessor } from '@infrastructure/kafka/reliability/inbox/jobs/inbox-prune.processor';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

import { InboxService } from './inbox.service';

class TestConsumer extends BaseIdempotentConsumer {
  shouldThrow = false;

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return { groupId: 'group-itest', topics: [KafkaTopic.SessionRevoked] };
  }

  protected async handleEvent({ event, manager }: { event: KafkaEvent; manager: EntityManager }): Promise<void> {
    await manager.query('INSERT INTO inbox_test_widget (id) VALUES ($1)', [event.meta.eventId]);

    if (this.shouldThrow) {
      throw new Error('boom');
    }
  }
}

function messageFor(eventId: string): IKafkaConsumerMessage {
  const event = {
    meta: { eventId, eventVersion: 1, timestamp: '1' },
    topic: KafkaTopic.SessionRevoked,
    data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
  };

  return {
    topic: KafkaTopic.SessionRevoked,
    partition: 0,
    message: { key: null, value: Buffer.from(JSON.stringify(event)), timestamp: '1', offset: '1', headers: {} },
  };
}

function payloadFor(message: IKafkaConsumerMessage): IKafkaMessagePayload {
  return { message, controls: createMock<IKafkaMessageControls>() };
}

describe('Inbox (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let consumer: TestConsumer;

  async function countWidgets(): Promise<number> {
    const rows = await dataSource.query<{ count: string }[]>('SELECT count(*) AS count FROM inbox_test_widget');

    return Number(rows[0].count);
  }

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [InboxMessage],
      migrations: SCHEMA_MIGRATIONS,
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
    await dataSource.query('CREATE TABLE inbox_test_widget ("id" varchar PRIMARY KEY)');

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    consumer = new TestConsumer(
      createMock<KafkaConsumerService>(),
      new DatabaseService(dataSource),
      new InboxService(),
    );
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  beforeEach(async () => {
    consumer.shouldThrow = false;
    await dataSource.query('TRUNCATE inbox_messages, inbox_test_widget');
  });

  it('processes a new event exactly once', async () => {
    const eventId = randomUUID();

    await consumer.handleMessage(payloadFor(messageFor(eventId)));

    expect(await countWidgets()).toBe(1);
    expect(await dataSource.getRepository(InboxMessage).count()).toBe(1);
  });

  it('deduplicates a redelivered event', async () => {
    const message = messageFor(randomUUID());

    await consumer.handleMessage(payloadFor(message));
    await consumer.handleMessage(payloadFor(message));

    expect(await countWidgets()).toBe(1);
    expect(await dataSource.getRepository(InboxMessage).count()).toBe(1);
  });

  it('deduplicates concurrent deliveries of the same event under contention', async () => {
    const message = messageFor(randomUUID());

    await Promise.all([consumer.handleMessage(payloadFor(message)), consumer.handleMessage(payloadFor(message))]);

    expect(await countWidgets()).toBe(1);
    expect(await dataSource.getRepository(InboxMessage).count()).toBe(1);
  });

  it('rolls back the business write and the inbox row together when the handler fails', async () => {
    const message = messageFor(randomUUID());
    consumer.shouldThrow = true;

    await expect(consumer.handleMessage(payloadFor(message))).rejects.toThrow('boom');
    expect(await countWidgets()).toBe(0);
    expect(await dataSource.getRepository(InboxMessage).count()).toBe(0);

    consumer.shouldThrow = false;
    await consumer.handleMessage(payloadFor(message));

    expect(await countWidgets()).toBe(1);
  });

  it('prunes processed rows older than the retention window', async () => {
    await dataSource.query(
      `INSERT INTO inbox_messages (consumer, dedup_id, topic, processed_at)
       VALUES ('g', 'stale', 'session_revoked', '2020-01-01T00:00:00Z'), ('g', 'fresh', 'session_revoked', now())`,
    );

    await new InboxPruneProcessor(createMock<Queue>(), dataSource).process();

    const remaining = await dataSource.getRepository(InboxMessage).find();
    expect(remaining.map((row) => row.dedupId)).toEqual(['fresh']);
  });
});
