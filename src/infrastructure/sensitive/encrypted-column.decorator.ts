import { Column, ColumnOptions } from 'typeorm';

import { EncryptedColumnTransformer } from './encrypted-column.transformer';

// * Declarative at-rest encryption: mark a column and the value is transparently encrypted on write / decrypted on
// * read. `aad` is REQUIRED and binds the ciphertext to a static context ("table.column") for cross-column domain
// * separation. Note: this is COLUMN-scoped only — a value that must resist being relocated between ROWS by a
// * DB-write attacker needs a subscriber that folds the row's primary key into the AAD (see OAuthAccountSubscriber).
export function EncryptedColumn(options: ColumnOptions & { aad: string }): PropertyDecorator {
  const { aad, ...columnOptions } = options;

  return Column({ type: 'varchar', ...columnOptions, transformer: new EncryptedColumnTransformer(aad) });
}
