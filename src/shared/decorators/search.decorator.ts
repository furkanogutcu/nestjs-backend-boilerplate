import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { FindOperator, Raw } from 'typeorm';

import { searchSchema } from '@shared/schemas/search.schema';

import { parseClientInput } from '../utils/parse-client-input.util';

export type SearchParams<TEntity> = Partial<Record<keyof TEntity, FindOperator<string>>>[] | undefined;

export const Search = <TEntity>(fields: (keyof TEntity)[]) =>
  // eslint-disable-next-line no-restricted-syntax -- NestJS createParamDecorator factory signature is fixed (data, ctx)
  createParamDecorator((_data: unknown, ctx: ExecutionContext): SearchParams<TEntity> => {
    const request = ctx.switchToHttp().getRequest<Request>();

    const parsed = parseClientInput({ schema: searchSchema, value: request.query });

    if (!parsed.q) return undefined;

    const escaped = parsed.q.replace(/[\\%_]/g, '\\$&');

    return fields.map((field) => ({
      [field]: Raw((alias) => `CAST(${alias} AS TEXT) ILIKE :searchTerm`, {
        searchTerm: `%${escaped}%`,
      }), // * Type casting for uuid columns
    })) as SearchParams<TEntity>;
  })();
