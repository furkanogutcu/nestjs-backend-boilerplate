import { ValueTransformer } from 'typeorm';

// * Postgres bigint arrives as a string from the driver; map it to a JS number. Monetary values are
// * stored in minor units (USD cents) and stay far within Number.MAX_SAFE_INTEGER, so this is lossless.
export class BigintTransformer implements ValueTransformer {
  to(value: number | null): number | null {
    return value ?? null;
  }

  from(value: string | null): number | null {
    return value === null ? null : Number(value);
  }
}
