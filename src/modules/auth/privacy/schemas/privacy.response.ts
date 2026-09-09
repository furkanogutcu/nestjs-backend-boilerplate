import { z } from 'zod';

export const accountDeletionStatusResponseSchema = z.object({
  requested_at: z
    .string()
    .nullable()
    .describe('When deletion was requested, null when no request is pending')
    .meta({ example: '2026-01-01T00:00:00.000Z' }),
  scheduled_for: z
    .string()
    .nullable()
    .describe('When the account will be erased if the request is not withdrawn')
    .meta({ example: '2026-01-31T00:00:00.000Z' }),
});

export type AccountDeletionStatusResponse = z.infer<typeof accountDeletionStatusResponseSchema>;

// * The export is a personal-data dump whose shape follows the account, not a stable API contract, so it is
// * described loosely on purpose — pinning every field here would make the schema a second place to maintain.
export const dataExportResponseSchema = z
  .object({
    exported_at: z.string().describe('When the export was produced'),
    account: z.record(z.string(), z.unknown()).describe('The account record'),
    sessions: z.array(z.record(z.string(), z.unknown())).describe('Sessions, without any token material'),
    linked_providers: z.array(z.record(z.string(), z.unknown())).describe('Linked OAuth providers'),
    roles: z.array(z.string()).describe('Roles granted to the account'),
    multi_factor: z
      .record(z.string(), z.unknown())
      .nullable()
      .describe('MFA state, without the secret or recovery codes'),
    security_events: z.array(z.record(z.string(), z.unknown())).describe('Security events recorded about the account'),
  })
  .describe('Everything the service holds about the authenticated person.');

export type DataExportResponse = z.infer<typeof dataExportResponseSchema>;
