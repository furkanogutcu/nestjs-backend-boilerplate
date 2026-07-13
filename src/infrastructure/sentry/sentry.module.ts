import { Module } from '@nestjs/common';
import { SentryModule as NestSentryModule } from '@sentry/nestjs/setup';

@Module({
  imports: [NestSentryModule.forRoot()],
})
export class SentryModule {}
