import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const linkGameCenterSchema = z
  .object({
    team_player_id: z
      .string()
      .min(1)
      .max(256)
      .describe('Game Center teamPlayerID returned by GameKit')
      .meta({ example: 'A:_a1b2c3d4e5f6789012345678' }),
    public_key_url: z
      .url()
      .max(2048)
      .describe('Apple public key certificate URL from the signature bundle')
      .meta({ example: 'https://static.gc.apple.com/public-key/gc-prod-9.cer' }),
    signature: z
      .string()
      .min(1)
      .max(4096)
      .describe('Base64 signature from fetchItems(forIdentityVerificationSignature:)')
      .meta({ example: 'MEUCIQDx7n0Q4j7N4o3yB1xWcF8m6lQpYx0t3rZ8aUKq2v9ZgIgT0n0...' }),
    salt: z
      .string()
      .min(1)
      .max(1024)
      .describe('Base64 salt from the signature bundle')
      .meta({ example: 'NDA4MjY3MWE=' }),
    timestamp: z
      .number()
      .int()
      .min(1)
      .describe('Signature timestamp in milliseconds since the Unix epoch')
      .meta({ example: 1717000000000 }),
    refresh_token: z
      .string()
      .min(1)
      .max(512)
      .describe('Current refresh token, sent as step-up proof of possession')
      .meta({ example: '01923a46-fedc-7000-9a8b-7c6d5e4f3a2b.MmFkN2YxYzg5YTRiNGUwZWIxN2RjZDhmOTRlNjEyNzAwMTkyM2E0Ng' }),
  })
  .strict();

export class LinkGameCenterRequest extends createZodDto(linkGameCenterSchema) {}
