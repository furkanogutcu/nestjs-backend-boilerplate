import { Column, ColumnOptions } from 'typeorm';

import { EncryptedColumnTransformer } from './encrypted-column.transformer';

// ! The AAD is COLUMN-scoped: a value that must also resist row relocation needs a subscriber folding the primary key in (see OAuthAccountSubscriber).
export function EncryptedColumn(options: ColumnOptions & { aad: string }): PropertyDecorator {
  const { aad, ...columnOptions } = options;

  return Column({ type: 'varchar', ...columnOptions, transformer: new EncryptedColumnTransformer(aad) });
}
