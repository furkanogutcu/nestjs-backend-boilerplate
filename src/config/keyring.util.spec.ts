import { KID_PATTERN, parseKeyring } from './keyring.util';

const HEX = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);

const hexValidator = (value: string): string | null =>
  /^[0-9a-fA-F]{64}$/.test(value) ? null : 'must be a 64-character hex string (32 bytes)';
const minLengthValidator = (value: string): string | null =>
  value.length >= 32 ? null : 'must be at least 32 characters';

describe('parseKeyring', () => {
  describe('accepts and parses', () => {
    it.each<[string, string, Record<string, string>]>([
      ['a single pair', `k1:${HEX}`, { k1: HEX }],
      ['two pairs', `k1:${HEX},k2:${HEX_B}`, { k1: HEX, k2: HEX_B }],
      ['whitespace after commas', `k1:${HEX}, k2:${HEX_B}`, { k1: HEX, k2: HEX_B }],
      ['whitespace around kids and values', `  k1 : ${HEX}  ,  k2 : ${HEX_B}  `, { k1: HEX, k2: HEX_B }],
      ['a trailing comma', `k1:${HEX},`, { k1: HEX }],
      ['a leading comma', `,k1:${HEX}`, { k1: HEX }],
      ['empty entries between commas', `k1:${HEX},,k2:${HEX_B},,,`, { k1: HEX, k2: HEX_B }],
      ['hyphens and underscores in kids', `key-2024:${HEX}, key_old:${HEX_B}`, { 'key-2024': HEX, key_old: HEX_B }],
      ['case-sensitive kids', `k1:${HEX}, K1:${HEX_B}`, { k1: HEX, K1: HEX_B }],
    ])('parses %s', (_label, raw, expected) => {
      const { keys, errors } = parseKeyring({ raw, validateValue: hexValidator });

      expect(errors).toEqual([]);
      expect(keys).toEqual(expected);
    });

    it('splits kid from value on the first colon only (values may contain colons)', () => {
      const value = 'redis://user:pass@host:6379/0-with-32-or-more-chars';
      const { keys, errors } = parseKeyring({ raw: `k1:${value}`, validateValue: minLengthValidator });

      expect(errors).toEqual([]);
      expect(keys).toEqual({ k1: value });
    });
  });

  describe('reports errors', () => {
    it.each<[string, string]>([
      ['empty string', ''],
      ['only whitespace and commas', '  , , ,  '],
      ['an entry missing the colon separator', HEX],
      ['an empty kid', `:${HEX}`],
      ['an invalid character in the kid', `k!:${HEX}`],
      ['a space in the kid', `k 1:${HEX}`],
      ['a dot in the kid', `k.1:${HEX}`],
    ])('rejects %s with no valid keys', (_label, raw) => {
      const { keys, errors } = parseKeyring({ raw, validateValue: hexValidator });

      expect(keys).toEqual({});
      expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects a value the validator refuses and reports the validator message', () => {
      const { keys, errors } = parseKeyring({ raw: `k1:${'z'.repeat(64)}`, validateValue: hexValidator });

      expect(keys).toEqual({});
      expect(errors).toContain('key for "k1" must be a 64-character hex string (32 bytes)');
    });

    it('rejects a duplicate kid while keeping the first occurrence', () => {
      const { keys, errors } = parseKeyring({ raw: `k1:${HEX}, k1:${HEX_B}`, validateValue: hexValidator });

      expect(keys).toEqual({ k1: HEX });
      expect(errors).toContain('duplicate key id "k1"');
    });

    it('flags a malformed entry even when a sibling entry is valid', () => {
      const { keys, errors } = parseKeyring({ raw: `k1:${HEX}, k2:not-hex`, validateValue: hexValidator });

      expect(keys).toEqual({ k1: HEX });
      expect(errors.length).toBeGreaterThan(0);
    });

    it('always reports "at least one" when nothing parsed', () => {
      const { errors } = parseKeyring({ raw: '   ', validateValue: hexValidator });

      expect(errors).toContain('at least one valid "kid:value" pair is required');
    });
  });

  describe('with the min-length validator', () => {
    it('accepts a secret of at least 32 characters', () => {
      const secret = 's'.repeat(32);
      const { keys, errors } = parseKeyring({ raw: `jwt-k1:${secret}`, validateValue: minLengthValidator });

      expect(errors).toEqual([]);
      expect(keys).toEqual({ 'jwt-k1': secret });
    });

    it('rejects a secret shorter than 32 characters', () => {
      const { keys, errors } = parseKeyring({ raw: `jwt-k1:${'s'.repeat(31)}`, validateValue: minLengthValidator });

      expect(keys).toEqual({});
      expect(errors).toContain('key for "jwt-k1" must be at least 32 characters');
    });
  });

  describe('KID_PATTERN', () => {
    it.each(['k1', 'K1', 'key-2024', 'key_old', 'a'])('accepts %s', (kid) => {
      expect(KID_PATTERN.test(kid)).toBe(true);
    });

    it.each(['', 'k 1', 'k.1', 'k!', 'k:1', 'ké'])('rejects %s', (kid) => {
      expect(KID_PATTERN.test(kid)).toBe(false);
    });
  });
});
