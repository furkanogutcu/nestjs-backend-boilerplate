import { SetMetadata } from '@nestjs/common';

import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';

export const IDEMPOTENT_KEY = 'idempotent_key';

export interface IIdempotentOptions {
  scope: string;
  responseTtlSeconds: number;
  principalSource: IdempotencyPrincipalSource;
  // * Rejects a missing key instead of passing through; for non-idempotent routes where a double-submit acts twice.
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
