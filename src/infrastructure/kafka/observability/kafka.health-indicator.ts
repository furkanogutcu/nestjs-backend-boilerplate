import { Injectable } from '@nestjs/common';
import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { KafkaProducerService } from '@infrastructure/kafka/client/kafka-producer.service';

@Injectable()
export class KafkaHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly producer: KafkaProducerService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);

    return this.producer.isConnected() ? indicator.up() : indicator.down({ message: 'Kafka producer not connected' });
  }
}
