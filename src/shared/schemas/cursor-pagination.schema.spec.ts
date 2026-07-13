import { encodeCursor } from '@shared/utils/cursor.util';

import { cursorPaginationSchema } from './cursor-pagination.schema';

describe('cursorPaginationSchema', () => {
  it('applies defaults (page_size 20, no cursor) for an empty query', () => {
    expect(cursorPaginationSchema.parse({})).toEqual({ take: 20, cursor: undefined });
  });

  it('coerces page_size and decodes the cursor', () => {
    const cursor = encodeCursor({ field: 'id', value: 10, direction: 'asc', id: 10 });

    expect(cursorPaginationSchema.parse({ page_size: '5', cursor })).toEqual({
      take: 5,
      cursor: { field: 'id', value: 10, direction: 'asc', id: 10 },
    });
  });

  it('accepts page_size at the upper bound of 100', () => {
    expect(cursorPaginationSchema.parse({ page_size: '100' })).toEqual({ take: 100, cursor: undefined });
  });

  it('rejects page_size above 100', () => {
    expect(cursorPaginationSchema.safeParse({ page_size: '101' }).success).toBe(false);
  });

  it('rejects a non-positive page_size', () => {
    expect(cursorPaginationSchema.safeParse({ page_size: '0' }).success).toBe(false);
  });

  it('rejects an invalid cursor', () => {
    const result = cursorPaginationSchema.safeParse({ cursor: 'not-a-valid-cursor!!!' });

    expect(result.success).toBe(false);
  });
});
