import { z } from 'zod';

export const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[\x21-\x7E]+$/, 'must not contain whitespace or control characters');

// ! Guests share one principal, so the key is the only isolation boundary: a collision leaks another client's tokens.
export const anonymousIdempotencyKeySchema = z
  .string()
  .min(24)
  .max(128)
  .regex(/^[A-Za-z0-9._~-]+$/, 'must be a high-entropy token (base64url, hex, or UUID)');
