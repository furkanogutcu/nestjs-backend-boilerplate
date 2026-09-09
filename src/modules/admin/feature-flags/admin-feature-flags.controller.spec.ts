import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { FeatureFlag } from '@infrastructure/feature-flags/entities/feature-flag.entity';
import { FeatureFlagsService } from '@infrastructure/feature-flags/services/feature-flags.service';

import { AdminFeatureFlagsController } from './admin-feature-flags.controller';

const flag = {
  key: 'new-checkout',
  enabled: true,
  description: 'New checkout flow',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} as FeatureFlag;

describe('AdminFeatureFlagsController', () => {
  let featureFlagsService: DeepMocked<FeatureFlagsService>;
  let controller: AdminFeatureFlagsController;

  beforeEach(() => {
    featureFlagsService = createMock<FeatureFlagsService>();
    controller = new AdminFeatureFlagsController(featureFlagsService);
  });

  it('maps flags to the wire format', async () => {
    featureFlagsService.list.mockResolvedValue([flag]);

    await expect(controller.list()).resolves.toEqual([
      {
        key: 'new-checkout',
        enabled: true,
        description: 'New checkout flow',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('upserts a flag by key', async () => {
    featureFlagsService.upsert.mockResolvedValue(flag);

    await controller.upsert('new-checkout', { enabled: true, description: 'New checkout flow' });

    expect(featureFlagsService.upsert).toHaveBeenCalledWith({
      key: 'new-checkout',
      enabled: true,
      description: 'New checkout flow',
    });
  });

  it('deletes a flag by key', async () => {
    await controller.remove('new-checkout');

    expect(featureFlagsService.remove).toHaveBeenCalledWith({ key: 'new-checkout' });
  });
});
