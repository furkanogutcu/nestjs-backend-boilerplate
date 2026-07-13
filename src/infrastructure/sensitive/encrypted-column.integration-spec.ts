import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Column, DataSource, Entity, PrimaryGeneratedColumn } from 'typeorm';

import { EncryptedColumn } from './encrypted-column.decorator';

@Entity()
class Secret {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  label!: string;

  @EncryptedColumn({ aad: 'secret.value', nullable: true })
  value!: string | null;
}

describe('EncryptedColumn (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Secret],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  afterEach(async () => {
    await dataSource.getRepository(Secret).clear();
  });

  async function rawColumnValue(id: number): Promise<string | null> {
    const [row] = await dataSource.query<{ value: string | null }[]>('SELECT value FROM secret WHERE id = $1', [id]);

    return row.value;
  }

  it('stores the column as ciphertext at rest and returns plaintext on read', async () => {
    const repo = dataSource.getRepository(Secret);
    const saved = await repo.save({ label: 'a', value: 'user@example.com' });

    const raw = await rawColumnValue(saved.id);
    expect(raw).toMatch(/^v1:/);
    expect(raw).not.toContain('user@example.com');

    const loaded = await repo.findOneByOrFail({ id: saved.id });
    expect(loaded.value).toBe('user@example.com');
  });

  it('stores NULL rather than ciphertext for a null value and reads it back as null', async () => {
    const repo = dataSource.getRepository(Secret);
    const saved = await repo.save({ label: 'a', value: null });

    expect(await rawColumnValue(saved.id)).toBeNull();
    expect((await repo.findOneByOrFail({ id: saved.id })).value).toBeNull();
  });

  it('produces a different ciphertext for two rows holding the same plaintext (random IV)', async () => {
    const repo = dataSource.getRepository(Secret);
    const [a, b] = await repo.save([
      { label: 'a', value: 'same@example.com' },
      { label: 'b', value: 'same@example.com' },
    ]);

    expect(await rawColumnValue(a.id)).not.toBe(await rawColumnValue(b.id));
  });

  it('decrypts rows hydrated through the query builder', async () => {
    const repo = dataSource.getRepository(Secret);
    await repo.save({ label: 'a', value: 'qb@example.com' });

    const row = await repo.createQueryBuilder('s').where('s.label = :label', { label: 'a' }).getOneOrFail();

    expect(row.value).toBe('qb@example.com');
  });

  it('re-encrypts the column when the value is updated', async () => {
    const repo = dataSource.getRepository(Secret);
    const saved = await repo.save({ label: 'a', value: 'old@example.com' });
    const before = await rawColumnValue(saved.id);

    saved.value = 'new@example.com';
    await repo.save(saved);

    const after = await rawColumnValue(saved.id);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^v1:/);
    expect((await repo.findOneByOrFail({ id: saved.id })).value).toBe('new@example.com');
  });

  it('cannot find a row by its plaintext value (randomized encryption is not searchable)', async () => {
    const repo = dataSource.getRepository(Secret);
    await repo.save({ label: 'a', value: 'search@example.com' });

    expect(await repo.findBy({ value: 'search@example.com' })).toEqual([]);
  });
});
