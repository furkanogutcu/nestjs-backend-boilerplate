import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { emailSchema, passwordSchema } from './credential-fields';

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    // * Sent on the retry after a 401 with code `mfa_required`; absent on the first attempt.
    mfa_code: z.string().trim().min(6).max(32).optional().describe('TOTP or recovery code, when MFA is enabled.'),
  })
  .strict();

export class LoginRequest extends createZodDto(loginRequestSchema) {}
