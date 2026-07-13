export type CursorValue = string | number;

export interface IDecodedCursor {
  field: string;
  value: CursorValue;
  direction: 'asc' | 'desc';
  id: CursorValue;
}

function isCursorValue(value: unknown): value is CursorValue {
  return typeof value === 'string' || typeof value === 'number';
}

function isDecodedCursor(value: unknown): value is IDecodedCursor {
  if (typeof value !== 'object' || value === null) return false;

  const cursor = value as Record<string, unknown>;

  return (
    typeof cursor.field === 'string' &&
    isCursorValue(cursor.value) &&
    isCursorValue(cursor.id) &&
    (cursor.direction === 'asc' || cursor.direction === 'desc')
  );
}

export function encodeCursor(cursor: IDecodedCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

// * Cursor sort field must be NON-NULL: row-value comparison against NULL is undefined.
export function decodeCursor(raw: string): IDecodedCursor | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);

    return isDecodedCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
