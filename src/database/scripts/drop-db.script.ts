import { withAdminConnection } from '../utils/admin-connection.util';

void withAdminConnection(async ({ connection, database }) => {
  console.info(`Dropping database "${database}"...`);
  await connection.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  console.info(`Database "${database}" dropped.`);
}).catch((error) => {
  console.error('Database drop failed:', error);
  process.exit(1);
});
