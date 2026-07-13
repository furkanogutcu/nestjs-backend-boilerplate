import { createHash } from 'crypto';

// * Deterministic RFC-4122 UUID (version 8, custom) derived by name: the same name always yields the same id.
// * Used to make a money-writing insert idempotent at the DB level — re-running with the same idempotency key
// * derives the same primary key, so the duplicate insert collides and rolls the whole transaction back instead of
// * creating a second row and charging twice. Unlike the app's default UUIDv7 ids (time-ordered, non-deterministic),
// * this is intentionally content-addressed; that is the whole point of the guarantee.
export function deterministicUuid(name: string): string {
  const bytes = createHash('sha256').update(name).digest().subarray(0, 16);

  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
