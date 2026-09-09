import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { DataSource, EntityManager, ObjectLiteral, Repository } from 'typeorm';

import { InitSchema1783851505565 } from '@database/migrations/1783851505565-init-schema';

// * The schema migrations an integration test's throwaway Postgres runs, listed once here so a new migration is
// * added in one place instead of in every spec. The extension migration (InitExtensions) is deliberately left
// * out: it creates the timescaledb extension, which the plain postgres:16-alpine test container does not ship.
// * Once the schema first needs a hypertable the test container moves to a timescaledb image and this list can
// * become the migration-directory glob the app data source already uses.
export const SCHEMA_MIGRATIONS = [InitSchema1783851505565];

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
