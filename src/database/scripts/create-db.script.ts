import { withAdminConnection } from '../utils/admin-connection.util';

void withAdminConnection(async ({ connection, database }) => {
  const result = await connection.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);

  if (result.length === 0) {
    console.info(`Creating database "${database}"...`);
    await connection.query(`CREATE DATABASE "${database}"`);
  }

  console.info(`Database "${database}" is ready!`);
}).catch((error) => {
  console.error('Database not ready:', error);
  process.exit(1);
});
