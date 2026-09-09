import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const roleNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[a-z][a-z0-9-]*$/, 'must be lowercase letters, digits and dashes')
  .describe('Role name')
  .meta({ example: 'support' });

export const createRoleRequestSchema = z
  .object({
    name: roleNameSchema,
    description: z.string().trim().max(255).optional().describe('What the role is for'),
    permissions: z.array(z.string()).default([]).describe('Permissions to grant'),
  })
  .strict();

export class CreateRoleRequest extends createZodDto(createRoleRequestSchema) {}

export const updateRoleRequestSchema = z
  .object({
    name: roleNameSchema.optional(),
    description: z.string().trim().max(255).nullable().optional().describe('What the role is for'),
    permissions: z.array(z.string()).optional().describe('Replaces the current permission set when supplied'),
  })
  .strict();

export class UpdateRoleRequest extends createZodDto(updateRoleRequestSchema) {}
