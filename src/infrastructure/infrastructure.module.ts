import { Module } from '@nestjs/common';

import { CacheModule } from './cache/cache.module';
import { ClockModule } from './clock/clock.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { LoggerModule } from './logger/logger.module';
import { MailModule } from './mail/mail.module';
import { QueuesModule } from './queues/queues.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { SecurityModule } from './security/security.module';
import { SensitiveModule } from './sensitive/sensitive.module';

@Module({
  imports: [
    ClockModule,
    SensitiveModule,
    CacheModule,
    DatabaseModule,
    HealthModule,
    IdempotencyModule,
    LoggerModule,
    QueuesModule,
    MailModule,
    SecurityModule,
    RateLimitModule,
  ],
})
export class InfrastructureModule {}
