import { randomUUID } from 'node:crypto';

import { createMock } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Queue } from 'bullmq';
import { Kafka, logLevel } from 'kafkajs';
import { DataSource, EntityManager } from 'typeorm';

jest.mock('@config/env.config', () => ({
  env: {
    NODE_ENV: 'test',
    KAFKA_BROKERS: ['localhost:9092'],
    KAFKA_SSL: false,
    KAFKA_OUTBOX_RELAY_INTERVAL_MS: 2000,
    KAFKA_OUTBOX_BATCH_SIZE: 100,
    KAFKA_OUTBOX_MAX_ATTEMPTS: 10,
    KAFKA_OUTBOX_BACKOFF_MS: 5000,
    KAFKA_OUTBOX_BACKOFF_MAX_MS: 300000,
    KAFKA_TOPIC_PARTITIONS: 1,
    KAFKA_TOPIC_REPLICATION_FACTOR: 1,
  },
}));

import { env } from '@config/env.config';
import { SnakeNamingStrategy } from '@database/strategies/snake-naming.strategy';
import { ClockService } from '@infrastructure/clock/clock.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { BaseRetryableConsumer } from '@infrastructure/kafka/consumers/base-retryable-consumer.abstract';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerConfig } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { DlqReplayService } from '@infrastructure/kafka/reliability/dlq/dlq-replay.service';
import { InboxMessage } from '@infrastructure/kafka/reliability/inbox/entities/inbox-message.entity';
import { InboxService } from '@infrastructure/kafka/reliability/inbox/inbox.service';
import { OutboxMessage } from '@infrastructure/kafka/reliability/outbox/entities/outbox-message.entity';
import { OutboxRelayProcessor } from '@infrastructure/kafka/reliability/outbox/jobs/outbox-relay.processor';
import { OutboxService } from '@infrastructure/kafka/reliability/outbox/outbox.service';
import { RetryDlqProducer } from '@infrastructure/kafka/reliability/retry/retry-dlq.producer';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { dlqTopicName, retryTopicNames } from '@infrastructure/kafka/topics/topic-naming.util';
import { SCHEMA_MIGRATIONS } from '@test/helpers';

const TOPICS = [
  'session_revoked',
  ...retryTopicNames(KafkaTopic.SessionRevoked),
  dlqTopicName(KafkaTopic.SessionRevoked),
];

async function sleep(ms: number): Promise<void> {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(params: { predicate: () => Promise<boolean>; timeoutMs: number }): Promise<void> {
  const { predicate, timeoutMs } = params;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await sleep(500);
  }

  throw new Error('Condition not met within timeout');
}

class PipelineConsumer extends BaseRetryableConsumer {
  readonly attempts = new Map<string, number>();

  getKafkaConsumerConfig(): IKafkaConsumerConfig {
    return { groupId: 'pipeline-test', topics: [KafkaTopic.SessionRevoked] };
  }

  protected handleEvent({ event }: { event: KafkaEvent; manager: EntityManager }): void {
    const attempt = (this.attempts.get(event.meta.eventId) ?? 0) + 1;
    this.attempts.set(event.meta.eventId, attempt);

    if (attempt === 1) {
      throw new Error('first attempt fails');
    }
  }
}

