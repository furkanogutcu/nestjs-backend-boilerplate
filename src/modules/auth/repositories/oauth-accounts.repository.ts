import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { OAuthAccount } from '../entities/oauth-account.entity';

@Injectable()
export class OAuthAccountsRepository extends Repository<OAuthAccount> {
  constructor(dataSource: DataSource) {
    super(OAuthAccount, dataSource.createEntityManager());
  }
}
