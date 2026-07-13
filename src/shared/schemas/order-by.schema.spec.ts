import { createOrderBySchema } from './order-by.schema';

describe('createOrderBySchema', () => {
  const schema = createOrderBySchema(['name', 'price']);

  it('treats order_by as optional', () => {
    expect(schema.parse({})).toEqual({ order_by: undefined });
  });

  it('parses a plain field as ascending', () => {
    expect(schema.parse({ order_by: 'name' })).toEqual({ order_by: { name: 'asc' } });
  });

  it('parses a "-" prefixed field as descending', () => {
    expect(schema.parse({ order_by: '-price' })).toEqual({ order_by: { price: 'desc' } });
  });

  it('rejects a field that is not in the allow-list', () => {
    expect(schema.safeParse({ order_by: 'createdAt' }).success).toBe(false);
  });

  it('rejects a "-" prefixed field that is not allowed', () => {
    expect(schema.safeParse({ order_by: '-createdAt' }).success).toBe(false);
  });
});
