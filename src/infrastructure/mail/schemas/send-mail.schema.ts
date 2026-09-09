import { z } from 'zod';

export const sendMailSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  template: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
  // * Bypasses the suppression list, so a bounce can never lock someone out of account recovery.
  securityCritical: z.boolean().optional(),
});

export type ISendMailParams = z.infer<typeof sendMailSchema>;
