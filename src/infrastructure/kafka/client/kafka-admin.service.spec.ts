import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';
import { Admin, Kafka } from 'kafkajs';

jest.mock('@infrastructure/kafka/topics/kafka-topic.registry', () => ({
  kafkaTopicRegistry: {
    orders: { partitions: 3, replicationFactor: 2, retryEnabled: true },
    audit: { partitions: 1, replicationFactor: 1, retentionMs: 3_600_000, retryEnabled: false },
  },
}));

import { KafkaAdminService } from '@infrastructure/kafka/client/kafka-admin.service';

const ALL_TOPICS = [
  'orders',
  'orders.retry.5s',
  'orders.retry.1m',
  'orders.retry.10m',
  'orders.dlq',
  'audit',
  'audit.dlq',
];

describe('KafkaAdminService', () => {
  let admin: DeepMocked<Admin>;
  let service: KafkaAdminService;

  beforeEach(() => {
    admin = createMock<Admin>();
    admin.connect.mockResolvedValue(undefined);
    admin.disconnect.mockResolvedValue(undefined);
    jest.spyOn(Kafka.prototype, 'admin').mockReturnValue(admin);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    service = new KafkaAdminService();
  });

  it('creates all missing topics (main + retry tiers + dlq)', async () => {
    admin.listTopics.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    expect(admin.createTopics).toHaveBeenCalledTimes(1);
    const { topics } = admin.createTopics.mock.calls[0][0];
    expect(topics.map((topic) => topic.topic).sort()).toEqual([...ALL_TOPICS].sort());
    expect(admin.disconnect).toHaveBeenCalled();
  });

  it('provisions retry tiers only for a retry-enabled topic', async () => {
    admin.listTopics.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    const created = admin.createTopics.mock.calls[0][0].topics.map((topic) => topic.topic);
    expect(created).toContain('orders.retry.5s');
    expect(created).not.toContain('audit.retry.5s');
  });

  it('skips topics that already exist', async () => {
    admin.listTopics.mockResolvedValue(['orders', 'orders.dlq']);

    await service.onApplicationBootstrap();

    const created = admin.createTopics.mock.calls[0][0].topics.map((topic) => topic.topic);
    expect(created).not.toContain('orders');
    expect(created).not.toContain('orders.dlq');
    expect(created).toContain('orders.retry.5s');
  });

  it('does not call createTopics when everything is already provisioned', async () => {
    admin.listTopics.mockResolvedValue([...ALL_TOPICS]);

    await service.onApplicationBootstrap();

    expect(admin.createTopics).not.toHaveBeenCalled();
  });

  it('sets cleanup.policy, retention, partitions and replication factor on created topics', async () => {
    admin.listTopics.mockResolvedValue([]);

    await service.onApplicationBootstrap();

    const dlq = admin.createTopics.mock.calls[0][0].topics.find((topic) => topic.topic === 'orders.dlq')!;
    expect(dlq.configEntries).toEqual(
      expect.arrayContaining([
        { name: 'cleanup.policy', value: 'delete' },
        expect.objectContaining({ name: 'retention.ms' }),
      ]),
    );
    expect(dlq.numPartitions).toBeGreaterThan(0);
    expect(dlq.replicationFactor).toBeGreaterThan(0);
  });

  it('logs and still disconnects when provisioning fails', async () => {
    admin.listTopics.mockRejectedValue(new Error('broker down'));

    await service.onApplicationBootstrap();

    expect(Logger.prototype.error).toHaveBeenCalled();
    expect(admin.disconnect).toHaveBeenCalled();
  });
});
