import { generateUuid, isUuid } from './uuid.util';

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generateUuid', () => {
  it('generates a well-formed UUIDv7 (version and variant bits)', () => {
    expect(generateUuid()).toMatch(UUID_V7_PATTERN);
  });
});

describe('isUuid', () => {
  it('accepts a generated UUIDv7', () => {
    expect(isUuid(generateUuid())).toBe(true);
  });

  it.each(['v1', '', 'not-a-uuid', '0190d5e0-1111-7222-8333-44444444444'])('rejects the non-uuid value %p', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});
