import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { PermissionRecord } from '../../auth/rbac/entities/permission.entity';
import { Role } from '../../auth/rbac/entities/role.entity';
import { AdminRolesController } from './admin-roles.controller';
import { AdminRolesService } from './services/admin-roles.service';

const actor = { id: 'admin-1' };
const role = { id: 'r1', name: 'support', description: 'Support access', isSystem: false } as Role;

describe('AdminRolesController', () => {
  let adminRolesService: DeepMocked<AdminRolesService>;
  let controller: AdminRolesController;

  beforeEach(() => {
    adminRolesService = createMock<AdminRolesService>();
    controller = new AdminRolesController(adminRolesService);
  });

  it('maps permissions to the wire format', async () => {
    adminRolesService.listPermissions.mockResolvedValue([
      { name: 'users:read', description: 'List users.' } as PermissionRecord,
    ]);

    await expect(controller.listPermissions()).resolves.toEqual([{ name: 'users:read', description: 'List users.' }]);
  });

  it('maps roles with their permissions', async () => {
    adminRolesService.list.mockResolvedValue([{ role, permissions: ['users:read'] }]);

    await expect(controller.list()).resolves.toEqual([
      { id: 'r1', name: 'support', description: 'Support access', is_system: false, permissions: ['users:read'] },
    ]);
  });

  it('returns a single role', async () => {
    adminRolesService.get.mockResolvedValue({ role, permissions: [] });

    await expect(controller.get('r1')).resolves.toMatchObject({ id: 'r1', permissions: [] });
  });

  it('creates a role with the acting operator', async () => {
    adminRolesService.create.mockResolvedValue({ role, permissions: [] });

    await controller.create({ name: 'support', description: 'd', permissions: ['users:read'] }, actor);

    expect(adminRolesService.create).toHaveBeenCalledWith({
      name: 'support',
      description: 'd',
      permissions: ['users:read'],
      actorUserId: 'admin-1',
    });
  });

  it('updates a role', async () => {
    adminRolesService.update.mockResolvedValue({ role, permissions: [] });

    await controller.update('r1', { name: 'renamed' }, actor);

    expect(adminRolesService.update).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: 'r1', name: 'renamed', actorUserId: 'admin-1' }),
    );
  });

  it('deletes a role', async () => {
    await controller.remove('r1', actor);

    expect(adminRolesService.remove).toHaveBeenCalledWith({ roleId: 'r1', actorUserId: 'admin-1' });
  });
});
