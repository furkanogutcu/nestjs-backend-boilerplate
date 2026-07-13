import { z } from 'zod';

export const nonceResponseSchema = z.object({
  nonce: z
    .string()
    .describe('Single-use nonce to pass to the provider sign-in flow')
    .meta({ example: 'n_8Kx2mQ7vL3pR9tZ0aB1cD4eF5gH6jK' }),
});

export type NonceResponse = z.infer<typeof nonceResponseSchema>;
