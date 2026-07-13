import { z } from 'zod';

import { tokenPairResponseSchema } from './token-pair.response';
import { userResponseSchema } from './user.response';

export const signinResponseSchema = tokenPairResponseSchema.extend({
  user: userResponseSchema.describe('Authenticated user with linked providers'),
});

export type SigninResponse = z.infer<typeof signinResponseSchema>;
