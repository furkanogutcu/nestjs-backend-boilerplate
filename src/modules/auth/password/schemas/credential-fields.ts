import { z } from 'zod';

import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../constants/auth.constant';

// * Shared credential field schemas, so email/password/token validation is identical across register, login and
// * reset — one definition, no drift between the endpoints that must agree on what a valid credential is.

// * Lowercased on parse so lookups and the unique index treat User@x.com and user@x.com as one account.
export const emailSchema = z
  .email()
  .max(EMAIL_MAX_LENGTH)
  .transform((value) => value.toLowerCase())
  .describe('Email address')
  .meta({ example: 'user@example.com' });

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .describe(`Account password (${PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} characters)`)
  .meta({ example: 'correct-horse-battery-staple' });

// * The opaque single-use token delivered in a verification / reset email link.
export const opaqueTokenSchema = z
  .string()
  .min(1)
  .max(512)
  .describe('Single-use token from the email link')
  .meta({ example: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' });
