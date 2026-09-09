import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Reflector } from '@nestjs/core';

import { AppNotFoundException } from '@shared/exceptions/not-found.exception';
import { createMockExecutionContext } from '@test/helpers';

import { FeatureFlagsService } from '../services/feature-flags.service';
import { FeatureFlagGuard } from './feature-flag.guard';

describe('FeatureFlagGuard', () => {
  let reflector: DeepMocked<Reflector>;
  let featureFlags: DeepMocked<FeatureFlagsService>;
  let guard: FeatureFlagGuard;

  beforeEach(() => {
    reflector = createMock<Reflector>();
    featureFlags = createMock<FeatureFlagsService>();
    guard = new FeatureFlagGuard(reflector, featureFlags);
  });

  it('allows a route that declares no flag', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createMockExecutionContext({}))).resolves.toBe(true);
    expect(featureFlags.isEnabled).not.toHaveBeenCalled();
  });

  it('allows a route whose flag is on', async () => {
    reflector.getAllAndOverride.mockReturnValue('new-checkout');
    featureFlags.isEnabled.mockResolvedValue(true);

    await expect(guard.canActivate(createMockExecutionContext({}))).resolves.toBe(true);
  });

  it('hides a route whose flag is off behind a 404', async () => {
    reflector.getAllAndOverride.mockReturnValue('new-checkout');
    featureFlags.isEnabled.mockResolvedValue(false);

    await expect(guard.canActivate(createMockExecutionContext({}))).rejects.toBeInstanceOf(AppNotFoundException);
  });
});
