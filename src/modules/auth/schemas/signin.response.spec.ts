import { signinResponseSchema } from './signin.response';

describe('signinResponseSchema', () => {
  it('parses a token pair extended with the full user view', () => {
    const value = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer',
      expires_in: 900,
      user: {
        id: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789',
        is_anonymous: false,
        display_name: 'Captain Nova',
        linked_providers: [{ provider: 'google', email: 'user@example.com' }],
      },
    };

    expect(signinResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects when the nested user is missing', () => {
    const value = { access_token: 'access', refresh_token: 'refresh', token_type: 'Bearer', expires_in: 900 };

    expect(signinResponseSchema.safeParse(value).success).toBe(false);
  });
});
