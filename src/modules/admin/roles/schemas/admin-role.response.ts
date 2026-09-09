import { z } from 'zod';

export const adminRoleResponseSchema = z.object({
  id: z.uuid().describe('Role id').meta({ example: '01923a45-b6c7-78d9-8a1b-2c3d4e5f6789' }),
  name: z.string().describe('Role name').meta({ example: 'support' }),
  description: z.string().nullable().describe('What the role is for').meta({ example: 'Read-only support access' }),
  is_system: z
    .boolean()
    .describe('System roles are maintained by the application and cannot be edited or deleted')
    .meta({ example: false }),
  permissions: z
    .array(z.string())
    .describe('Permissions granted by this role')
    .meta({ example: ['users:read'] }),
});

export const adminPermissionResponseSchema = z.object({
  name: z.string().describe('Permission name').meta({ example: 'users:read' }),
  description: z.string().describe('What the permission allows').meta({ example: 'List and view user accounts.' }),
});

export type AdminRoleResponse = z.infer<typeof adminRoleResponseSchema>;
export type AdminPermissionResponse = z.infer<typeof adminPermissionResponseSchema>;
