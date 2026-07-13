import { z } from 'zod';

import { tokenPairResponseSchema } from './token-pair.response';

export const guestResponseSchema = tokenPairResponseSchema.extend({
  user: z
    .object({
      id: z.uuid().describe('User id').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
      is_anonymous: z.boolean().describe('Whether the user is an unlinked guest').meta({ example: true }),
    })
    .describe('Authenticated user summary'),
});

export type GuestResponse = z.infer<typeof guestResponseSchema>;
