import { SetMetadata } from '@nestjs/common';

import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';

export const IDEMPOTENT_KEY = 'idempotent_key';

export interface IIdempotentOptions {
  scope: string;
  responseTtlSeconds: number;
  principalSource: IdempotencyPrincipalSource;
  // * When true a missing Idempotency-Key is rejected (not silently passed through). Use on money-moving,
  // * NON-idempotent routes (purchase, level-up) where an accidental double-submit would charge/act twice.
  required: boolean;
}

export const Idempotent = (options: {
  scope: string;
  responseTtlSeconds: number;
  principalSource?: IdempotencyPrincipalSource;
  required?: boolean;
}) =>
  SetMetadata<string, IIdempotentOptions>(IDEMPOTENT_KEY, {
    principalSource: IdempotencyPrincipalSource.User,
    required: false,
    ...options,
  });
