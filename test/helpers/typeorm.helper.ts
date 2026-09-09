import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import { InitExtensions1779408000000 } from '@database/migrations/1779408000000-init-extensions';
import { InitSchema1783851505565 } from '@database/migrations/1783851505565-init-schema';
import { RbacAndMfa1788964220075 } from '@database/migrations/1788964220075-rbac-and-mfa';
import { AuditEvents1788966269650 } from '@database/migrations/1788966269650-audit-events';
import { FeatureFlags1788968844093 } from '@database/migrations/1788968844093-feature-flags';
import { AccountDeletion1788970880351 } from '@database/migrations/1788970880351-account-deletion';
import { Posts1788974169813 } from '@database/migrations/1788974169813-posts';

// * Every migration an integration test's throwaway Postgres runs, listed once here so a new migration is added
// * in one place instead of in every spec. Keep this in the same order as the migrations directory — running the
// * real extension migration here is what proves the schema boots on a stock Postgres image.
export const SCHEMA_MIGRATIONS = [
  InitExtensions1779408000000,
  InitSchema1783851505565,
  RbacAndMfa1788964220075,
  AuditEvents1788966269650,
  FeatureFlags1788968844093,
  AccountDeletion1788970880351,
  Posts1788974169813,
];

export function createMockRepository<T extends ObjectLiteral = ObjectLiteral>(): DeepMocked<Repository<T>> {
  return createMock<Repository<T>>();
}

export function createMockEntityManager(): DeepMocked<EntityManager> {
  return createMock<EntityManager>();
}

// * transaction(handler) runs the handler with the EntityManager; real commit/rollback is integration-tested.
export function createMockDataSource(manager: EntityManager = createMockEntityManager()): DeepMocked<DataSource> {
  const dataSource = createMock<DataSource>();

  dataSource.transaction.mockImplementation(async (handlerOrLevel: unknown, maybeHandler?: unknown) => {
    const handler = (typeof handlerOrLevel === 'function' ? handlerOrLevel : maybeHandler) as (
      em: EntityManager,
    ) => Promise<unknown>;

    return await handler(manager);
  });

  return dataSource;
}