describe('Kafka pipeline (integration)', () => {
  let kafkaContainer: StartedKafkaContainer;
  let pgContainer: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let producer: KafkaProducerService;
  let consumerService: KafkaConsumerService;

  beforeAll(async () => {
    [kafkaContainer, pgContainer] = await Promise.all([
      new KafkaContainer('confluentinc/cp-kafka:7.6.0').withKraft().start(),
      new PostgreSqlContainer('postgres:16-alpine').start(),
    ]);

    (env as unknown as { KAFKA_BROKERS: string[] }).KAFKA_BROKERS = [
      `${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`,
    ];

    const admin = new Kafka({ brokers: env.KAFKA_BROKERS, logLevel: logLevel.NOTHING }).admin();
    await admin.connect();
    await admin.createTopics({ topics: TOPICS.map((topic) => ({ topic, numPartitions: 1 })), waitForLeaders: true });
    await admin.disconnect();

    dataSource = new DataSource({
      type: 'postgres',
      url: pgContainer.getConnectionUri(),
      entities: [OutboxMessage, InboxMessage],
      migrations: SCHEMA_MIGRATIONS,
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();

    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    producer = new KafkaProducerService();
    producer.onModuleInit();
    consumerService = new KafkaConsumerService();
    await sleep(3000);
  }, 180000);

  afterAll(async () => {
    await consumerService?.onModuleDestroy();
    await producer?.onModuleDestroy();
    await dataSource?.destroy();
    await Promise.all([kafkaContainer?.stop(), pgContainer?.stop()]);
  });

  it('relays an outbox row to the real broker with metadata headers', async () => {
    const outboxService = new OutboxService(new ClockService());
    const relay = new OutboxRelayProcessor(createMock<Queue>(), dataSource, producer);

    await dataSource.transaction(
      async (manager) =>
        await outboxService.enqueue({
          manager,
          params: {
            topic: KafkaTopic.SessionRevoked,
            key: 'agg-1',
            data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
          },
        }),
    );

    // eslint-disable-next-line no-restricted-syntax -- Promise executor signature is fixed (resolve, reject)
    const received: { value: string; headers: Record<string, string> } = await new Promise((resolve, reject) => {
      const kafka = new Kafka({ brokers: env.KAFKA_BROKERS, logLevel: logLevel.NOTHING });
      const consumer = kafka.consumer({ groupId: `assert-${Date.now()}` });

      void (async () => {
        try {
          await consumer.connect();
          await consumer.subscribe({ topic: 'session_revoked', fromBeginning: true });
          await consumer.run({
            eachMessage: async ({ message }) => {
              const headers = Object.fromEntries(
                Object.entries(message.headers ?? {}).map(([key, value]) => [key, value?.toString() ?? '']),
              );
              resolve({ value: message.value?.toString() ?? '', headers });
              await consumer.disconnect();
            },
          });
          await relay.process();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })();
    });

    expect(JSON.parse(received.value)).toMatchObject({
      topic: 'session_revoked',
      data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
    });
    expect(received.headers['x-event-type']).toBe('session_revoked');
    expect(received.headers['x-event-id']).toBeDefined();
  }, 60000);

  it('escalates a failing message to the retry tier and reprocesses it after the delay', async () => {
    const consumer = new PipelineConsumer(
      consumerService,
      new DatabaseService(dataSource),
      new InboxService(),
      new RetryDlqProducer(producer),
    );
    consumer.onModuleInit();
    await sleep(4000);

    const event = {
      meta: { eventId: '0a5f1d2c-1111-4aaa-8bbb-0e02b2c3d479', eventVersion: 1, timestamp: Date.now().toString() },
      topic: KafkaTopic.SessionRevoked,
      data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
    } as KafkaEvent;

    await producer.sendMessage({ topic: KafkaTopic.SessionRevoked, messages: [{ key: 'agg-9', value: event }] });

    await waitFor({
      predicate: async () =>
        (await dataSource.getRepository(InboxMessage).countBy({ dedupId: event.meta.eventId })) > 0,
      timeoutMs: 45000,
    });

    expect(consumer.attempts.get(event.meta.eventId)).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('replays DLQ messages back to their original topic', async () => {
    const eventIds: string[] = [randomUUID(), randomUUID()];

    for (const eventId of eventIds) {
      const event = {
        meta: { eventId, eventVersion: 1, timestamp: '1' },
        topic: KafkaTopic.SessionRevoked,
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
      } as KafkaEvent;
      await producer.sendMessage({
        topic: dlqTopicName(KafkaTopic.SessionRevoked) as KafkaTopic,
        messages: [{ value: event }],
      });
    }

    const seen = new Set<string>();
    const assertConsumer = new Kafka({ brokers: env.KAFKA_BROKERS, logLevel: logLevel.NOTHING }).consumer({
      groupId: `replay-assert-${Date.now()}`,
    });
    await assertConsumer.connect();
    await assertConsumer.subscribe({ topic: 'session_revoked', fromBeginning: false });
    await assertConsumer.run({
      eachMessage: async ({ message }) => {
        await Promise.resolve();
        const parsed = JSON.parse(message.value?.toString() ?? '{}') as { meta?: { eventId?: string } };
        if (parsed.meta?.eventId && eventIds.includes(parsed.meta.eventId)) {
          seen.add(parsed.meta.eventId);
        }
      },
    });
    await sleep(3000);

    const replayService = new DlqReplayService(consumerService, producer, dataSource);
    const replayed = await replayService.run({
      topic: dlqTopicName(KafkaTopic.SessionRevoked),
      dryRun: false,
      force: false,
      limit: 2,
    });

    try {
      await waitFor({
        predicate: async () => {
          await Promise.resolve();

          return seen.size === eventIds.length;
        },
        timeoutMs: 30000,
      });
    } finally {
      await assertConsumer.disconnect();
    }

    expect(replayed).toBe(2);
    expect([...seen].sort()).toEqual([...eventIds].sort());
  }, 60000);
});
