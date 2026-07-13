import { nonceResponseSchema } from './nonce.response';

describe('nonceResponseSchema', () => {
  it('parses a nonce payload', () => {
    const value = { nonce: 'n_8Kx2mQ7vL3pR9tZ0aB1cD4eF5gH6jK' };

    expect(nonceResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects a missing nonce', () => {
    expect(nonceResponseSchema.safeParse({}).success).toBe(false);
  });
});
