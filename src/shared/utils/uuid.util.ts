import { uuidv7 } from 'uuidv7';

// * uuid primary keys are app-side UUIDv7 (time-ordered for B-tree locality); no DB-side default, no uuid-ossp.
export const generateUuid = (): string => uuidv7();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// * Reject malformed ids before they reach a uuid-typed column, where Postgres raises 22P02 instead of matching no row.
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
