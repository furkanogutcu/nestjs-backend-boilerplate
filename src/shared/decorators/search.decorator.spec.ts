import { FindOperator } from 'typeorm';

import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { AppValidationException } from '../exceptions/validation.exception';
import { Search } from './search.decorator';

type Product = { name: string; category: string };

type SearchResult = Array<Record<string, FindOperator<string>>>;

function runSearch({ q, fields }: { q: string | undefined; fields: (keyof Product)[] }): unknown {
  const factory = getParamDecoratorFactory(Search<Product>(fields));
  const request = createMockRequest({ query: q === undefined ? {} : { q } });

  return factory(undefined, createMockExecutionContext({ request }));
}

describe('Search', () => {
  it('returns undefined when q is absent', () => {
    expect(runSearch({ q: undefined, fields: ['name'] })).toBeUndefined();
  });

  it('builds a case-insensitive ILIKE raw operator for each field', () => {
    const result = runSearch({ q: 'wheat', fields: ['name', 'category'] }) as SearchResult;

    expect(result).toHaveLength(2);
    expect(Object.keys(result[0])).toEqual(['name']);
    expect(Object.keys(result[1])).toEqual(['category']);
    expect(result[0].name).toBeInstanceOf(FindOperator);
    expect(result[0].name.type).toBe('raw');
    expect(result[0].name.objectLiteralParameters).toEqual({ searchTerm: '%wheat%' });
    expect(result[0].name.getSql?.('product')).toContain('ILIKE :searchTerm');
  });

  it('escapes LIKE wildcards and backslashes in the search term', () => {
    const result = runSearch({ q: '50%_\\x', fields: ['name'] }) as SearchResult;

    expect(result[0].name.objectLiteralParameters).toEqual({ searchTerm: '%50\\%\\_\\\\x%' });
  });

  it('throws a client validation error when the search term exceeds the length limit', () => {
    expect(() => runSearch({ q: 'a'.repeat(101), fields: ['name'] })).toThrow(AppValidationException);
  });
});
