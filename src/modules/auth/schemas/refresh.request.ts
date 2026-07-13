import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const refreshRequestSchema = z
  .object({
    // * Optional: mobile clients send the token here; web clients send it as the refresh cookie (with a CSRF
    // * header) and omit the body field.
    refresh_token: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe('The refresh token issued to this device (mobile only; web uses the refresh cookie)')
      .meta({ example: '01923a46-fedc-7000-9a8b-7c6d5e4f3a2b.MmFkN2YxYzg5YTRiNGUwZWIxN2RjZDhmOTRlNjEyNzAwMTkyM2E0Ng' }),
  })
  .strict();

export class RefreshRequest extends createZodDto(refreshRequestSchema) {}
