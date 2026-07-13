import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import pluralize from 'pluralize';
import { getMetadataArgsStorage } from 'typeorm';

// * Guard: every DB table name must be plural snake_case so no singular table is ever created.
// Mirrors the `local/entity-table-name-plural` ESLint rule but asserts the resolved TypeORM
// metadata name (also covering entities that omit the explicit @Entity('...') argument).
describe('database table naming', () => {
  const srcDir = join(__dirname, '..');

  const entityFiles = readdirSync(srcDir, { recursive: true })
    .map((entry) => entry.toString())
    .filter((file) => file.endsWith('.entity.ts'));

  beforeAll(() => {
    for (const file of entityFiles) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require(join(srcDir, file));
    }
  });

  it('discovers the entity files', () => {
    expect(entityFiles.length).toBeGreaterThan(0);
  });

  it('names every table with a plural last word', () => {
    const tableNames = getMetadataArgsStorage()
      .tables.map((table) => table.name)
      .filter((name): name is string => typeof name === 'string');

    const singular = tableNames.filter((name) => !pluralize.isPlural(name.split('_').pop()!));

    expect(singular).toEqual([]);
  });
});
