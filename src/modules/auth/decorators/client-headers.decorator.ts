import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { validateIdempotencyKey } from '@shared/utils/idempotency-key.util';

import { IClientHeaders } from '../interfaces/client-headers.interface';

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export const ClientHeaders = createParamDecorator((_data: unknown, ctx: ExecutionContext): IClientHeaders => {
  const request: Request = ctx.switchToHttp().getRequest();

  const userAgent = single(request.headers['user-agent']);
  const idempotencyKey = single(request.headers['idempotency-key']);

  if (idempotencyKey !== undefined) {
    // * Authenticated routes are namespaced by the caller's principal, so the baseline key schema applies; the anonymous entropy floor is enforced only by the interceptor.
    validateIdempotencyKey({ value: idempotencyKey });
  }

  return { userAgent, idempotencyKey };
});
