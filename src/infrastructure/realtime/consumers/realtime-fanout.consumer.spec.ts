import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Logger } from '@nestjs/common';

import { KafkaConsumerService } from '@infrastructure/kafka/client/kafka-consumer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import {
  IKafkaConsumerMessage,
  IKafkaMessageControls,
  IKafkaMessagePayload,
} from '@infrastructure/kafka/interfaces/kafka-consumer.interface';

import type { IRealtimePublisher } from '../interfaces/realtime-publisher.interface';
import { RealtimeFanoutConsumer } from './realtime-fanout.consumer';

const sessionRevoked = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d480', eventVersion: 1, timestamp: '1700000000000' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-4444-7abc-8def-000000000004' },
};

function payloadWith({
  value,
  topic = KafkaTopic.SessionRevoked,
}: {
  value: string;
  topic?: KafkaTopic;
}): IKafkaMessagePayload {
  const message: IKafkaConsumerMessage = {
    topic,
    partition: 0,
    message: { key: null, value: Buffer.from(value), timestamp: '1', offset: '1', headers: {} },
  };

  return { message, controls: createMock<IKafkaMessageControls>() };
}

describe('RealtimeFanoutConsumer', () => {
  let kafkaConsumerService: DeepMocked<KafkaConsumerService>;
  let publisher: DeepMocked<IRealtimePublisher>;
  let consumer: RealtimeFanoutConsumer;

  beforeEach(() => {
    kafkaConsumerService = createMock<KafkaConsumerService>();
    publisher = createMock<IRealtimePublisher>();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    consumer = new RealtimeFanoutConsumer(kafkaConsumerService, publisher);
  });

  it('consumes the realtime-fanout group on the session_revoked topic', () => {
    expect(consumer.getKafkaConsumerConfig()).toEqual({
      groupId: 'realtime-fanout',
      topics: [KafkaTopic.SessionRevoked],
    });
  });

  it('turns a session-scoped revocation into a session kick', async () => {
    await consumer.handleMessage(payloadWith({ value: JSON.stringify(sessionRevoked) }));

    expect(publisher.disconnectSession).toHaveBeenCalledWith({
      sessionId: '0192f8a0-4444-7abc-8def-000000000004',
    });
    expect(publisher.disconnectFamily).not.toHaveBeenCalled();
  });

  it('turns a family-scoped revocation into a family kick', async () => {
    const familyRevoked = {
      ...sessionRevoked,
      data: { scope: 'family', familyId: '0192f8a0-5555-7abc-8def-000000000005' },
    };

    await consumer.handleMessage(payloadWith({ value: JSON.stringify(familyRevoked) }));

    expect(publisher.disconnectFamily).toHaveBeenCalledWith({
      familyId: '0192f8a0-5555-7abc-8def-000000000005',
    });
    expect(publisher.disconnectSession).not.toHaveBeenCalled();
  });

  it('skips an unparseable message without kicking or throwing (best-effort channel)', async () => {
    await expect(consumer.handleMessage(payloadWith({ value: 'not-json' }))).resolves.toBeUndefined();

    expect(publisher.disconnectSession).not.toHaveBeenCalled();
    expect(publisher.disconnectFamily).not.toHaveBeenCalled();
  });
});
