import { decodeCursor, encodeCursor, IDecodedCursor } from './cursor.util';

const sample: IDecodedCursor = { field: 'created_at', value: '2026-01-01T00:00:00.000Z', direction: 'asc', id: 42 };

describe('cursor.util', () => {
  it('round-trips a cursor through encode and decode', () => {
    expect(decodeCursor(encodeCursor(sample))).toEqual(sample);
  });

  it('preserves numeric and string values and ids', () => {
    const cursor: IDecodedCursor = { field: 'name', value: 'Wheat', direction: 'desc', id: 'a-uuid' };

    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('returns null for malformed base64/JSON', () => {
    expect(decodeCursor('!!!not-base64-json!!!')).toBeNull();
  });

  it('returns null when the decoded payload is not an object', () => {
    expect(decodeCursor(Buffer.from('"a string"', 'utf8').toString('base64url'))).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    const incomplete = Buffer.from(JSON.stringify({ field: 'id', value: 1 }), 'utf8').toString('base64url');

    expect(decodeCursor(incomplete)).toBeNull();
  });

  it('returns null when the direction is invalid', () => {
    const badDirection = Buffer.from(
      JSON.stringify({ field: 'id', value: 1, id: 1, direction: 'sideways' }),
      'utf8',
    ).toString('base64url');

    expect(decodeCursor(badDirection)).toBeNull();
  });

  it('returns null when value/id are not string or number', () => {
    const badValue = Buffer.from(
      JSON.stringify({ field: 'id', value: { nested: true }, id: 1, direction: 'asc' }),
      'utf8',
    ).toString('base64url');

    expect(decodeCursor(badValue)).toBeNull();
  });
});
