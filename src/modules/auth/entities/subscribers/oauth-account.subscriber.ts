import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent } from 'typeorm';

import { SensitiveService } from '@infrastructure/sensitive/sensitive.service';

import { OAuthAccount } from '../oauth-account.entity';

// * The AAD prefix; the row's primary key is appended so the ciphertext is bound to THIS row.
const EMAIL_AAD_PREFIX = 'oauth_accounts.email';

// * Row-bound at-rest encryption for OAuthAccount.email. A column ValueTransformer has no row context, so its AAD can
// * only bind to the column ("table.column") — an attacker who can WRITE the DB could relocate one row's email
// * ciphertext into another row and it would still decrypt. A subscriber sees the entity's primary key, so the AAD is
// * `oauth_accounts.email:<id>`: a relocated blob fails the GCM auth-tag check on read. Email is written once at link
// * (and possibly re-written on re-link) and read on load; the created entity's email is not read back after save, so
// * no post-write decrypt is needed. @EventSubscriber registers it (with the data source's subscribers glob).
@EventSubscriber()
export class OAuthAccountSubscriber implements EntitySubscriberInterface<OAuthAccount> {
  // * Instantiated by TypeORM outside Nest DI, like the encrypted-column transformer; one cipher per subscriber.
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
