import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const adminFeatureFlagResponseSchema = z.object({
  key: z.string().describe('Flag key referenced by @RequireFeature').meta({ example: 'new-checkout' }),
  enabled: z.boolean().describe('Whether the flag is on').meta({ example: false }),
  description: z.string().nullable().describe('What the flag gates').meta({ example: 'New checkout flow' }),
  updated_at: z.string().describe('When the flag last changed').meta({ example: '2026-01-01T00:00:00.000Z' }),
});

export type AdminFeatureFlagResponse = z.infer<typeof adminFeatureFlagResponseSchema>;

export const upsertFeatureFlagRequestSchema = z
  .object({
    enabled: z.boolean().describe('Whether the flag is on'),
    description: z.string().trim().max(255).nullable().optional().describe('What the flag gates'),
  })
  .strict();

export class UpsertFeatureFlagRequest extends createZodDto(upsertFeatureFlagRequestSchema) {}
