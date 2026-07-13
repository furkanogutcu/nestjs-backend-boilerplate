import { BigIntStringTransformer } from './bigint-string.transformer';

describe('BigIntStringTransformer', () => {
  const transformer = new BigIntStringTransformer();

  describe('to', () => {
    it('serializes a bigint to its decimal string for the driver', () => {
      expect(transformer.to(9_007_199_254_740_993n)).toBe('9007199254740993');
    });

    it('returns null for null', () => {
      expect(transformer.to(null)).toBeNull();
    });

    it('returns null for undefined (an unset column)', () => {
      expect(transformer.to(undefined as unknown as bigint)).toBeNull();
    });
  });

  describe('from', () => {
    it('parses a driver string back into a native bigint past 2^53', () => {
      expect(transformer.from('9007199254740993')).toBe(9_007_199_254_740_993n);
    });

    it('returns null for null', () => {
      expect(transformer.from(null)).toBeNull();
    });
  });
});
