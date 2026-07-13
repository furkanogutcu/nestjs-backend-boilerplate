import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const linkPlayGamesSchema = z
  .object({
    server_auth_code: z
      .string()
      .min(1)
      .max(2048)
      .describe('One-time server auth code from Play Games requestServerSideAccess')
      .meta({ example: '4/0AeanS0aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcdef' }),
    refresh_token: z
      .string()
      .min(1)
      .max(512)
      .describe('Current refresh token, sent as step-up proof of possession')
      .meta({ example: '01923a46-fedc-7000-9a8b-7c6d5e4f3a2b.MmFkN2YxYzg5YTRiNGUwZWIxN2RjZDhmOTRlNjEyNzAwMTkyM2E0Ng' }),
  })
  .strict();

export class LinkPlayGamesRequest extends createZodDto(linkPlayGamesSchema) {}
