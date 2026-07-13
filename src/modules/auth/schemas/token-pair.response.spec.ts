import { tokenPairResponseSchema } from './token-pair.response';

describe('tokenPairResponseSchema', () => {
  it('parses a valid token pair', () => {
    const value = { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 900 };

    expect(tokenPairResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects a non-integer expires_in', () => {
    const value = { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 1.5 };

    expect(tokenPairResponseSchema.safeParse(value).success).toBe(false);
  });
});
