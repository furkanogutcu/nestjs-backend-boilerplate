import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { KafkaHealthIndicator } from '@infrastructure/kafka/observability/kafka.health-indicator';

import { KafkaModule } from '../kafka/kafka.module';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health-indicator';

@Module({
  imports: [TerminusModule, KafkaModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, KafkaHealthIndicator],
})
export class HealthModule {}
