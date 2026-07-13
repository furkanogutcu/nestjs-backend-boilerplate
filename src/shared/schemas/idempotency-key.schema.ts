import { z } from 'zod';

// * Baseline key (authenticated): the principal isolates entries per caller, so a weak key can at most collide with the caller's own. Kept opaque; only whitespace/control chars are rejected.
export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  // * Printable ASCII only (0x21-0x7E): rejects whitespace/control chars, key stays opaque.
  .regex(/^[\x21-\x7E]+$/, 'must not contain whitespace or control characters');

// * Anonymous key (guest): the principal is the shared 'anonymous', so the key is the only isolation boundary — a colliding key could leak another client's token-bearing response. Require longer, high-entropy.
export const anonymousIdempotencyKeySchema = z
  .string()
  .min(24)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/, 'must be a high-entropy token (base64url, hex, or UUID)');
