import { z } from 'zod';

export const sendMailSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  template: z.string().min(1),
  context: z.record(z.string(), z.unknown()),
  // * Security-critical mail (verification, password reset) MUST reach the user, so MailService lets it bypass the
  // * suppression list. Carried on the job so the flag survives the queue hop. Defaults to non-critical.
  securityCritical: z.boolean().optional(),
});

export type ISendMailParams = z.infer<typeof sendMailSchema>;
