import { ValueTransformer } from 'typeorm';

// * Postgres bigint arrives as a string from the driver. Unlike money (BigintTransformer → JS number,
// * which stays within Number.MAX_SAFE_INTEGER), accumulated production quantities multiplied by storage
// * footprints overflow 2^53, so these columns map to native bigint and serialize to the wire as a string.
export class BigIntStringTransformer implements ValueTransformer {
  to(value: bigint | null): string | null {
    return value === null || value === undefined ? null : value.toString();
  }

  from(value: string | null): bigint | null {
    return value === null ? null : BigInt(value);
  }
}
