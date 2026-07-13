import './extensions/all-repositories.extension';

import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Column, DataSource, Entity, PrimaryGeneratedColumn, Repository } from 'typeorm';

import { DatabaseService } from '@infrastructure/database/database.service';
import { decodeCursor } from '@shared/utils/cursor.util';

@Entity()
class Widget {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ type: 'timestamptz', nullable: true, name: 'created_at' })
  createdAt!: Date | null;
}

describe('Database (integration)', () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    dataSource = new DataSource({
      type: 'postgres',
      url: container.getConnectionUri(),
      entities: [Widget],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await container.stop();
  });

  afterEach(async () => {
    await dataSource.getRepository(Widget).clear();
  });

  describe('DatabaseService.runInTransaction', () => {
    it('commits when the handler resolves', async () => {
      const service = new DatabaseService(dataSource);

      await service.runInTransaction(async (manager) => await manager.getRepository(Widget).save({ name: 'a' }));

      expect(await dataSource.getRepository(Widget).count()).toBe(1);
    });

    it('rolls back when the handler throws', async () => {
      const service = new DatabaseService(dataSource);

      await expect(
        service.runInTransaction(async (manager) => {
          await manager.getRepository(Widget).save({ name: 'b' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');

      expect(await dataSource.getRepository(Widget).count()).toBe(0);
    });
  });

  describe('Repository.listWithOffsetPagination', () => {
    it('paginates real rows and computes meta', async () => {
      const repo = dataSource.getRepository(Widget);
      await repo.save([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);

      const result = await repo.listWithOffsetPagination({ skip: 0, take: 2, order: { id: 'ASC' } });

      expect(result.items).toHaveLength(2);
      expect(result.meta.pagination).toEqual({ type: 'offset', page: 1, page_size: 2, total_count: 3, total_pages: 2 });
    });
  });

  describe('Repository.listWithCursorPagination', () => {
    async function collectAllPages({
      repo,
      pageSize,
      order,
    }: {
      repo: Repository<Widget>;
      pageSize: number;
      order?: Parameters<Repository<Widget>['listWithCursorPagination']>[0]['order'];
    }): Promise<Widget[]> {
      const collected: Widget[] = [];
      let cursor = undefined as ReturnType<typeof decodeCursor> | undefined;
      let guard = 0;

      for (;;) {
        if (guard++ > 10_000) throw new Error('cursor pagination did not terminate');

        const page = await repo.listWithCursorPagination({ take: pageSize, cursor: cursor ?? undefined, order });
        collected.push(...page.items);

        if (!page.meta.pagination.has_next) {
          expect(page.meta.pagination.next_cursor).toBeNull();
          break;
        }

        cursor = decodeCursor(page.meta.pagination.next_cursor as string);
      }

      return collected;
    }

    it('walks forward through every row by id without gaps or duplicates', async () => {
      const repo = dataSource.getRepository(Widget);
      await repo.save([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }]);

      const all = await collectAllPages({ repo, pageSize: 2, order: { id: 'ASC' } });

      expect(all.map((row) => row.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('uses the id tiebreaker so duplicate sort values are never skipped or repeated', async () => {
      const repo = dataSource.getRepository(Widget);
      const saved = await repo.save([{ name: 'dup' }, { name: 'dup' }, { name: 'dup' }, { name: 'dup' }]);
      const expectedIds = saved.map((row) => row.id);

      const all = await collectAllPages({ repo, pageSize: 1, order: { name: 'ASC' } });
      const ids = all.map((row) => row.id);

      expect(new Set(ids).size).toBe(4);
      expect(ids).toEqual(expectedIds);
    });

    it('walks forward in descending order', async () => {
      const repo = dataSource.getRepository(Widget);
      await repo.save([{ name: 'a' }, { name: 'b' }, { name: 'c' }]);

      const all = await collectAllPages({ repo, pageSize: 2, order: { id: 'DESC' } });

      expect(all.map((row) => row.name)).toEqual(['c', 'b', 'a']);
    });

    it('combines a where filter with the keyset predicate', async () => {
      const repo = dataSource.getRepository(Widget);
      await repo.save([{ name: 'keep' }, { name: 'drop' }, { name: 'keep' }, { name: 'drop' }, { name: 'keep' }]);

      const first = await repo.listWithCursorPagination({ take: 2, order: { id: 'ASC' }, where: { name: 'keep' } });
      expect(first.items.map((row) => row.name)).toEqual(['keep', 'keep']);
      expect(first.meta.pagination.has_next).toBe(true);

      const second = await repo.listWithCursorPagination({
        take: 2,
        order: { id: 'ASC' },
        where: { name: 'keep' },
        cursor: decodeCursor(first.meta.pagination.next_cursor as string) ?? undefined,
      });

      expect(second.items.map((row) => row.name)).toEqual(['keep']);
      expect(second.meta.pagination.has_next).toBe(false);
      expect(second.meta.pagination.next_cursor).toBeNull();
    });

    it('preserves sub-millisecond ordering across pages when rows share a millisecond', async () => {
      const repo = dataSource.getRepository(Widget);
      const table = repo.metadata.tableName;
      const column = repo.metadata.findColumnWithPropertyName('createdAt')!.databaseName;
      const millis = '2026-01-02 03:04:05.123';
      const micros = ['001', '002', '003', '004'];

      for (const [index, us] of micros.entries()) {
        await dataSource.query(`INSERT INTO "${table}" (name, "${column}") VALUES ($1, $2::timestamptz)`, [
          `w${index + 1}`,
          `${millis}${us}+00`,
        ]);
      }

      const ascending = await collectAllPages({ repo, pageSize: 1, order: { createdAt: 'ASC' } });
      expect(ascending.map((row) => row.name)).toEqual(['w1', 'w2', 'w3', 'w4']);

      const descending = await collectAllPages({ repo, pageSize: 1, order: { createdAt: 'DESC' } });
      expect(descending.map((row) => row.name)).toEqual(['w4', 'w3', 'w2', 'w1']);
    });

    it('reports has_next false and a null cursor when the page is the last one', async () => {
      const repo = dataSource.getRepository(Widget);
      await repo.save([{ name: 'a' }, { name: 'b' }]);

      const result = await repo.listWithCursorPagination({ take: 5, order: { id: 'ASC' } });

      expect(result.items).toHaveLength(2);
      expect(result.meta.pagination).toEqual({ type: 'cursor', page_size: 5, next_cursor: null, has_next: false });
    });
  });
});
