import './all-repositories.extension';

import { FindManyOptions, ObjectLiteral, Repository } from 'typeorm';

import { AppInternalException } from '@shared/exceptions/internal.exception';
import { CursorPaginated } from '@shared/responses/cursor-paginated.response';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';
import { decodeCursor } from '@shared/utils/cursor.util';

import type { ICursorPaginationOptions } from './all-repositories.extension';

type Row = { id: number };

async function listWithOffsetPagination({
  findAndCount,
  options,
}: {
  findAndCount: jest.Mock;
  options?: FindManyOptions<Row>;
}): Promise<OffsetPaginated<Row>> {
  const repoLike = { findAndCount } as unknown as Repository<ObjectLiteral>;

  return await (Repository.prototype.listWithOffsetPagination.call(repoLike, options) as Promise<OffsetPaginated<Row>>);
}

describe('Repository.listWithOffsetPagination', () => {
  it('returns a OffsetPaginated instance with computed meta', async () => {
    const findAndCount = jest.fn().mockResolvedValue([[{ id: 1 }], 25]);

    const result = await listWithOffsetPagination({ findAndCount, options: { skip: 0, take: 10 } });

    expect(result).toBeInstanceOf(OffsetPaginated);
    expect(result.items).toEqual([{ id: 1 }]);
    expect(result.meta.pagination).toEqual({ type: 'offset', page: 1, page_size: 10, total_count: 25, total_pages: 3 });
  });

  it('defaults skip to 0 when only take is provided', async () => {
    const findAndCount = jest.fn().mockResolvedValue([[{ id: 1 }], 25]);

    const result = await listWithOffsetPagination({ findAndCount, options: { take: 10 } });

    expect(result.meta.pagination).toEqual({ type: 'offset', page: 1, page_size: 10, total_count: 25, total_pages: 3 });
  });

  it('derives the current page from skip and take', async () => {
    const findAndCount = jest.fn().mockResolvedValue([[{ id: 21 }], 25]);

    const result = await listWithOffsetPagination({ findAndCount, options: { skip: 20, take: 10 } });

    expect(result.meta.pagination.page).toBe(3);
  });

  it('falls back to total as page_size when take is absent', async () => {
    const findAndCount = jest.fn().mockResolvedValue([[{ id: 1 }, { id: 2 }, { id: 3 }], 3]);

    const result = await listWithOffsetPagination({ findAndCount });

    expect(result.meta.pagination).toEqual({ type: 'offset', page: 1, page_size: 3, total_count: 3, total_pages: 1 });
  });

  it('reports zero pages when there are no items and no page size', async () => {
    const findAndCount = jest.fn().mockResolvedValue([[], 0]);

    const result = await listWithOffsetPagination({ findAndCount });

    expect(result.meta.pagination).toEqual({ type: 'offset', page: 1, page_size: 0, total_count: 0, total_pages: 0 });
  });
});

type CursorRow = { id: number; created_at?: Date };

type CursorRawRow = { __cursor_id_value: string; __cursor_sort_value: string };

function deriveRaw(rows: CursorRow[]): CursorRawRow[] {
  return rows.map((row) => ({
    __cursor_id_value: String(row.id),
    __cursor_sort_value: row.created_at ? row.created_at.toISOString() : String(row.id),
  }));
}

function createQueryBuilderStub({ rows, raw }: { rows: CursorRow[]; raw?: CursorRawRow[] }) {
  const queryBuilder = {
    setFindOptions: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getRawAndEntities: jest.fn().mockResolvedValue({ entities: rows, raw: raw ?? deriveRaw(rows) }),
  };

  return queryBuilder;
}

function createCursorRepo({
  rows,
  raw,
  knownColumns,
}: {
  rows: CursorRow[];
  raw?: CursorRawRow[];
  knownColumns?: string[];
}) {
  const queryBuilder = createQueryBuilderStub({ rows, raw });

  const repoLike = {
    metadata: {
      tableName: 'widget',
      findColumnWithPropertyName: (property: string) =>
        (knownColumns ?? ['id', 'created_at']).includes(property) ? { databaseName: property } : undefined,
    },
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
  } as unknown as Repository<ObjectLiteral>;

  return { repoLike, queryBuilder };
}

async function listWithCursorPagination({
  repoLike,
  options,
}: {
  repoLike: Repository<ObjectLiteral>;
  options: ICursorPaginationOptions<CursorRow>;
}): Promise<CursorPaginated<CursorRow>> {
  return (await Repository.prototype.listWithCursorPagination.call(repoLike, options)) as CursorPaginated<CursorRow>;
}

