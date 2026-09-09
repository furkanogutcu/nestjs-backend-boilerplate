import { parse } from 'pg-connection-string';
import { DataSource } from 'typeorm';

import { env } from '@config/env.config';

// ! Runs under MIGRATION_DATABASE_URL: the application role cannot delete audit rows, and must never be given that power.
async function run(): Promise<void> {
  const retentionDays = Number(readArgument('older-than-days') ?? env.AUDIT_RETENTION_DAYS);

  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    console.error('❌ --older-than-days must be a positive integer.');
    process.exit(1);
  }

  const url = env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;

  if (!parse(url).user) {
    console.error('❌ Could not determine the database role from the connection string.');
    process.exit(1);
  }

  const dataSource = new DataSource({ type: 'postgres', url });
  await dataSource.initialize();

  try {
    const result = (await dataSource.query(
      `DELETE FROM "audit_events" WHERE "created_at" < now() - ($1 || ' days')::interval`,
      [retentionDays],
    )) as unknown;
    const deleted = Array.isArray(result) ? (result[1] as number) : 0;

    console.log(`✅ Pruned ${deleted} audit event(s) older than ${retentionDays} day(s).`);
  } finally {
    await dataSource.destroy();
  }
}

function readArgument(name: string): string | undefined {
  const prefix = `--${name}=`;

  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

void run().catch((error) => {
  console.error('❌ Failed to prune audit events', error);
  process.exit(1);
});
