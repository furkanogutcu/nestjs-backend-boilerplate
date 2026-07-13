import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const linkGoogleSchema = z
  .object({
    id_token: z.string().min(1).max(4096).describe('Google ID token obtained from the native sign-in SDK').meta({
      example:
        'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYzEyMyJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJzdWIiOiIxMTQ1MjcwMTQ3ODkwMTIzNDU2NzgiLCJlbWFpbCI6InBsYXllckBleGFtcGxlLmNvbSIsImF1ZCI6InVncC1jbGllbnQiLCJpYXQiOjE3MTcwMDAwMDAsImV4cCI6MTcxNzAwMzYwMH0.signature',
    }),
    refresh_token: z
      .string()
      .min(1)
      .max(512)
      .describe('Current refresh token, sent as step-up proof of possession')
      .meta({ example: '01923a46-fedc-7000-9a8b-7c6d5e4f3a2b.MmFkN2YxYzg5YTRiNGUwZWIxN2RjZDhmOTRlNjEyNzAwMTkyM2E0Ng' }),
  })
  .strict();

export class LinkGoogleRequest extends createZodDto(linkGoogleSchema) {}
