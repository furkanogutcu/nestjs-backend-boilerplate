import { searchSchema } from './search.schema';

describe('searchSchema', () => {
  it('treats q as optional', () => {
    const result = searchSchema.safeParse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.q).toBeUndefined();
  });

  it('accepts a valid search term', () => {
    expect(searchSchema.parse({ q: 'wheat' })).toEqual({ q: 'wheat' });
  });

  it('accepts a term at the 100-character limit', () => {
    const q = 'a'.repeat(100);

    expect(searchSchema.parse({ q })).toEqual({ q });
  });

  it('rejects a term longer than 100 characters', () => {
    expect(searchSchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rejects a non-string term', () => {
    expect(searchSchema.safeParse({ q: 123 }).success).toBe(false);
  });
});
