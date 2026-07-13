import { ExecutionContext } from '@nestjs/common';

import { encodeCursor } from '@shared/utils/cursor.util';
import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { AppValidationException } from '../exceptions/validation.exception';
import { CursorPagination } from './cursor-pagination.decorator';

function runCursorPagination(query: Record<string, string>): unknown {
  const factory = getParamDecoratorFactory(CursorPagination());
  const context: ExecutionContext = createMockExecutionContext({ request: createMockRequest({ query }) });

  return factory(undefined, context);
}

describe('CursorPagination', () => {
  it('returns the default take and no cursor when the query is empty', () => {
    expect(runCursorPagination({})).toEqual({ take: 20, cursor: undefined });
  });

  it('decodes a provided cursor and page_size', () => {
    const cursor = encodeCursor({ field: 'id', value: 5, direction: 'asc', id: 5 });

    expect(runCursorPagination({ page_size: '2', cursor })).toEqual({
      take: 2,
      cursor: { field: 'id', value: 5, direction: 'asc', id: 5 },
    });
  });

  it('throws a client validation error when the cursor is invalid', () => {
    expect(() => runCursorPagination({ cursor: 'broken-cursor!!!' })).toThrow(AppValidationException);
  });
});
