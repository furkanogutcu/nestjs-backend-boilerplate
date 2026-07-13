import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const linkAppleSchema = z
  .object({
    id_token: z
      .string()
      .min(1)
      .max(4096)
      .describe('Apple ID token obtained from the native Sign in with Apple flow')
      .meta({
        example:
          'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFwLTEifQ.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwic3ViIjoiMDAxNDU2LjdhMmI4YzlkMGUxZjJhM2I0YzVkNmU3ZjhhOWIwYzFkLjEyMzQiLCJhdWQiOiJpby51Z3AuYXBwIiwiaWF0IjoxNzE3MDAwMDAwLCJleHAiOjE3MTcwMDM2MDB9.signature',
      }),
    refresh_token: z
      .string()
      .min(1)
      .max(512)
      .describe('Current refresh token, sent as step-up proof of possession')
      .meta({ example: '01923a46-fedc-7000-9a8b-7c6d5e4f3a2b.MmFkN2YxYzg5YTRiNGUwZWIxN2RjZDhmOTRlNjEyNzAwMTkyM2E0Ng' }),
    name: z
      .string()
      .max(256)
      .optional()
      .describe('Display name from the first Apple authorization (untrusted; Apple omits it from the ID token)')
      .meta({ example: 'Nova' }),
  })
  .strict();

export class LinkAppleRequest extends createZodDto(linkAppleSchema) {}
