import { CacheKey } from './cache-key.util';

describe('CacheKey', () => {
  describe('join', () => {
    it('joins parts with the configured separator', () => {
      expect(CacheKey.join('user', 42, 'profile')).toBe('user:42:profile');
    });

    it('coerces numeric parts to strings', () => {
      expect(CacheKey.join(1, 2)).toBe('1:2');
    });

    it('returns a single part unchanged', () => {
      expect(CacheKey.join('solo')).toBe('solo');
    });

    it('returns an empty string when given no parts', () => {
      expect(CacheKey.join()).toBe('');
    });
  });
});
