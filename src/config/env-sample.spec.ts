import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ENV_KEYS } from './env.schema';

const SAMPLE_PATH = resolve(process.cwd(), '.env.sample');

function sampleKeys(): string[] {
  return readFileSync(SAMPLE_PATH, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((key): key is string => key !== undefined);
}

describe('.env.sample', () => {
  it('documents every key the schema validates', () => {
    const undocumented = ENV_KEYS.filter((key) => !sampleKeys().includes(key));

    expect(undocumented).toEqual([]);
  });

  it('does not document a key the schema no longer validates', () => {
    const stale = sampleKeys().filter((key) => !ENV_KEYS.includes(key));

    expect(stale).toEqual([]);
  });

  it('lists each key exactly once', () => {
    const keys = sampleKeys();
    const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);

    expect(duplicated).toEqual([]);
  });
});
