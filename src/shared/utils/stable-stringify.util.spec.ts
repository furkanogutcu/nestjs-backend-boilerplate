import { stableStringify } from './stable-stringify.util';

describe('stableStringify', () => {
  it('produces identical output regardless of object key order', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('sorts keys deterministically', () => {
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('canonicalizes nested objects', () => {
    expect(stableStringify({ outer: { z: 1, a: 2 } })).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('preserves array element order while canonicalizing array items', () => {
    expect(stableStringify([{ b: 1, a: 2 }, 'x'])).toBe('[{"a":2,"b":1},"x"]');
  });

  it('distinguishes different values', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  it('handles primitives and null', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(5)).toBe('5');
  });
});
