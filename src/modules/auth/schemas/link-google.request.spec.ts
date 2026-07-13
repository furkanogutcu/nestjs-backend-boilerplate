import { linkGoogleSchema } from './link-google.request';

describe('linkGoogleSchema', () => {
  it('parses a valid Google link request', () => {
    const value = { id_token: 'header.payload.signature', refresh_token: 'v1.token' };

    expect(linkGoogleSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['a missing refresh_token', { id_token: 'header.payload.signature' }],
    ['an empty id_token', { id_token: '', refresh_token: 'v1.token' }],
    ['an unknown key', { id_token: 'header.payload.signature', refresh_token: 'v1.token', extra: 'nope' }],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('rejects %s', (_label, value) => {
    expect(linkGoogleSchema.safeParse(value).success).toBe(false);
  });
});
