import { InsertEvent } from 'typeorm';

import { AppInternalException } from '@shared/exceptions/internal.exception';

import { OAuthAccount } from '../oauth-account.entity';
import { OAuthAccountSubscriber } from './oauth-account.subscriber';

function account({ id, email }: { id: string; email: string | null }): OAuthAccount {
  return { id, email } as OAuthAccount;
}

function insertEvent(entity: OAuthAccount): InsertEvent<OAuthAccount> {
  return { entity } as InsertEvent<OAuthAccount>;
}

describe('OAuthAccountSubscriber', () => {
  let subscriber: OAuthAccountSubscriber;

  beforeEach(() => {
    subscriber = new OAuthAccountSubscriber();
  });

  it('listens only to OAuthAccount', () => {
    expect(subscriber.listenTo()).toBe(OAuthAccount);
  });

  it('encrypts the email to a versioned ciphertext on insert', () => {
    const entity = account({ id: 'id-1', email: 'user@example.com' });

    subscriber.beforeInsert(insertEvent(entity));

    expect(entity.email).toMatch(/^v1:/);
    expect(entity.email).not.toContain('user@example.com');
  });

  it('round-trips: an inserted ciphertext decrypts back to plaintext on load', () => {
    const entity = account({ id: 'id-1', email: 'user@example.com' });

    subscriber.beforeInsert(insertEvent(entity));
    subscriber.afterLoad(entity);

    expect(entity.email).toBe('user@example.com');
  });

  it('binds the ciphertext to the row: a blob relocated to another row fails to decrypt', () => {
    const rowA = account({ id: 'id-A', email: 'user@example.com' });
    subscriber.beforeInsert(insertEvent(rowA));

    // * Simulate a DB-write attacker copying row A's email ciphertext into a different row (id-B).
    const rowB = account({ id: 'id-B', email: rowA.email });

    expect(() => subscriber.afterLoad(rowB)).toThrow(AppInternalException);
  });

  it('leaves a null email untouched on insert and load', () => {
    const entity = account({ id: 'id-1', email: null });

    subscriber.beforeInsert(insertEvent(entity));
    expect(entity.email).toBeNull();

    subscriber.afterLoad(entity);
    expect(entity.email).toBeNull();
  });
});
