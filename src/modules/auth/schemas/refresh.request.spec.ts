import { refreshRequestSchema } from './refresh.request';

describe('refreshRequestSchema', () => {
  it('parses a valid refresh request', () => {
    expect(refreshRequestSchema.parse({ refresh_token: 'v1.token' })).toEqual({ refresh_token: 'v1.token' });
  });

  it.each([
    ['an empty refresh_token', { refresh_token: '' }],
    ['a refresh_token over the max length', { refresh_token: 'a'.repeat(513) }],
    ['an unknown key', { refresh_token: 'v1.token', extra: 'nope' }],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('rejects %s', (_label, value) => {
    expect(refreshRequestSchema.safeParse(value).success).toBe(false);
  });
});
