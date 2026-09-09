import { z } from 'zod';

export const mfaEnrolmentResponseSchema = z.object({
  secret: z
    .string()
    .describe('Base32 TOTP secret. Shown once — the client must let the user store it before confirming.')
    .meta({ example: 'JBSWY3DPEHPK3PXP' }),
  otpauth_uri: z
    .string()
    .describe('otpauth:// URI to render as a QR code for an authenticator app.')
    .meta({ example: 'otpauth://totp/App:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=App' }),
});

export type MfaEnrolmentResponse = z.infer<typeof mfaEnrolmentResponseSchema>;
