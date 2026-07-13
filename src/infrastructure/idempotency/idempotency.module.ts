import { Global, Module } from '@nestjs/common';

import { SensitiveModule } from '../sensitive/sensitive.module';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  imports: [SensitiveModule],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
