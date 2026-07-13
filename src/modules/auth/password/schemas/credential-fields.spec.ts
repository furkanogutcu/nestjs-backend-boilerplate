import { emailSchema, passwordSchema } from './credential-fields';

describe('credential field schemas', () => {
  it('lowercases the email so case variants map to one account', () => {
    expect(emailSchema.parse('User@Example.COM')).toBe('user@example.com');
  });

  it('rejects a malformed email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('rejects a password below the minimum length', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
  });
});
