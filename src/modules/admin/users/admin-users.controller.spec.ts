import { createMock, DeepMocked } from '@golevelup/ts-vitest';

import { PaginationType } from '@shared/enums/pagination-type.enum';
import { IOffsetPaginationMeta, OffsetPaginated } from '@shared/responses/offset-paginated.response';

import { User } from '../../auth/entities/user.entity';
import { Role } from '../../auth/rbac/entities/role.entity';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './services/admin-users.service';

const actor = { id: 'admin-1' };

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    email: 'user@example.com',
    displayName: 'Nova',
    isAnonymous: false,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    suspendedAt: null,
    mustChangePassword: false,
    lastSeenAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as User;
}

describe('AdminUsersController', () => {
  let adminUsersService: DeepMocked<AdminUsersService>;
  let controller: AdminUsersController;

  beforeEach(() => {
    adminUsersService = createMock<AdminUsersService>();
    controller = new AdminUsersController(adminUsersService);
  });

  describe('list', () => {
    const meta: IOffsetPaginationMeta = {
      pagination: { type: PaginationType.Offset, page: 1, page_size: 10, total_count: 1, total_pages: 1 },
    };

    it('maps users to the wire format and keeps the pagination meta', async () => {
      adminUsersService.list.mockResolvedValue(new OffsetPaginated([buildUser()], meta));

      const result = await controller.list({ skip: 0, take: 10 }, undefined);

      expect(result.meta).toBe(meta);
      expect(result.items[0]).toEqual({
        id: 'u1',
        email: 'user@example.com',
        display_name: 'Nova',
        is_anonymous: false,
        is_email_verified: true,
        suspended_at: null,
        created_at: '2026-01-01T00:00:00.000Z',
      });
    });

    it('passes the suspension filter through only when it is supplied', async () => {
      adminUsersService.list.mockResolvedValue(new OffsetPaginated([], meta));

      await controller.list({ skip: 0, take: 10 }, undefined);
      expect(adminUsersService.list).toHaveBeenLastCalledWith(expect.objectContaining({ suspended: undefined }));

      await controller.list({ skip: 0, take: 10 }, undefined, 'true');
      expect(adminUsersService.list).toHaveBeenLastCalledWith(expect.objectContaining({ suspended: true }));

      await controller.list({ skip: 0, take: 10 }, undefined, 'false');
      expect(adminUsersService.list).toHaveBeenLastCalledWith(expect.objectContaining({ suspended: false }));
    });
  });

  describe('get', () => {
    it('returns the user with roles and the operator-facing flags', async () => {
      adminUsersService.get.mockResolvedValue({
        user: buildUser({ suspendedAt: new Date('2026-02-01T00:00:00.000Z'), mustChangePassword: true }),
        roles: [{ id: 'r1', name: 'support' } as Role],
      });

      await expect(controller.get('u1')).resolves.toMatchObject({
        suspended_at: '2026-02-01T00:00:00.000Z',
        must_change_password: true,
        roles: [{ id: 'r1', name: 'support' }],
      });
    });
  });

  describe('mutations', () => {
    it('suspends with the acting operator and reason', async () => {
      await controller.suspend('u1', { reason: 'abuse' }, actor);

      expect(adminUsersService.suspend).toHaveBeenCalledWith({
        userId: 'u1',
        actorUserId: 'admin-1',
        reason: 'abuse',
      });
    });

    it('restores', async () => {
      await controller.restore('u1', actor);

      expect(adminUsersService.restore).toHaveBeenCalledWith({ userId: 'u1', actorUserId: 'admin-1' });
    });

    it('revokes sessions', async () => {
      await controller.revokeSessions('u1', actor);

      expect(adminUsersService.revokeSessions).toHaveBeenCalledWith({ userId: 'u1', actorUserId: 'admin-1' });
    });

    it('grants a role', async () => {
      await controller.assignRole('u1', { role_id: 'r1' }, actor);

      expect(adminUsersService.assignRole).toHaveBeenCalledWith({
        userId: 'u1',
        roleId: 'r1',
        actorUserId: 'admin-1',
      });
    });

    it('revokes a role', async () => {
      await controller.revokeRole('u1', 'r1', actor);

      expect(adminUsersService.revokeRole).toHaveBeenCalledWith({
        userId: 'u1',
        roleId: 'r1',
        actorUserId: 'admin-1',
      });
    });
  });
});
