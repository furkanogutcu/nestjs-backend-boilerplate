import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const suspendUserRequestSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .optional()
      .describe('Why the account is being suspended; stored on the audit record.')
      .meta({ example: 'Abuse report #1234' }),
  })
  .strict();

export class SuspendUserRequest extends createZodDto(suspendUserRequestSchema) {}

export const assignRoleRequestSchema = z
  .object({
    role_id: z.uuid().describe('Role to grant').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
  })
  .strict();

export class AssignRoleRequest extends createZodDto(assignRoleRequestSchema) {}
