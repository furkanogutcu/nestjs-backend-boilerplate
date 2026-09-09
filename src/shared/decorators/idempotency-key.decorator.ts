import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AppInternalException } from '../exceptions/internal.exception';

export const IdempotencyKey = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request: Request = ctx.switchToHttp().getRequest();
  const header = request.headers['idempotency-key'];
  const key = Array.isArray(header) ? header[0] : header;

  if (!key) {
    throw new AppInternalException({ message: 'IdempotencyKey used on a route without a required Idempotency-Key' });
  }

  return key;
});
