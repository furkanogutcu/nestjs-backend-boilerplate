import { ValueTransformer } from 'typeorm';

// ! Lossy above 2^53 — only for columns bounded by Number.MAX_SAFE_INTEGER; use BigIntStringTransformer otherwise.
export class BigintTransformer implements ValueTransformer {
  to(value: number | null): number | null {
    return value ?? null;
  }

  from(value: string | null): number | null {
    return value === null ? null : Number(value);
  }
}
