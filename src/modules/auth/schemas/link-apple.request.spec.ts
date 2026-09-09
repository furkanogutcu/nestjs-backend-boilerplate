import { linkAppleSchema } from './link-apple.request';

describe('linkAppleSchema', () => {
  it('parses a valid Apple link request with an optional name', () => {
    const value = { id_token: 'header.payload.signature', refresh_token: 'v1.token', name: 'Nova' };

    expect(linkAppleSchema.parse(value)).toEqual(value);
  });

  it('parses without the optional name', () => {
    const value = { id_token: 'header.payload.signature', refresh_token: 'v1.token' };

    expect(linkAppleSchema.parse(value)).toEqual(value);
  });

  it.each([
    ['a missing refresh_token', { id_token: 'header.payload.signature' }],
    ['a name over the max length', { id_token: 'a', refresh_token: 'v1.token', name: 'a'.repeat(257) }],
    ['an unknown key', { id_token: 'a', refresh_token: 'v1.token', extra: 'nope' }],
  ])('rejects %s', (_label, value) => {
    expect(linkAppleSchema.safeParse(value).success).toBe(false);
  });
});
