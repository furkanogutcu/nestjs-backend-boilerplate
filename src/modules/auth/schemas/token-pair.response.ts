import { z } from 'zod';

export const tokenPairResponseSchema = z.object({
  access_token: z.string().describe('Short-lived JWT access token').meta({
    example:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMTkyM2E0NS1iNmM3LTc4ZDktMGExYi0yYzNkNGU1ZjY3ODkiLCJzaWQiOiIwMTkyM2E0Ni1mZWRjLTcwMDAtOWE4Yi03YzZkNWU0ZjNhMmIiLCJpYXQiOjE3MTcwMDAwMDAsImV4cCI6MTcxNzAwMDkwMH0.Kq2v9Zt7t0n0Q4j7N4o3yB1xWcF8m6lQpYx0t3rZ8aU',
  }),
  // * Omitted for web clients — they receive it as an HttpOnly cookie instead.
  refresh_token: z
    .string()
    .optional()
    .describe('Long-lived refresh token (mobile only; web receives it as an HttpOnly cookie)')
    .meta({ example: '01923a46-fedc-7000-9a8b-7c6d5e4f3a2b.MmFkN2YxYzg5YTRiNGUwZWIxN2RjZDhmOTRlNjEyNzAwMTkyM2E0Ng' }),
  token_type: z.string().describe('Token type to use in the Authorization header (Bearer)').meta({ example: 'Bearer' }),
  expires_in: z.number().int().describe('Access token lifetime in seconds').meta({ example: 900 }),
});

export type TokenPairResponse = z.infer<typeof tokenPairResponseSchema>;
