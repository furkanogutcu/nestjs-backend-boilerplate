import { offsetPaginationSchema } from './offset-pagination.schema';

describe('offsetPaginationSchema', () => {
  it('applies defaults (page 1, page_size 20) for an empty query', () => {
    expect(offsetPaginationSchema.parse({})).toEqual({ skip: 0, take: 20 });
  });

  it('coerces string query params to numbers', () => {
    expect(offsetPaginationSchema.parse({ page: '2', page_size: '5' })).toEqual({ skip: 5, take: 5 });
  });

  it('computes skip as (page - 1) * page_size', () => {
    expect(offsetPaginationSchema.parse({ page: '3', page_size: '10' })).toEqual({ skip: 20, take: 10 });
  });

  it('accepts page_size at the upper bound of 100', () => {
    expect(offsetPaginationSchema.parse({ page_size: '100' })).toEqual({ skip: 0, take: 100 });
  });

  it('rejects page_size above 100', () => {
    expect(offsetPaginationSchema.safeParse({ page_size: '101' }).success).toBe(false);
  });

  it('rejects a non-positive page', () => {
    expect(offsetPaginationSchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects a non-integer page', () => {
    expect(offsetPaginationSchema.safeParse({ page: '1.5' }).success).toBe(false);
  });
});
