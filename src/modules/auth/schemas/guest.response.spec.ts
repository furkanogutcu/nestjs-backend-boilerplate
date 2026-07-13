import { guestResponseSchema } from './guest.response';

describe('guestResponseSchema', () => {
  it('parses a token pair extended with the user summary', () => {
    const value = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789', is_anonymous: true },
    };

    expect(guestResponseSchema.parse(value)).toEqual(value);
  });

  it('rejects a non-uuid user id', () => {
    const value = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'Bearer',
      expires_in: 900,
      user: { id: 'not-a-uuid', is_anonymous: true },
    };

    expect(guestResponseSchema.safeParse(value).success).toBe(false);
  });
});
