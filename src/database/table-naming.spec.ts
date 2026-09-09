import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pluralize from 'pluralize';
import { getMetadataArgsStorage } from 'typeorm';

// * Asserts the resolved TypeORM metadata name, so entities without an explicit @Entity('...') are covered too.
describe('database table naming', () => {
  const srcDir = resolve(process.cwd(), 'src');

  const entityFiles = readdirSync(srcDir, { recursive: true })
    .map((entry) => entry.toString())
    .filter((file) => file.endsWith('.entity.ts'));

  beforeAll(async () => {
    for (const file of entityFiles) {
      await import(join(srcDir, file));
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
