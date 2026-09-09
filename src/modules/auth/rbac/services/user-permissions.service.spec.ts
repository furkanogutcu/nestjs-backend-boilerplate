import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { DataSource } from 'typeorm';

import { CacheService } from '@infrastructure/cache/cache.service';

import { Permission } from '../permission.enum';
import { UserPermissionsService } from './user-permissions.service';

describe('UserPermissionsService', () => {
  let dataSource: DeepMocked<DataSource>;
  let cacheService: DeepMocked<CacheService>;
  let service: UserPermissionsService;

  beforeEach(() => {
    dataSource = createMock<DataSource>();
    cacheService = createMock<CacheService>();
    service = new UserPermissionsService(dataSource, cacheService);
  });

  it('returns the cached set without querying the database', async () => {
    cacheService.get.mockResolvedValue([Permission.UsersRead]);

    await expect(service.forUser({ userId: 'user-1' })).resolves.toEqual(new Set([Permission.UsersRead]));
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('loads from the database on a cache miss and caches the result', async () => {
    cacheService.get.mockResolvedValue(null);
    dataSource.query.mockResolvedValue([
      { permission_name: Permission.UsersRead },
      { permission_name: Permission.RolesRead },
    ]);

    await expect(service.forUser({ userId: 'user-1' })).resolves.toEqual(
      new Set([Permission.UsersRead, Permission.RolesRead]),
    );
    expect(cacheService.set).toHaveBeenCalledWith(
      expect.objectContaining({ data: [Permission.UsersRead, Permission.RolesRead] }),
    );
  });

  it('excludes retired permissions in the query it runs', async () => {
    cacheService.get.mockResolvedValue(null);
    dataSource.query.mockResolvedValue([]);

    await service.forUser({ userId: 'user-1' });

    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('retired_at IS NULL'), ['user-1']);
  });

  it('returns an empty set for a user with no roles', async () => {
    cacheService.get.mockResolvedValue(null);
    dataSource.query.mockResolvedValue([]);

    await expect(service.forUser({ userId: 'user-1' })).resolves.toEqual(new Set());
  });

  it('drops the cached set on invalidate', async () => {
    await service.invalidate({ userId: 'user-1' });

    expect(cacheService.delete).toHaveBeenCalledWith({ key: expect.stringContaining('user-1') });
  });
});
