import { signinGameCenterSchema } from './signin-game-center.request';

const validAssertion = {
  team_player_id: 'A:_a1b2c3d4e5f6789012345678',
  public_key_url: 'https://static.gc.apple.com/public-key/gc-prod-9.cer',
  signature: 'MEUCIQ',
  salt: 'NDA4',
  timestamp: 1717000000000,
};

describe('signinGameCenterSchema', () => {
  it('parses a valid Game Center sign-in assertion', () => {
    expect(signinGameCenterSchema.parse(validAssertion)).toEqual(validAssertion);
  });

  it.each([
    ['a non-url public_key_url', { ...validAssertion, public_key_url: 'not-a-url' }],
    ['a non-integer timestamp', { ...validAssertion, timestamp: 1.5 }],
    ['a non-positive timestamp', { ...validAssertion, timestamp: 0 }],
    ['an unknown key', { ...validAssertion, refresh_token: 'nope' }],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('rejects %s', (_label, value) => {
    expect(signinGameCenterSchema.safeParse(value).success).toBe(false);
  });
});
