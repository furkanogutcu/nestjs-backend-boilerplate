import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AppInternalException } from '@shared/exceptions/internal.exception';

// eslint-disable-next-line no-restricted-syntax -- NestJS createParamDecorator factory signature is fixed (data, ctx)
export const CurrentSession = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request: Request = ctx.switchToHttp().getRequest();

  if (!request.session) {
    throw new AppInternalException({ message: 'CurrentSession used on a route that is not authenticated' });
  }

  return request.session;
});
