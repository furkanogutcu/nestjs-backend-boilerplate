import { AppInternalException } from '@shared/exceptions/internal.exception';

import { EncryptedColumnTransformer } from './encrypted-column.transformer';

const AAD = 'oauth_accounts.email';

describe('EncryptedColumnTransformer', () => {
  describe('to', () => {
    it('encrypts a value into a versioned envelope rather than storing plaintext', () => {
      const ciphertext = new EncryptedColumnTransformer(AAD).to('user@example.com');

      expect(ciphertext).not.toBe('user@example.com');
      expect(ciphertext as string).toMatch(/^v1:/);
    });

    it('round-trips a value back to its plaintext under the same aad', () => {
      const transformer = new EncryptedColumnTransformer(AAD);

      expect(transformer.from(transformer.to('user@example.com'))).toBe('user@example.com');
    });

    it('returns null for null', () => {
      expect(new EncryptedColumnTransformer(AAD).to(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(new EncryptedColumnTransformer(AAD).to(undefined)).toBeNull();
    });

    it('encrypts an empty string instead of treating it as null', () => {
      const transformer = new EncryptedColumnTransformer(AAD);
      const ciphertext = transformer.to('');

      expect(ciphertext).not.toBeNull();
      expect(ciphertext as string).toMatch(/^v1:/);
      expect(transformer.from(ciphertext)).toBe('');
    });

    it('preserves a value that contains the envelope separator', () => {
      const transformer = new EncryptedColumnTransformer(AAD);
      const value = 'weird:value:with@colons.com';

      expect(transformer.from(transformer.to(value))).toBe(value);
    });

    it('preserves unicode and long values', () => {
      const transformer = new EncryptedColumnTransformer(AAD);
      const value = `çöğüş-${'x'.repeat(5000)}-📧@example.com`;

      expect(transformer.from(transformer.to(value))).toBe(value);
    });

    it('produces a different envelope on each call due to a random IV', () => {
      const transformer = new EncryptedColumnTransformer(AAD);

      expect(transformer.to('same@example.com')).not.toBe(transformer.to('same@example.com'));
    });
  });

  describe('from', () => {
    it('returns null for null', () => {
      expect(new EncryptedColumnTransformer(AAD).from(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(new EncryptedColumnTransformer(AAD).from(undefined as unknown as string)).toBeNull();
    });

    it('throws on a legacy/plaintext value lacking the envelope format (no silent passthrough)', () => {
      expect(() => new EncryptedColumnTransformer(AAD).from('user@example.com')).toThrow(AppInternalException);
    });
  });

  describe('aad binding', () => {
    it('throws when decrypting a value under a different aad context (domain separation)', () => {
      const ciphertext = new EncryptedColumnTransformer('context-a').to('user@example.com');

      expect(() => new EncryptedColumnTransformer('context-b').from(ciphertext)).toThrow(AppInternalException);
    });
  });
});
