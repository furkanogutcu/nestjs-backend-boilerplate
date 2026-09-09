import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';

import { AuditEvent } from './entities/audit-event.entity';

// * Proves the guarantee the audit table is built on: the application role can append and read, but cannot
// * rewrite or erase. The migration only applies the revoke when the application and migration roles differ, so
// * this suite creates that separation explicitly — a single-role setup cannot demonstrate it.
describe('audit_events append-only grant (integration)', () => {
  const APPLICATION_ROLE = 'app_runtime';
  const APPLICATION_PASSWORD = 'app_runtime_password';

  let container: StartedPostgreSqlContainer;
  let ownerDataSource: DataSource;
  let applicationDataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:17-alpine').start();

    ownerDataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [AuditEvent],
      synchronize: true,
    });
    await ownerDataSource.initialize();

    await ownerDataSource.query(`CREATE ROLE "${APPLICATION_ROLE}" LOGIN PASSWORD '${APPLICATION_PASSWORD}'`);
    await ownerDataSource.query(`GRANT USAGE ON SCHEMA public TO "${APPLICATION_ROLE}"`);
    await ownerDataSource.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_events" TO "${APPLICATION_ROLE}"`);
    // * The line the migration runs in production.
    await ownerDataSource.query(`REVOKE UPDATE, DELETE ON "audit_events" FROM "${APPLICATION_ROLE}"`);

    applicationDataSource = new DataSource({
      type: 'postgres',
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      username: APPLICATION_ROLE,
      password: APPLICATION_PASSWORD,
      entities: [AuditEvent],
    });
    await applicationDataSource.initialize();
  }, 120000);

  afterAll(async () => {
    await applicationDataSource?.destroy();
    await ownerDataSource?.destroy();
    await container?.stop();
  });

  async function seedEvent(id: string): Promise<void> {
    await ownerDataSource.query(`INSERT INTO "audit_events" ("id", "action") VALUES ($1, 'auth.login.succeeded')`, [
      id,
    ]);
  }

  it('lets the application role append an event', async () => {
    await expect(
      applicationDataSource.query(
        `INSERT INTO "audit_events" ("id", "action") VALUES (gen_random_uuid(), 'auth.login.succeeded')`,
      ),
    ).resolves.toBeDefined();
  });

  it('lets the application role read events', async () => {
    await expect(applicationDataSource.query(`SELECT count(*) FROM "audit_events"`)).resolves.toBeDefined();
  });

  it('refuses an UPDATE from the application role', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    await seedEvent(id);

    await expect(
      applicationDataSource.query(`UPDATE "audit_events" SET "action" = 'tampered' WHERE "id" = $1`, [id]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('refuses a DELETE from the application role', async () => {
    const id = '00000000-0000-4000-8000-000000000002';
    await seedEvent(id);

    await expect(applicationDataSource.query(`DELETE FROM "audit_events" WHERE "id" = $1`, [id])).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('refuses a TRUNCATE from the application role', async () => {
    await expect(applicationDataSource.query(`TRUNCATE "audit_events"`)).rejects.toThrow(
      /permission denied|must be owner/i,
    );
  });

  it('still lets the owning role prune old events', async () => {
    const id = '00000000-0000-4000-8000-000000000003';
    await seedEvent(id);

    await expect(ownerDataSource.query(`DELETE FROM "audit_events" WHERE "id" = $1`, [id])).resolves.toBeDefined();
  });
});
