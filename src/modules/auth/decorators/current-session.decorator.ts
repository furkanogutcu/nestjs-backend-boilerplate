import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { AppInternalException } from '@shared/exceptions/internal.exception';

export const CurrentSession = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request: Request = ctx.switchToHttp().getRequest();

  if (!request.session) {
    throw new AppInternalException({ message: 'CurrentSession used on a route that is not authenticated' });
  }

  return request.session;
});
