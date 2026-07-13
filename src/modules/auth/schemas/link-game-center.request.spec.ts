import { linkGameCenterSchema } from './link-game-center.request';

const validAssertion = {
  team_player_id: 'A:_a1b2c3d4e5f6789012345678',
  public_key_url: 'https://static.gc.apple.com/public-key/gc-prod-9.cer',
  signature: 'MEUCIQ',
  salt: 'NDA4',
  timestamp: 1717000000000,
  refresh_token: 'v1.token',
};

describe('linkGameCenterSchema', () => {
  it('parses a valid Game Center link request', () => {
    expect(linkGameCenterSchema.parse(validAssertion)).toEqual(validAssertion);
  });

  it.each([
    ['a missing refresh_token', { ...validAssertion, refresh_token: undefined }],
    ['a non-url public_key_url', { ...validAssertion, public_key_url: 'not-a-url' }],
    ['a non-positive timestamp', { ...validAssertion, timestamp: -1 }],
    ['an unknown key', { ...validAssertion, extra: 'nope' }],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('rejects %s', (_label, value) => {
    expect(linkGameCenterSchema.safeParse(value).success).toBe(false);
  });
});
