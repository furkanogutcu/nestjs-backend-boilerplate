import { Global, Module } from '@nestjs/common';

import { SensitiveModule } from '../sensitive/sensitive.module';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [SensitiveModule],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
