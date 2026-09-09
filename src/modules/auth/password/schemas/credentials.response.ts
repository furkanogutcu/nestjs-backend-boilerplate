import { z } from 'zod';

import { tokenPairResponseSchema } from '../../schemas/token-pair.response';

export const credentialsResponseSchema = tokenPairResponseSchema.extend({
  user: z
    .object({
      id: z.uuid().describe('User id').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
      email: z.email().nullable().describe('Account email').meta({ example: 'user@example.com' }),
      is_email_verified: z
        .boolean()
        .describe('Whether the email has been verified via the emailed link')
        .meta({ example: false }),
      is_anonymous: z.boolean().describe('Whether the user is an unlinked guest').meta({ example: false }),
      must_change_password: z
        .boolean()
        .describe(
          'Set when the account was issued a temporary password; the client must send the user to a change-password flow.',
        )
        .meta({ example: false }),
    })
    .describe('Authenticated user summary'),
});

export type CredentialsResponse = z.infer<typeof credentialsResponseSchema>;
