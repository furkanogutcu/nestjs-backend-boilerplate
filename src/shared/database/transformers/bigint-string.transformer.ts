import { ValueTransformer } from 'typeorm';

export class BigIntStringTransformer implements ValueTransformer {
  to(value: bigint | null): string | null {
    return value === null || value === undefined ? null : value.toString();
  }

  from(value: string | null): bigint | null {
    return value === null ? null : BigInt(value);
  }
}
