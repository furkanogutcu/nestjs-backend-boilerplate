import { createMock, DeepMocked } from '@golevelup/ts-jest';

import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaTopic } from '@infrastructure/kafka/enums/kafka-topic.enum';
import { IKafkaConsumerMessage } from '@infrastructure/kafka/interfaces/kafka-consumer.interface';
import { KafkaMetricsService } from '@infrastructure/kafka/observability/kafka-metrics.service';
import { RetryDlqProducer } from '@infrastructure/kafka/reliability/retry/retry-dlq.producer';
import { KafkaEvent } from '@infrastructure/kafka/schemas/kafka-event.schema';

const event = {
  meta: { eventId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', eventVersion: 1, timestamp: '1' },
  topic: KafkaTopic.SessionRevoked,
  data: { scope: 'session', sessionId: '0192f8a0-1111-7abc-8def-000000000001' },
} as KafkaEvent;

describe('RetryDlqProducer', () => {
  let producer: DeepMocked<KafkaProducerService>;
  let service: RetryDlqProducer;

  beforeEach(() => {
    producer = createMock<KafkaProducerService>();
    service = new RetryDlqProducer(producer);
  });

  it('dispatches the event to the destination topic with retry headers', async () => {
    await service.dispatch({
      destinationTopic: 'session_revoked.retry.5s',
      event,
      key: 'agg-1',
      attempt: 2,
      firstFailedAt: '1700000000000',
      error: new Error('boom'),
    });

    expect(producer.sendMessage).toHaveBeenCalledWith({
      topic: 'session_revoked.retry.5s',
      messages: [
        {
          key: 'agg-1',
          value: event,
          headers: {
            'x-original-topic': 'session_revoked',
            'x-retry-attempt': '2',
            'x-first-failed-at': '1700000000000',
            'x-last-error': 'boom',
          },
        },
      ],
    });
  });

  it('forwards traceparent and baggage headers when they are present', async () => {
    await service.dispatch({
      destinationTopic: 'session_revoked.retry.5s',
      event,
      key: 'agg-1',
      attempt: 1,
      firstFailedAt: '1700000000000',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      baggage: 'tenant=acme',
      error: new Error('boom'),
    });

    const headers = producer.sendMessage.mock.calls[0][0].messages[0].headers!;
    expect(headers.traceparent).toBe('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01');
    expect(headers.baggage).toBe('tenant=acme');
  });

  it('stringifies non-error failure reasons', async () => {
    await service.dispatch({
      destinationTopic: 'session_revoked.dlq',
      event,
      attempt: 4,
      firstFailedAt: '1',
      error: 'plain',
    });

    expect(producer.sendMessage.mock.calls[0][0].messages[0].headers!['x-last-error']).toBe('plain');
  });

  it('records a retry metric for a retry-tier destination', async () => {
    const metrics = createMock<KafkaMetricsService>();
    const withMetrics = new RetryDlqProducer(producer, metrics);

    await withMetrics.dispatch({
      destinationTopic: 'session_revoked.retry.1m',
      event,
      attempt: 3,
      firstFailedAt: '1',
      error: 'x',
    });

    expect(metrics.recordRetry).toHaveBeenCalledWith('retry.1m');
    expect(metrics.recordDlq).not.toHaveBeenCalled();
  });

  it('records a dlq metric for a dlq destination', async () => {
    const metrics = createMock<KafkaMetricsService>();
    const withMetrics = new RetryDlqProducer(producer, metrics);

    await withMetrics.dispatch({
      destinationTopic: 'session_revoked.dlq',
      event,
      attempt: 4,
      firstFailedAt: '1',
      error: 'x',
    });

    expect(metrics.recordDlq).toHaveBeenCalledWith('session_revoked.dlq');
    expect(metrics.recordRetry).not.toHaveBeenCalled();
  });

  it('sends a poison message raw to the dlq with its original bytes preserved', async () => {
    const metrics = createMock<KafkaMetricsService>();
    const withMetrics = new RetryDlqProducer(producer, metrics);
    const message = {
      topic: 'session_revoked.retry.5s' as KafkaTopic,
      partition: 0,
      message: { key: Buffer.from('k'), value: Buffer.from('not-json'), timestamp: '1', offset: '1', headers: {} },
    } as IKafkaConsumerMessage;

    await withMetrics.dispatchPoison({ dlqTopic: 'session_revoked.dlq', message, reason: 'unparseable message' });

    expect(producer.sendRaw).toHaveBeenCalledWith({
      topic: 'session_revoked.dlq',
      message: {
        key: message.message.key,
        value: message.message.value,
        headers: { 'x-original-topic': 'session_revoked.retry.5s', 'x-last-error': 'unparseable message' },
      },
    });
    expect(metrics.recordDlq).toHaveBeenCalledWith('session_revoked.dlq');
  });
});
