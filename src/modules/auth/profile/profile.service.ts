import { Injectable } from '@nestjs/common';

import { IUserView } from '../interfaces/user-view.interface';
import { OAuthAccountsRepository } from '../repositories/oauth-accounts.repository';
import { UsersRepository } from '../repositories/users.repository';

@Injectable()
export class ProfileService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly oauthAccountsRepository: OAuthAccountsRepository,
  ) {}

  async getUserView({ userId }: { userId: string }): Promise<IUserView> {
    const user = await this.usersRepository.findOneByOrFail({ id: userId });
    const accounts = await this.oauthAccountsRepository.find({ where: { userId } });

    return {
      id: user.id,
      isAnonymous: user.isAnonymous,
      displayName: user.displayName,
      linkedProviders: accounts.map((account) => ({ provider: account.provider, email: account.email })),
    };
  }
}
