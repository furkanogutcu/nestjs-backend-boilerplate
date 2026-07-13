import { Module } from '@nestjs/common';

import { CacheModule } from './cache/cache.module';
import { ClockModule } from './clock/clock.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { KafkaModule } from './kafka/kafka.module';
import { LoggerModule } from './logger/logger.module';
import { MailModule } from './mail/mail.module';
import { PrometheusModule } from './prometheus/prometheus.module';
import { QueuesModule } from './queues/queues.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SecurityModule } from './security/security.module';
import { SensitiveModule } from './sensitive/sensitive.module';
import { SentryModule } from './sentry/sentry.module';

@Module({
  imports: [
    SentryModule,
    PrometheusModule,
    ClockModule,
    SensitiveModule,
    CacheModule,
    DatabaseModule,
    HealthModule,
    IdempotencyModule,
    KafkaModule,
    LoggerModule,
    QueuesModule,
    MailModule,
    RealtimeModule,
    SecurityModule,
    RateLimitModule,
  ],
})
export class InfrastructureModule {}
