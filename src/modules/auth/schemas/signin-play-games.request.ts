import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const signinPlayGamesSchema = z
  .object({
    server_auth_code: z
      .string()
      .min(1)
      .max(2048)
      .describe('One-time server auth code from Play Games requestServerSideAccess')
      .meta({ example: '4/0AeanS0aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcdef' }),
  })
  .strict();

export class SigninPlayGamesRequest extends createZodDto(signinPlayGamesSchema) {}