describe('Repository.listWithCursorPagination', () => {
  it('returns a CursorPaginated instance with has_next false when rows fit the page', async () => {
    const { repoLike, queryBuilder } = createCursorRepo({ rows: [{ id: 1 }, { id: 2 }] });

    const result = await listWithCursorPagination({ repoLike, options: { take: 5 } });

    expect(result).toBeInstanceOf(CursorPaginated);
    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.meta.pagination).toEqual({ type: 'cursor', page_size: 5, next_cursor: null, has_next: false });
    expect(queryBuilder.andWhere).not.toHaveBeenCalled();
    expect(queryBuilder.take).toHaveBeenCalledWith(6);
  });

  it('defaults the sort to the id tiebreaker in ascending order', async () => {
    const { repoLike, queryBuilder } = createCursorRepo({ rows: [{ id: 1 }] });

    await listWithCursorPagination({ repoLike, options: { take: 5 } });

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('widget.id', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('widget.id', 'ASC');
  });

  it('trims the extra row and emits a next_cursor when there is a following page', async () => {
    const { repoLike } = createCursorRepo({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });

    const result = await listWithCursorPagination({ repoLike, options: { take: 2, order: { id: 'ASC' } } });

    expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.meta.pagination.has_next).toBe(true);
    expect(decodeCursor(result.meta.pagination.next_cursor as string)).toEqual({
      field: 'id',
      value: '2',
      direction: 'asc',
      id: 2,
    });
  });

  it('builds a forward keyset predicate from the cursor in ascending order', async () => {
    const { repoLike, queryBuilder } = createCursorRepo({ rows: [{ id: 6 }] });

    await listWithCursorPagination({
      repoLike,
      options: { take: 5, order: { id: 'ASC' }, cursor: { field: 'id', value: 5, direction: 'asc', id: 5 } },
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('(widget.id, widget.id) > (:__cursorValue, :__cursorId)', {
      __cursorValue: 5,
      __cursorId: 5,
    });
  });

  it('uses the descending operator and order when sorting descending', async () => {
    const { repoLike, queryBuilder } = createCursorRepo({ rows: [{ id: 4 }] });

    await listWithCursorPagination({
      repoLike,
      options: { take: 5, order: { id: 'DESC' }, cursor: { field: 'id', value: 5, direction: 'desc', id: 5 } },
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(widget.id, widget.id) < (:__cursorValue, :__cursorId)',
      expect.anything(),
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('widget.id', 'DESC');
  });

  it('encodes the raw column text, not the ms-truncated hydrated Date, so sub-ms precision survives', async () => {
    const hydrated = new Date('2026-01-02T03:04:05.000Z');
    const firstMicros = '2026-01-02 03:04:05.123456+00';
    const { repoLike } = createCursorRepo({
      rows: [
        { id: 1, created_at: hydrated },
        { id: 2, created_at: hydrated },
      ],
      raw: [
        { __cursor_id_value: '1', __cursor_sort_value: firstMicros },
        { __cursor_id_value: '2', __cursor_sort_value: '2026-01-02 03:04:05.789012+00' },
      ],
    });

    const result = await listWithCursorPagination({ repoLike, options: { take: 1, order: { created_at: 'ASC' } } });

    expect(decodeCursor(result.meta.pagination.next_cursor as string)).toEqual({
      field: 'created_at',
      value: firstMicros,
      direction: 'asc',
      id: 1,
    });
  });

  it('resolves the cursor sort value by id when a join flattens raw beyond the entity set', async () => {
    const { repoLike } = createCursorRepo({
      rows: [{ id: 1 }, { id: 2 }],
      raw: [
        { __cursor_id_value: '2', __cursor_sort_value: 'B' },
        { __cursor_id_value: '2', __cursor_sort_value: 'B' },
        { __cursor_id_value: '1', __cursor_sort_value: 'A' },
        { __cursor_id_value: '1', __cursor_sort_value: 'A' },
      ],
    });

    const result = await listWithCursorPagination({ repoLike, options: { take: 1, order: { created_at: 'ASC' } } });

    expect(decodeCursor(result.meta.pagination.next_cursor as string)).toMatchObject({ value: 'A', id: 1 });
  });

  it('throws AppInternalException for an unknown sort column', async () => {
    const { repoLike } = createCursorRepo({ rows: [], knownColumns: ['id'] });

    await expect(
      listWithCursorPagination({ repoLike, options: { take: 5, order: { created_at: 'ASC' } } }),
    ).rejects.toBeInstanceOf(AppInternalException);
  });
});
