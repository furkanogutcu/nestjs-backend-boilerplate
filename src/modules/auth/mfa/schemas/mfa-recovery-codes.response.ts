import { z } from 'zod';

export const mfaRecoveryCodesResponseSchema = z.object({
  recovery_codes: z
    .array(z.string())
    .describe('Single-use recovery codes. Returned only once, at confirmation; store them now.')
    .meta({ example: ['3f2a1b4c5d', '9e8d7c6b5a'] }),
});

export type MfaRecoveryCodesResponse = z.infer<typeof mfaRecoveryCodesResponseSchema>;
