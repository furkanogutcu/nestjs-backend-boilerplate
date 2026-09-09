import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { CacheService } from '@infrastructure/cache/cache.service';
import { CacheKey } from '@shared/utils/cache-key.util';

import { Permission } from '../permission.enum';
import { USER_PERMISSIONS_CACHE_TTL_SECONDS } from '../rbac.constant';

@Injectable()
export class UserPermissionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
  ) {}

  async forUser({ userId }: { userId: string }): Promise<Set<Permission>> {
    const cached = await this.cacheService.get<string[]>({ key: this.key(userId) });

    if (cached) {
      return new Set(cached as Permission[]);
    }

    const granted = await this.load(userId);

    await this.cacheService.set({
      key: this.key(userId),
      data: granted,
      ttl: USER_PERMISSIONS_CACHE_TTL_SECONDS,
    });

    return new Set(granted);
  }

  // * Called whenever a user's roles change, or a role's permissions do — otherwise a revoked grant would keep
  // * working for up to the cache TTL.
  async invalidate({ userId }: { userId: string }): Promise<void> {
    await this.cacheService.delete({ key: this.key(userId) });
  }

  private async load(userId: string): Promise<Permission[]> {
    // * Retired permissions are filtered out here rather than at grant time, so a permission that leaves the
    // * code stops being honoured immediately without rewriting anybody's roles.
    const rows = await this.dataSource.query<{ permission_name: Permission }[]>(
      `SELECT DISTINCT rp.permission_name
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.name = rp.permission_name AND p.retired_at IS NULL
        WHERE ur.user_id = $1`,
      [userId],
    );

    return rows.map((row) => row.permission_name);
  }

  private key(userId: string): string {
    return CacheKey.join('user-permissions', userId);
  }
}
