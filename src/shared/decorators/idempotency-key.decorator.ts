import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AppInternalException } from '../exceptions/internal.exception';

// * Exposes the validated Idempotency-Key of a @Idempotent({ required: true }) route to its handler, so a money path
// * can derive a deterministic id from it (DB-level idempotency). The IdempotencyInterceptor has already enforced the
// * key's presence and format, so a missing value here means the decorator was misapplied to a non-required route.

export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request: Request = ctx.switchToHttp().getRequest();
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;

  if (!key) {
    throw new AppInternalException({ message: 'IdempotencyKey used on a route without a required Idempotency-Key' });
  }

  return key;
});
