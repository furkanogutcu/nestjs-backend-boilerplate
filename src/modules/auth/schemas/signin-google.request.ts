import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const signinGoogleSchema = z
  .object({
    id_token: z.string().min(1).max(4096).describe('Google ID token (minted with the /auth/signin/nonce nonce)').meta({
      example:
        'eyJhbGciOiJSUzI1NiIsImtpZCI6ImFiYzEyMyJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJzdWIiOiIxMTQ1MjcwMTQ3ODkwMTIzNDU2NzgiLCJlbWFpbCI6InBsYXllckBleGFtcGxlLmNvbSIsImF1ZCI6InVncC1jbGllbnQiLCJub25jZSI6Im5fOEt4Mm1RN3ZMM3BSOXRaMGFCMWNENGVGNWdINmpLIiwiaWF0IjoxNzE3MDAwMDAwLCJleHAiOjE3MTcwMDM2MDB9.signature',
    }),
  })
  .strict();

export class SigninGoogleRequest extends createZodDto(signinGoogleSchema) {}
