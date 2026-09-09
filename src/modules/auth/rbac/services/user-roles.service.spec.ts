import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Repository } from 'typeorm';

import { UserRole } from '../entities/user-role.entity';
import { UserRolesService } from './user-roles.service';

describe('UserRolesService', () => {
  let userRoles: DeepMocked<Repository<UserRole>>;
  let service: UserRolesService;

  beforeEach(() => {
    userRoles = createMock<Repository<UserRole>>();
    service = new UserRolesService(userRoles);
  });

  it('reports a user with at least one role as administrative', async () => {
    userRoles.countBy.mockResolvedValue(1);

    await expect(service.hasAnyRole({ userId: 'user-1' })).resolves.toBe(true);
    expect(userRoles.countBy).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('reports a user with no roles as non-administrative', async () => {
    userRoles.countBy.mockResolvedValue(0);

    await expect(service.hasAnyRole({ userId: 'user-1' })).resolves.toBe(false);
  });
});
