import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FeatureFlag } from './entities/feature-flag.entity';
import { FeatureFlagGuard } from './guards/feature-flag.guard';
import { FeatureFlagsService } from './services/feature-flags.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FeatureFlag])],
  providers: [FeatureFlagsService, FeatureFlagGuard],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
