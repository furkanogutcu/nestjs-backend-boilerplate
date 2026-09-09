import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { OAuthAccount } from '../entities/oauth-account.entity';
import { User } from '../entities/user.entity';
import { OAuthProvider } from '../enums/oauth-provider.enum';
import { OAuthAccountsRepository } from '../repositories/oauth-accounts.repository';
import { UsersRepository } from '../repositories/users.repository';
import { ProfileService } from './profile.service';

describe('ProfileService', () => {
  let usersRepository: DeepMocked<UsersRepository>;
  let oauthAccountsRepository: DeepMocked<OAuthAccountsRepository>;
  let service: ProfileService;

  beforeEach(() => {
    usersRepository = createMock<UsersRepository>();
    oauthAccountsRepository = createMock<OAuthAccountsRepository>();
    service = new ProfileService(usersRepository, oauthAccountsRepository);
  });

  it('aggregates the user with its linked providers', async () => {
    usersRepository.findOneByOrFail.mockResolvedValue({
      id: 'user-1',
      isAnonymous: false,
      displayName: 'Alice',
    } as User);
    oauthAccountsRepository.find.mockResolvedValue([
      { provider: OAuthProvider.Google, email: 'a@example.com' } as OAuthAccount,
    ]);

    const view = await service.getUserView({ userId: 'user-1' });

    expect(view).toEqual({
      id: 'user-1',
      isAnonymous: false,
      displayName: 'Alice',
      linkedProviders: [{ provider: OAuthProvider.Google, email: 'a@example.com' }],
    });
  });

  it('returns an empty provider list for an unlinked guest', async () => {
    usersRepository.findOneByOrFail.mockResolvedValue({
      id: 'user-1',
      isAnonymous: true,
      displayName: null,
    } as User);
    oauthAccountsRepository.find.mockResolvedValue([]);

    const view = await service.getUserView({ userId: 'user-1' });

    expect(view.linkedProviders).toEqual([]);
    expect(view.isAnonymous).toBe(true);
  });
});
