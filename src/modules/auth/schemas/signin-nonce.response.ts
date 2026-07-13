import { z } from 'zod';

import { nonceResponseSchema } from './nonce.response';

export const signinNonceResponseSchema = nonceResponseSchema.extend({
  expires_in: z.number().int().describe('Nonce lifetime in seconds').meta({ example: 300 }),
});

export type SigninNonceResponse = z.infer<typeof signinNonceResponseSchema>;
