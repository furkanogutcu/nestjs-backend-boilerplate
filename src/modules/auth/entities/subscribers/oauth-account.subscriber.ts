import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent } from 'typeorm';

import { SensitiveService } from '@infrastructure/sensitive/sensitive.service';

import { OAuthAccount } from '../oauth-account.entity';

const EMAIL_AAD_PREFIX = 'oauth_accounts.email';

// ! A subscriber, not a column transformer: only here is the row's primary key available to fold into the AAD.
@EventSubscriber()
export class OAuthAccountSubscriber implements EntitySubscriberInterface<OAuthAccount> {
  private readonly sensitiveService = new SensitiveService();

  listenTo(): typeof OAuthAccount {
    return OAuthAccount;
  }

  beforeInsert(event: InsertEvent<OAuthAccount>): void {
    this.encryptEmail(event.entity);
  }

  beforeUpdate(event: UpdateEvent<OAuthAccount>): void {
    if (event.entity) {
      this.encryptEmail(event.entity as OAuthAccount);
    }
  }

  afterLoad(entity: OAuthAccount): void {
    if (entity.email !== null && entity.email !== undefined) {
      entity.email = this.sensitiveService.decrypt({ input: entity.email, aad: this.aad(entity.id) }) as string;
    }
  }

  private encryptEmail(entity: OAuthAccount): void {
    if (entity.email !== null && entity.email !== undefined) {
      entity.email = this.sensitiveService.encrypt({ input: entity.email, aad: this.aad(entity.id) });
    }
  }

  private aad(id: string): string {
    return `${EMAIL_AAD_PREFIX}:${id}`;
  }
}
