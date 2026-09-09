import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AppInternalException } from '@shared/exceptions/internal.exception';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request: Request = ctx.switchToHttp().getRequest();

  if (!request.user) {
    throw new AppInternalException({ message: 'CurrentUser used on a route that is not authenticated' });
  }

  return request.user;
});
