import { env } from '@config/env.config';
import { AppInternalException } from '@shared/exceptions/internal.exception';

import { SensitiveService } from './sensitive.service';

const VALID_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// * jest.mock is hoisted above imports, so the factory inlines values; we grab a mutable reference to the mocked env to drive the construction guard.
jest.mock('@config/env.config', () => ({
  env: {
    ENCRYPTION_KEYS: { k1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
    ENCRYPTION_ACTIVE_KID: 'k1',
  },
}));

const mockEnv = env as unknown as { ENCRYPTION_KEYS: Record<string, string>; ENCRYPTION_ACTIVE_KID: string };

describe('SensitiveService', () => {
  let service: SensitiveService;

  beforeEach(() => {
    mockEnv.ENCRYPTION_KEYS = { k1: VALID_KEY };
    mockEnv.ENCRYPTION_ACTIVE_KID = 'k1';
    service = new SensitiveService();
  });

  describe('construction', () => {
    it('throws when the active key id is not present in the key set', () => {
      mockEnv.ENCRYPTION_ACTIVE_KID = 'k-absent';

      expect(() => new SensitiveService()).toThrow(AppInternalException);
    });
  });

  describe('round-trip', () => {
    it('encrypts and decrypts an object', () => {
      const encrypted = service.encrypt({ input: { userId: 42, role: 'admin' } });

      expect(encrypted).toMatch(/^v1:k1:/);
      expect(service.decrypt({ input: encrypted })).toEqual({ userId: 42, role: 'admin' });
    });

    it('encrypts and decrypts primitive values', () => {
      expect(service.decrypt({ input: service.encrypt({ input: 'hello' }) })).toBe('hello');
      expect(service.decrypt({ input: service.encrypt({ input: 42 }) })).toBe(42);
    });

    it('produces a different ciphertext each call due to a random IV', () => {
      expect(service.encrypt({ input: 'same' })).not.toBe(service.encrypt({ input: 'same' }));
    });
  });

  describe('encrypt', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      // eslint-disable-next-line no-restricted-syntax -- Jest it.each row callback signature is positional
    ])('throws when the input is %s', (_label, input) => {
      expect(() => service.encrypt({ input })).toThrow(AppInternalException);
    });

    it('embeds the active key id in the envelope', () => {
      const encrypted = service.encrypt({ input: { a: 1 } });

      expect(encrypted.split(':').slice(0, 2)).toEqual(['v1', 'k1']);
    });
  });

  describe('additional authenticated data (AAD)', () => {
    it('round-trips when the same AAD is supplied to encrypt and decrypt', () => {
      const aad = 'user:42:field:email';
      const encrypted = service.encrypt({ input: 'secret@example.com', aad });

      expect(service.decrypt({ input: encrypted, aad })).toBe('secret@example.com');
    });

    it('fails to decrypt when the AAD differs (ciphertext relocation guard)', () => {
      const encrypted = service.encrypt({ input: 'secret@example.com', aad: 'user:42:field:email' });

      expect(() => service.decrypt({ input: encrypted, aad: 'user:99:field:email' })).toThrow(
        'Failed to decrypt payload',
      );
    });

    it('fails to decrypt when AAD is missing at decrypt time', () => {
      const encrypted = service.encrypt({ input: 'secret', aad: 'ctx' });

      expect(() => service.decrypt({ input: encrypted })).toThrow('Failed to decrypt payload');
    });

    it('accepts a Buffer AAD', () => {
      const aad = Buffer.from('binary-context');
      const encrypted = service.encrypt({ input: { ok: true }, aad });

      expect(service.decrypt({ input: encrypted, aad })).toEqual({ ok: true });
    });
  });

  describe('decrypt', () => {
    it('throws on an empty input', () => {
      expect(() => service.decrypt({ input: '' })).toThrow('Input cannot be empty');
    });

    it('throws on a payload without the expected segments', () => {
      expect(() => service.decrypt({ input: 'garbage' })).toThrow('Invalid encrypted payload format');
    });

    it('throws on an unexpected version prefix', () => {
      expect(() => service.decrypt({ input: 'v2:deadbeef:cafe' })).toThrow('Invalid encrypted payload format');
    });

    it('throws when the key id is not in the key set', () => {
      const [, , ivHex, dataHex] = service.encrypt({ input: { a: 1 } }).split(':');

      expect(() => service.decrypt({ input: `v1:k9:${ivHex}:${dataHex}` })).toThrow('Unknown encryption key id');
    });

    it('throws when the ciphertext has been tampered with', () => {
      const encrypted = service.encrypt({ input: { a: 1 } });
      const lastChar = encrypted.at(-1);
      const tampered = `${encrypted.slice(0, -1)}${lastChar === '0' ? '1' : '0'}`;

      expect(() => service.decrypt({ input: tampered })).toThrow('Failed to decrypt payload');
    });
  });
});
