import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { FindOptionsOrderValue } from 'typeorm';

import { createOrderBySchema } from '@shared/schemas/order-by.schema';

import { parseClientInput } from '../utils/parse-client-input.util';

export type OrderByParam<TEntity> = Partial<Record<keyof TEntity, FindOptionsOrderValue>> | undefined;

export const OrderBy = <TEntity>(fields: (keyof TEntity)[]) => {
  const orderBySchema = createOrderBySchema(fields as string[]);

  return createParamDecorator((_data: unknown, ctx: ExecutionContext): OrderByParam<TEntity> => {
    const request = ctx.switchToHttp().getRequest<Request>();

    return parseClientInput({ schema: orderBySchema, value: request.query }).order_by as OrderByParam<TEntity>;
  })();
};
