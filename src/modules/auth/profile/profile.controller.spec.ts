import { createMock, DeepMocked } from '@golevelup/ts-jest';

import { OAuthProvider } from '../enums/oauth-provider.enum';
import { IUserView } from '../interfaces/user-view.interface';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

describe('ProfileController', () => {
  let profileService: DeepMocked<ProfileService>;
  let controller: ProfileController;

  beforeEach(() => {
    profileService = createMock<ProfileService>();
    controller = new ProfileController(profileService);
  });

  it('returns the authenticated user mapped to the wire contract', async () => {
    const view: IUserView = {
      id: 'user-1',
      isAnonymous: false,
      displayName: 'Captain Nova',
      linkedProviders: [{ provider: OAuthProvider.Google, email: 'user@example.com' }],
    };
    profileService.getUserView.mockResolvedValue(view);

    const result = await controller.me({ id: 'user-1' });

    expect(profileService.getUserView).toHaveBeenCalledWith({ userId: 'user-1' });
    expect(result).toEqual({
      id: 'user-1',
      is_anonymous: false,
      display_name: 'Captain Nova',
      linked_providers: [{ provider: 'google', email: 'user@example.com' }],
    });
  });
});
