import { signinGoogleSchema } from './signin-google.request';

describe('signinGoogleSchema', () => {
  it('parses a valid Google sign-in request', () => {
    expect(signinGoogleSchema.parse({ id_token: 'header.payload.signature' })).toEqual({
      id_token: 'header.payload.signature',
    });
  });

  it.each([
    ['an empty id_token', { id_token: '' }],
    ['an id_token over the max length', { id_token: 'a'.repeat(4097) }],
    ['an unknown key', { id_token: 'header.payload.signature', refresh_token: 'nope' }],
  ])('rejects %s', (_label, value) => {
    expect(signinGoogleSchema.safeParse(value).success).toBe(false);
  });
});
