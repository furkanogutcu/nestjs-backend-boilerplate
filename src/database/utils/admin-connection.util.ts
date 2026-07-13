import { parse } from 'pg-connection-string';
import { DataSource, DataSourceOptions } from 'typeorm';

import { migrationDataSource } from '../typeorm.data-source';

interface IAdminConnectionContext {
  connection: DataSource;
  database: string;
}

export async function withAdminConnection(run: (context: IAdminConnectionContext) => Promise<void>): Promise<void> {
  const url = (migrationDataSource.options as { url?: string }).url;

  if (!url) {
    throw new Error('DATABASE_URL is not configured');
  }

  const { database, password, user, port, host } = parse(url);

  if (!database) {
    throw new Error('Could not determine the database name from DATABASE_URL');
  }

  const connection = new DataSource({
    type: migrationDataSource.options.type,
    host,
    port: port ? Number(port) : undefined,
    username: user,
    password,
    database: 'postgres',
  } as DataSourceOptions);

  await connection.initialize();

  try {
    await run({ connection, database });
  } finally {
    await connection.destroy();
  }
}
