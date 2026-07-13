import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { AppValidationException } from '../exceptions/validation.exception';
import { OrderBy } from './order-by.decorator';

type Product = { name: string; price: number };

function runOrderBy({ orderBy, fields }: { orderBy: string | undefined; fields: (keyof Product)[] }): unknown {
  const factory = getParamDecoratorFactory(OrderBy<Product>(fields));
  const request = createMockRequest({ query: orderBy === undefined ? {} : { order_by: orderBy } });

  return factory(undefined, createMockExecutionContext({ request }));
}

describe('OrderBy', () => {
  it('returns undefined when order_by is absent', () => {
    expect(runOrderBy({ orderBy: undefined, fields: ['name'] })).toBeUndefined();
  });

  it('parses ascending order for a plain field', () => {
    expect(runOrderBy({ orderBy: 'name', fields: ['name', 'price'] })).toEqual({ name: 'asc' });
  });

  it('parses descending order for a "-" prefixed field', () => {
    expect(runOrderBy({ orderBy: '-price', fields: ['name', 'price'] })).toEqual({ price: 'desc' });
  });

  it('throws a client validation error when the requested field is not allowed', () => {
    expect(() => runOrderBy({ orderBy: 'createdAt', fields: ['name', 'price'] })).toThrow(AppValidationException);
  });
});
