import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

// * Gates a route behind a flag. FeatureFlagGuard enforces it; an unknown or disabled flag hides the route.
export const RequireFeature = (key: string): MethodDecorator & ClassDecorator => SetMetadata(REQUIRE_FEATURE_KEY, key);
