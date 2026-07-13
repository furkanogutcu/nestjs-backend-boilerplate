import { DeepMocked } from '@golevelup/ts-jest';
import { EntityManager } from 'typeorm';

import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';
import { createMockEntityManager } from '@test/helpers';

import { InboxService } from './inbox.service';

const event = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 1, timestamp: '1' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
} as KafkaEvent;

describe('InboxService', () => {
  let manager: DeepMocked<EntityManager>;
  let service: InboxService;

  beforeEach(() => {
    manager = createMockEntityManager();
    service = new InboxService();
  });

  it('returns true and records the row when newly inserted', async () => {
    manager.query.mockResolvedValue([{ dedup_id: event.meta.eventId }]);

    await expect(service.tryConsume({ manager, consumer: 'group-1', event })).resolves.toBe(true);
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (consumer, dedup_id) DO NOTHING'), [
      'group-1',
      event.meta.eventId,
      'session_revoked',
    ]);
  });

  it('returns false when the row already exists', async () => {
    manager.query.mockResolvedValue([]);

    await expect(service.tryConsume({ manager, consumer: 'group-1', event })).resolves.toBe(false);
  });

  it('prefers the business dedupKey over the eventId', async () => {
    manager.query.mockResolvedValue([{ dedup_id: 'trade:42' }]);
    const businessEvent = { ...event, meta: { ...event.meta, dedupKey: 'trade:42' } } as KafkaEvent;

    await service.tryConsume({ manager, consumer: 'group-1', event: businessEvent });

    expect(manager.query).toHaveBeenCalledWith(expect.any(String), ['group-1', 'trade:42', 'session_revoked']);
  });
});
