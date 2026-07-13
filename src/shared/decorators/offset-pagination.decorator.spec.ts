import { ExecutionContext } from '@nestjs/common';

import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { AppValidationException } from '../exceptions/validation.exception';
import { OffsetPagination } from './offset-pagination.decorator';

function runOffsetPagination(query: Record<string, string>): unknown {
  const factory = getParamDecoratorFactory(OffsetPagination());
  const context: ExecutionContext = createMockExecutionContext({ request: createMockRequest({ query }) });

  return factory(undefined, context);
}

describe('OffsetPagination', () => {
  it('returns default skip/take when the query is empty', () => {
    expect(runOffsetPagination({})).toEqual({ skip: 0, take: 20 });
  });

  it('computes skip/take from page and page_size', () => {
    expect(runOffsetPagination({ page: '3', page_size: '10' })).toEqual({ skip: 20, take: 10 });
  });

  it('throws a client validation error when pagination parameters are invalid', () => {
    expect(() => runOffsetPagination({ page_size: '0' })).toThrow(AppValidationException);
  });
});
