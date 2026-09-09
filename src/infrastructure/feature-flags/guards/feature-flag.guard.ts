import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppNotFoundException } from '@shared/exceptions/not-found.exception';

import { REQUIRE_FEATURE_KEY } from '../decorators/require-feature.decorator';
import { FeatureFlagsService } from '../services/feature-flags.service';

@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!key) {
      return true;
    }

    // * 404 not 403: a disabled rollout must not advertise what is coming.
    if (!(await this.featureFlags.isEnabled({ key }))) {
      throw new AppNotFoundException({ resourceName: 'Resource' });
    }

    return true;
  }
}
