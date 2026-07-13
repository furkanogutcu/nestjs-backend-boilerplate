import { sendMailSchema } from './send-mail.schema';

const validPayload = {
  to: 'user@app.test',
  subject: 'Welcome',
  template: 'welcome',
  context: { name: 'Furkan' },
};

describe('sendMailSchema', () => {
  it('parses a valid payload', () => {
    expect(sendMailSchema.parse(validPayload)).toEqual(validPayload);
  });

  it('accepts an empty context object', () => {
    expect(sendMailSchema.parse({ ...validPayload, context: {} })).toEqual({ ...validPayload, context: {} });
  });

  it.each([
    ['an invalid email', { to: 'not-an-email' }],
    ['an empty subject', { subject: '' }],
    ['an empty template', { template: '' }],
    ['a non-object context', { context: 'nope' }],
    // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
  ])('rejects %s', (_label, overrides) => {
    expect(sendMailSchema.safeParse({ ...validPayload, ...overrides }).success).toBe(false);
  });
});
