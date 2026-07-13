import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.uuid().describe('User id').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
  is_anonymous: z.boolean().describe('Whether the user is an unlinked guest').meta({ example: false }),
  display_name: z
    .string()
    .nullable()
    .describe('Display name (may be backfilled from a linked provider)')
    .meta({ example: 'Captain Nova' }),
  linked_providers: z
    .array(
      z.object({
        provider: z.string().describe('Linked OAuth provider').meta({ example: 'google' }),
        email: z
          .string()
          .nullable()
          .describe('Email associated with the linked provider, if verified')
          .meta({ example: 'user@example.com' }),
      }),
    )
    .describe('OAuth providers linked to this user')
    .meta({ example: [{ provider: 'google', email: 'user@example.com' }] }),
});

export type UserResponse = z.infer<typeof userResponseSchema>;
