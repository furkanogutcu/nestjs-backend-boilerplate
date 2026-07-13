import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';

import { env } from '@config/env.config';

import { SnakeNamingStrategy } from './strategies/snake-naming.strategy';

const sharedOptions: DataSourceOptions = {
  type: 'postgres',
  ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
  entities: [
    join(__dirname, '../modules/**/entities/*.entity.{ts,js}'),
    join(__dirname, '../infrastructure/**/entities/*.entity.{ts,js}'),
  ],
  migrations: [join(__dirname, '../database/migrations/*.{ts,js}')],
  subscribers: [join(__dirname, '../modules/**/subscribers/*.subscriber.{ts,js}')],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  extra: {
    max: env.DB_POOL_MAX,
    connectionTimeoutMillis: env.DB_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: env.DB_IDLE_TIMEOUT_MS,
    statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
  },
};

// * Uses PgBouncer.
export const appDataSourceOptions: DataSourceOptions = {
  ...sharedOptions,
  url: env.DATABASE_URL,
};

// * Bypasses PgBouncer.
export const migrationDataSource = new DataSource({
  ...sharedOptions,
  url: env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL,
});
