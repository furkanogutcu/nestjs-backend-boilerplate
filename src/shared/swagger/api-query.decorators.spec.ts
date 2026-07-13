import { Reflector } from '@nestjs/core';
import { DECORATORS } from '@nestjs/swagger';

import {
  ApiCursorPaginationQuery,
  ApiOffsetPaginationQuery,
  ApiOrderByQuery,
  ApiSearchQuery,
} from './api-query.decorators';

interface IQueryParamDoc {
  name: string;
  required: boolean;
  in: string;
  schema: Record<string, unknown>;
  description: string;
}

const reflector = new Reflector();

function queryParamsOf(decorator: MethodDecorator): IQueryParamDoc[] {
  class Probe {
    handler(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Probe.prototype, 'handler') as PropertyDescriptor;
  decorator(Probe.prototype, 'handler', descriptor);

  return reflector.get<IQueryParamDoc[]>(DECORATORS.API_PARAMETERS, descriptor.value) ?? [];
}

describe('api-query.decorators', () => {
  it('ApiOffsetPaginationQuery documents page and a page_size capped at 100', () => {
    const params = queryParamsOf(ApiOffsetPaginationQuery());

    expect(params.find((p) => p.name === 'page')).toMatchObject({
      in: 'query',
      required: false,
      schema: { type: 'integer', minimum: 1, default: 1 },
    });
    expect(params.find((p) => p.name === 'page_size')).toMatchObject({
      required: false,
      schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    });
  });

  it('ApiCursorPaginationQuery documents an opaque cursor alongside page_size', () => {
    const params = queryParamsOf(ApiCursorPaginationQuery());

    expect(params.find((p) => p.name === 'cursor')).toMatchObject({ required: false, schema: { type: 'string' } });
    expect(params.find((p) => p.name === 'page_size')).toMatchObject({ schema: { maximum: 100, default: 20 } });
  });

  it('ApiSearchQuery documents a free-text q capped at 100 characters', () => {
    const params = queryParamsOf(ApiSearchQuery());

    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ name: 'q', required: false, schema: { type: 'string', maxLength: 100 } });
  });

  it('ApiOrderByQuery lists the allowed fields in the order_by description', () => {
    const orderBy = queryParamsOf(ApiOrderByQuery(['name', 'createdAt']))[0];

    expect(orderBy.name).toBe('order_by');
    expect(orderBy.description).toContain('name, createdAt');
    expect(orderBy.description).toContain('-name');
  });

  it('ApiOrderByQuery falls back to a generic field hint for an empty field list', () => {
    const orderBy = queryParamsOf(ApiOrderByQuery([]))[0];

    expect(orderBy.description).toContain('-field');
  });
});
