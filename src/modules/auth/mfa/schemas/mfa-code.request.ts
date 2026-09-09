import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const mfaCodeRequestSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(6)
      .max(32)
      .describe('TOTP code from the authenticator app, or an unused recovery code.')
      .meta({ example: '123456' }),
  })
  .strict();

export class MfaCodeRequest extends createZodDto(mfaCodeRequestSchema) {}
