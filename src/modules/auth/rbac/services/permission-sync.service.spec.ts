import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { EntityManager } from 'typeorm';

import { ClockService } from '@infrastructure/clock/clock.service';
import { DatabaseService } from '@infrastructure/database/database.service';

import { PermissionRecord } from '../entities/permission.entity';
import { Role } from '../entities/role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Permission } from '../permission.enum';
import { SUPERUSER_ROLE_NAME } from '../rbac.constant';
import { PermissionSyncService } from './permission-sync.service';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('PermissionSyncService', () => {
  let databaseService: DeepMocked<DatabaseService>;
  let manager: DeepMocked<EntityManager>;
  let clock: DeepMocked<ClockService>;
  let service: PermissionSyncService;

  beforeEach(() => {
    manager = createMock<EntityManager>();
    databaseService = createMock<DatabaseService>();
    databaseService.runInTransaction.mockImplementation(
      async (handler: (em: EntityManager) => Promise<unknown>) => await handler(manager),
    );
    clock = createMock<ClockService>();
    clock.date.mockReturnValue(NOW);
    manager.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });
    manager.findOne.mockResolvedValue({ id: 'role-1', name: SUPERUSER_ROLE_NAME });
    manager.create.mockImplementation((_entity: unknown, data: unknown) => data as never);
    service = new PermissionSyncService(databaseService, clock);
  });

  it('projects every permission declared in code', async () => {
    await service.sync();

    const [entity, rows] = manager.upsert.mock.calls[0] as unknown as [unknown, { name: string }[]];
    expect(entity).toBe(PermissionRecord);
    expect(rows.map((row) => row.name).sort()).toEqual(Object.values(Permission).sort());
  });

  it('retires permissions that no longer exist in code', async () => {
    await service.sync();

    expect(manager.update).toHaveBeenCalledWith(PermissionRecord, expect.anything(), { retiredAt: NOW });
  });

  it('creates the superuser role when it is missing', async () => {
    manager.findOne.mockResolvedValue(null);

    await service.sync();

    expect(manager.insert).toHaveBeenCalledWith(
      Role,
      expect.objectContaining({ name: SUPERUSER_ROLE_NAME, isSystem: true }),
    );
  });

  it('does not recreate the superuser role when it already exists', async () => {
    await service.sync();

    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('grants every current permission to the superuser role', async () => {
    await service.sync();

    const grantCall = manager.upsert.mock.calls.find(([entity]) => entity === RolePermission);
    const rows = grantCall?.[1] as { roleId: string; permissionName: string }[];
    expect(rows.map((row) => row.permissionName).sort()).toEqual(Object.values(Permission).sort());
    expect(rows.every((row) => row.roleId === 'role-1')).toBe(true);
  });

  it('strips retired permissions from the superuser role', async () => {
    await service.sync();

    expect(manager.delete).toHaveBeenCalledWith(RolePermission, expect.objectContaining({ roleId: 'role-1' }));
  });

  it('runs the whole sync in one transaction', async () => {
    await service.sync();

    expect(databaseService.runInTransaction).toHaveBeenCalledTimes(1);
  });

  it('syncs on application bootstrap', async () => {
    await service.onApplicationBootstrap();

    expect(databaseService.runInTransaction).toHaveBeenCalledTimes(1);
  });
});
