import { z } from 'zod';

export const adminUserSummarySchema = z.object({
  id: z.uuid().describe('User id').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
  email: z.email().nullable().describe('Account email').meta({ example: 'user@example.com' }),
  display_name: z.string().nullable().describe('Display name').meta({ example: 'Captain Nova' }),
  is_anonymous: z.boolean().describe('Whether the user is an unlinked guest').meta({ example: false }),
  is_email_verified: z.boolean().describe('Whether the email has been verified').meta({ example: true }),
  suspended_at: z
    .string()
    .nullable()
    .describe('When the account was suspended, null when active')
    .meta({ example: null }),
  created_at: z.string().describe('When the account was created').meta({ example: '2026-01-01T00:00:00.000Z' }),
});

export const adminUserResponseSchema = adminUserSummarySchema.extend({
  must_change_password: z
    .boolean()
    .describe('Set when the account holds a temporary password issued by an operator')
    .meta({ example: false }),
  last_seen_at: z.string().nullable().describe('Last activity timestamp').meta({ example: null }),
  roles: z
    .array(
      z.object({
        id: z.uuid().describe('Role id'),
        name: z.string().describe('Role name').meta({ example: 'superuser' }),
      }),
    )
    .describe('Roles granted to this user'),
});

export type AdminUserSummary = z.infer<typeof adminUserSummarySchema>;
export type AdminUserResponse = z.infer<typeof adminUserResponseSchema>;
