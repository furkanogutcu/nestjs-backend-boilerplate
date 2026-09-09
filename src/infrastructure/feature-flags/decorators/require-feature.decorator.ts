import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

export const RequireFeature = (key: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_FEATURE_KEY, key);
