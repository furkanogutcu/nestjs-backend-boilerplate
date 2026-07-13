import { sanitizeDisplayName } from './display-name.util';

const NUL = String.fromCharCode(0x00); // * control (Cc)
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b); // * format (Cf)
const RTL_OVERRIDE = String.fromCharCode(0x202e); // * bidi override (Cf)
const COMBINING_ACUTE = String.fromCharCode(0x0301); // * combining mark

describe('sanitizeDisplayName', () => {
  it('returns null for empty, blank, or missing input', () => {
    expect(sanitizeDisplayName(undefined)).toBeNull();
    expect(sanitizeDisplayName(null)).toBeNull();
    expect(sanitizeDisplayName('')).toBeNull();
    expect(sanitizeDisplayName('   ')).toBeNull();
  });

  it('strips control, zero-width, and bidi-override characters', () => {
    expect(sanitizeDisplayName(`A${NUL}B${ZERO_WIDTH_SPACE}C${RTL_OVERRIDE}D`)).toBe('ABCD');
  });

  it('normalizes combining sequences to NFC', () => {
    const result = sanitizeDisplayName(`e${COMBINING_ACUTE}`);

    expect(result).toBe(String.fromCharCode(0x00e9));
    expect(result).toHaveLength(1);
  });

  it('truncates to the maximum length', () => {
    expect(sanitizeDisplayName('a'.repeat(100))).toHaveLength(50);
  });
});
