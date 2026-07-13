import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { HealthIndicatorService } from '@nestjs/terminus';

import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';
import { KafkaHealthIndicator } from '@infrastructure/kafka/observability/kafka.health-indicator';

describe('KafkaHealthIndicator', () => {
  let producer: DeepMocked<KafkaProducerService>;
  let indicator: { up: jest.Mock; down: jest.Mock };
  let healthIndicator: KafkaHealthIndicator;

  const upResult = { kafka: { status: 'up' } };
  const downResult = { kafka: { status: 'down' } };

  beforeEach(() => {
    indicator = { up: jest.fn().mockReturnValue(upResult), down: jest.fn().mockReturnValue(downResult) };

    const healthIndicatorService = createMock<HealthIndicatorService>();
    healthIndicatorService.check.mockReturnValue(indicator as never);

    producer = createMock<KafkaProducerService>();

    healthIndicator = new KafkaHealthIndicator(healthIndicatorService, producer);
  });

  it('reports up when the producer is connected', () => {
    producer.isConnected.mockReturnValue(true);

    expect(healthIndicator.isHealthy('kafka')).toBe(upResult);
    expect(indicator.up).toHaveBeenCalled();
  });

  it('reports down when the producer is not connected', () => {
    producer.isConnected.mockReturnValue(false);

    expect(healthIndicator.isHealthy('kafka')).toBe(downResult);
    expect(indicator.down).toHaveBeenCalledWith({ message: 'Kafka producer not connected' });
  });
});
