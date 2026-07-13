import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const signinAppleSchema = z
  .object({
    id_token: z.string().min(1).max(4096).describe('Apple ID token (minted with the /auth/signin/nonce nonce)').meta({
      example:
        'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFwLTEifQ.eyJpc3MiOiJodHRwczovL2FwcGxlaWQuYXBwbGUuY29tIiwic3ViIjoiMDAxNDU2LjdhMmI4YzlkMGUxZjJhM2I0YzVkNmU3ZjhhOWIwYzFkLjEyMzQiLCJhdWQiOiJpby51Z3AuYXBwIiwibm9uY2UiOiJuXzhLeDJtUTd2TDNwUjl0WjBhQjFjRDRlRjVnSDZqSyIsImlhdCI6MTcxNzAwMDAwMCwiZXhwIjoxNzE3MDAzNjAwfQ.signature',
    }),
  })
  .strict();

export class SigninAppleRequest extends createZodDto(signinAppleSchema) {}
