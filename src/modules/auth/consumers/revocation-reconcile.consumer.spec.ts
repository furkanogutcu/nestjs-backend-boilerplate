import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';

import { RevocationService } from '../services/revocation.service';
import { RevocationReconcileConsumer } from './revocation-reconcile.consumer';

const sessionRevoked = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d481', eventVersion: 1, timestamp: '1700000000000' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-4444-7abc-8def-000000000004' },
};

const familyRevoked = {
  ...sessionRevoked,
  data: { scope: 'family', familyId: '0192f8a0-5555-7abc-8def-000000000005' },
};

function payloadWith(value: string): IKafkaMessagePayload {
  const message: IKafkaConsumerMessage = {
    topic: KafkaTopic.SessionRevoked,
    partition: 0,
    message: { key: null, value: Buffer.from(value), timestamp: '1', offset: '1', headers: {} },
  };

  return { message, controls: createMock<IKafkaMessageControls>() };
}

describe('RevocationReconcileConsumer', () => {
  let revocationService: DeepMocked<RevocationService>;
  let consumer: RevocationReconcileConsumer;

  beforeEach(() => {
    revocationService = createMock<RevocationService>();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    consumer = new RevocationReconcileConsumer(createMock<KafkaConsumerService>(), revocationService);
  });

  it('consumes SessionRevoked under its own reconcile group (separate from the realtime fanout group)', () => {
    expect(consumer.getKafkaConsumerConfig()).toEqual({
      groupId: 'auth-revocation-reconcile',
      topics: [KafkaTopic.SessionRevoked],
    });
  });

  it('rewrites the session denylist key on a session-scoped revocation', async () => {
    await consumer.handleMessage(payloadWith(JSON.stringify(sessionRevoked)));

    expect(revocationService.reconcileSession).toHaveBeenCalledWith({ sessionId: sessionRevoked.data.sessionId });
    expect(revocationService.reconcileFamily).not.toHaveBeenCalled();
  });

  it('rewrites the family denylist key on a family-scoped revocation', async () => {
    await consumer.handleMessage(payloadWith(JSON.stringify(familyRevoked)));

    expect(revocationService.reconcileFamily).toHaveBeenCalledWith({ familyId: familyRevoked.data.familyId });
    expect(revocationService.reconcileSession).not.toHaveBeenCalled();
  });

  it('rethrows a reconcile failure so Kafka redelivers until the denylist write succeeds', async () => {
    revocationService.reconcileSession.mockRejectedValue(new Error('redis down'));

    await expect(consumer.handleMessage(payloadWith(JSON.stringify(sessionRevoked)))).rejects.toThrow('redis down');
  });
});
