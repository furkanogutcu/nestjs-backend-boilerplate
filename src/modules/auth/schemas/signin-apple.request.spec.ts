import { signinAppleSchema } from './signin-apple.request';

describe('signinAppleSchema', () => {
  it('parses a valid Apple sign-in request', () => {
    expect(signinAppleSchema.parse({ id_token: 'header.payload.signature' })).toEqual({
      id_token: 'header.payload.signature',
    });
  });

  it.each([
    ['an empty id_token', { id_token: '' }],
    ['an id_token over the max length', { id_token: 'a'.repeat(4097) }],
    ['an unknown key', { id_token: 'header.payload.signature', name: 'nope' }],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('rejects %s', (_label, value) => {
    expect(signinAppleSchema.safeParse(value).success).toBe(false);
  });
});
