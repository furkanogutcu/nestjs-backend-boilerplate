import { linkPlayGamesSchema } from './link-play-games.request';

describe('linkPlayGamesSchema', () => {
  it('parses a valid Play Games link request', () => {
    const value = { server_auth_code: '4/0Aean', refresh_token: 'v1.token' };

    expect(linkPlayGamesSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['a missing refresh_token', { server_auth_code: '4/0Aean' }],
    ['an empty server_auth_code', { server_auth_code: '', refresh_token: 'v1.token' }],
    ['an unknown key', { server_auth_code: '4/0Aean', refresh_token: 'v1.token', extra: 'nope' }],
  ])('rejects %s', (_label, value) => {
    expect(linkPlayGamesSchema.safeParse(value).success).toBe(false);
  });
});
