import { ValueTransformer } from 'typeorm';

import { SensitiveService } from './sensitive.service';

let sensitiveService: SensitiveService | undefined;

const getSensitiveService = (): SensitiveService => (sensitiveService ??= new SensitiveService());

export class EncryptedColumnTransformer implements ValueTransformer {
  constructor(private readonly aad: string) {}

  to(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    return getSensitiveService().encrypt({ input: value, aad: this.aad });
  }

  from(value: string | null): unknown {
    if (value === null || value === undefined) {
      return null;
    }

    return getSensitiveService().decrypt({ input: value, aad: this.aad });
  }
}
