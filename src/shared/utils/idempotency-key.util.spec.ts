import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';
import { AppValidationException } from '../exceptions/validation.exception';
import { validateIdempotencyKey } from './idempotency-key.util';

describe('validateIdempotencyKey', () => {
  describe('baseline (authenticated / default)', () => {
    it('accepts a key at the minimum length (16)', () => {
      expect(() => validateIdempotencyKey({ value: 'a'.repeat(16) })).not.toThrow();
    });

    it('accepts a key at the maximum length (128)', () => {
      expect(() => validateIdempotencyKey({ value: 'a'.repeat(128) })).not.toThrow();
    });

    it('rejects a key below the minimum length (15)', () => {
      expect(() => validateIdempotencyKey({ value: 'a'.repeat(15) })).toThrow(AppValidationException);
    });

    it('rejects a key above the maximum length (129)', () => {
      expect(() => validateIdempotencyKey({ value: 'a'.repeat(129) })).toThrow(AppValidationException);
    });

    it('rejects a key containing whitespace', () => {
      expect(() => validateIdempotencyKey({ value: `${'a'.repeat(10)} ${'a'.repeat(10)}` })).toThrow(
        AppValidationException,
      );
    });

    it('rejects a key containing a control character', () => {
      expect(() => validateIdempotencyKey({ value: `${'a'.repeat(16)}\n` })).toThrow(AppValidationException);
    });

    it('applies the baseline schema for the User source', () => {
      expect(() =>
        validateIdempotencyKey({ value: 'a'.repeat(16), principalSource: IdempotencyPrincipalSource.User }),
      ).not.toThrow();
    });
  });

  describe('anonymous (strict)', () => {
    const anon = (value: string): void =>
      validateIdempotencyKey({ value, principalSource: IdempotencyPrincipalSource.Anonymous });

    it('accepts a 24-char base64url key', () => {
      expect(() => anon('a'.repeat(24))).not.toThrow();
    });

    it('accepts a UUID', () => {
      expect(() => anon('123e4567-e89b-12d3-a456-426614174000')).not.toThrow();
    });

    it('rejects a key below the entropy floor (23)', () => {
      expect(() => anon('a'.repeat(23))).toThrow(AppValidationException);
    });

    it('rejects a key with characters outside the high-entropy charset', () => {
      expect(() => anon(`${'a'.repeat(23)}/`)).toThrow(AppValidationException);
    });
  });
});
