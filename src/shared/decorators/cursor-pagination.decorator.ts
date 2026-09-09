import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { cursorPaginationSchema } from '@shared/schemas/cursor-pagination.schema';

import { parseClientInput } from '../utils/parse-client-input.util';

export const CursorPagination = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request: Request = ctx.switchToHttp().getRequest();

  return parseClientInput({ schema: cursorPaginationSchema, value: request.query });
});
