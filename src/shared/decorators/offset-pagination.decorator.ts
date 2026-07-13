import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

import { offsetPaginationSchema } from '@shared/schemas/offset-pagination.schema';

import { parseClientInput } from '../utils/parse-client-input.util';

// eslint-disable-next-line no-restricted-syntax -- NestJS createParamDecorator factory signature is fixed (data, ctx)
export const OffsetPagination = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request: Request = ctx.switchToHttp().getRequest();

  return parseClientInput({ schema: offsetPaginationSchema, value: request.query });
});
