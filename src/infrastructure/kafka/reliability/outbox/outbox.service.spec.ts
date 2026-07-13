import { DeepMocked } from '@golevelup/ts-jest';
import { trace } from '@opentelemetry/api';
import { EntityManager, Repository } from 'typeorm';

import { ClockService } from '@infrastructure/clock/clock.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { OutboxMessage } from '@infrastructure/kafka/reliability/outbox/entities/outbox-message.entity';
import { OutboxStatus } from '@infrastructure/kafka/reliability/outbox/enums/outbox-status.enum';
import { createMockEntityManager, createMockRepository } from '@test/helpers';

import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  let manager: DeepMocked<EntityManager>;
  let repository: DeepMocked<Repository<OutboxMessage>>;
  let service: OutboxService;

  beforeEach(() => {
    repository = createMockRepository<OutboxMessage>();
    repository.create.mockImplementation((dto) => dto as OutboxMessage);
    manager = createMockEntityManager();
    manager.getRepository.mockReturnValue(repository);
    service = new OutboxService(new ClockService());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts a pending outbox row through the caller transaction manager', async () => {
    const message = await service.enqueue({
      manager,
      params: {
        topic: KafkaTopic.SessionRevoked,
        key: 'agg-1',
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
      },
    });

    expect(manager.getRepository).toHaveBeenCalledWith(OutboxMessage);
    expect(repository.insert).toHaveBeenCalledTimes(1);
    expect(message.topic).toBe(KafkaTopic.SessionRevoked);
    expect(message.partitionKey).toBe('agg-1');
    expect(message.status).toBe(OutboxStatus.Pending);
    expect(message.id).toBe(message.payload.meta.eventId);
    expect(message.payload.data).toEqual({ scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' });
  });

  it('defaults eventVersion and stamps producer and timestamp', async () => {
    const message = await service.enqueue({
      manager,
      params: {
        topic: KafkaTopic.SessionRevoked,
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
      },
    });

    expect(message.payload.meta.eventVersion).toBe(1);
    expect(message.payload.meta.producer).toBe('app');
    expect(message.payload.meta.timestamp).toMatch(/^\d+$/);
    expect(message.partitionKey).toBeNull();
  });

  it('carries dedupKey and the trace id from the active span', async () => {
    jest
      .spyOn(trace, 'getActiveSpan')
      .mockReturnValue({ spanContext: () => ({ traceId: 'trace-xyz', spanId: 'span-1' }) } as never);

    const message = await service.enqueue({
      manager,
      params: {
        topic: KafkaTopic.SessionRevoked,
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
        dedupKey: 'trade:1',
      },
    });

    expect(message.payload.meta.dedupKey).toBe('trade:1');
    expect(message.payload.meta.traceId).toBe('trace-xyz');
  });

  it('mirrors core metadata into the stored headers', async () => {
    const message = await service.enqueue({
      manager,
      params: {
        topic: KafkaTopic.SessionRevoked,
        data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
      },
    });

    expect(message.headers).toMatchObject({
      'x-event-id': message.id,
      'x-event-type': 'session_revoked',
      'x-event-version': '1',
    });
  });
});
