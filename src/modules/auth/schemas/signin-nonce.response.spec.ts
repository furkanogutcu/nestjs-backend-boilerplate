import { signinNonceResponseSchema } from './signin-nonce.response';

describe('signinNonceResponseSchema', () => {
  it('parses a nonce payload extended with its lifetime', () => {
    const value = { nonce: 'n_8Kx2mQ7vL3pR9tZ0aB1cD4eF5gH6jK', expires_in: 300 };

    expect(signinNonceResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects a non-integer expires_in', () => {
    const value = { nonce: 'n_8Kx2mQ7vL3pR9tZ0aB1cD4eF5gH6jK', expires_in: 1.5 };

    expect(signinNonceResponseSchema.safeParse(value).success).toBe(false);
  });
});
