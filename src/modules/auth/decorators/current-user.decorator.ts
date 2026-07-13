import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AppInternalException } from '@shared/exceptions/internal.exception';

// eslint-disable-next-line no-restricted-syntax -- NestJS createParamDecorator factory signature is fixed (data, ctx)
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request: Request = ctx.switchToHttp().getRequest();

  if (!request.user) {
    throw new AppInternalException({ message: 'CurrentUser used on a route that is not authenticated' });
  }

  return request.user;
});
