import { signinPlayGamesSchema } from './signin-play-games.request';

describe('signinPlayGamesSchema', () => {
  it('parses a valid Play Games sign-in request', () => {
    expect(signinPlayGamesSchema.parse({ server_auth_code: '4/0Aean' })).toEqual({ server_auth_code: '4/0Aean' });
  });

  it.each([
    ['an empty server_auth_code', { server_auth_code: '' }],
    ['a server_auth_code over the max length', { server_auth_code: 'a'.repeat(2049) }],
    ['an unknown key', { server_auth_code: '4/0Aean', refresh_token: 'nope' }],
  ])('rejects %s', (_label, value) => {
    expect(signinPlayGamesSchema.safeParse(value).success).toBe(false);
  });
});
