import { FindManyOptions, FindOptionsOrder, FindOptionsWhere, ObjectLiteral, Repository } from 'typeorm';

import { PaginationType } from '@shared/enums/pagination-type.enum';
import { AppInternalException } from '@shared/exceptions/internal.exception';
import { CursorPaginated } from '@shared/responses/cursor-paginated.response';
import { OffsetPaginated } from '@shared/responses/offset-paginated.response';
import { CursorValue, encodeCursor, IDecodedCursor } from '@shared/utils/cursor.util';

export interface ICursorPaginationOptions<Entity> {
  take: number;
  cursor?: IDecodedCursor;
  order?: FindOptionsOrder<Entity>;
  where?: FindOptionsWhere<Entity> | FindOptionsWhere<Entity>[];
  relations?: FindManyOptions<Entity>['relations'];
}

declare module 'typeorm' {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- augmenting TypeORM's Repository interface
  interface Repository<Entity> {
    listWithOffsetPagination(options?: FindManyOptions<Entity>): Promise<OffsetPaginated<Entity>>;
    listWithCursorPagination(options: ICursorPaginationOptions<Entity>): Promise<CursorPaginated<Entity>>;
  }
}

const CURSOR_TIEBREAKER_FIELD = 'id';
const CURSOR_SORT_VALUE_ALIAS = '__cursor_sort_value';
const CURSOR_ID_VALUE_ALIAS = '__cursor_id_value';

// eslint-disable-next-line no-restricted-syntax -- the explicit `this` type is not a runtime argument; the method takes a single `options`
Repository.prototype.listWithOffsetPagination = async function <Entity extends ObjectLiteral>(
  this: Repository<Entity>,
  options: FindManyOptions<Entity> = {},
): Promise<OffsetPaginated<Entity>> {
  const [data, total] = await this.findAndCount(options);

  const hasPageSize = typeof options.take === 'number' && options.take > 0;
  const pageSize = hasPageSize ? (options.take as number) : total;
  const page = hasPageSize ? Math.floor((options.skip ?? 0) / (options.take as number)) + 1 : 1;
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;

  return new OffsetPaginated(data, {
    pagination: {
      type: PaginationType.Offset,
      page,
      page_size: pageSize,
      total_count: total,
      total_pages: totalPages,
    },
  });
};

function resolveColumn<Entity extends ObjectLiteral>(params: {
  repository: Repository<Entity>;
  field: string;
}): string {
  const column = params.repository.metadata.findColumnWithPropertyName(params.field);

  if (!column) {
    throw new AppInternalException({ message: `Unknown cursor pagination column: ${params.field}` });
  }

  return column.databaseName;
}

function toCursorValue(value: unknown): CursorValue {
  return value instanceof Date ? value.toISOString() : (value as CursorValue);
}

// eslint-disable-next-line no-restricted-syntax -- the explicit `this` type is not a runtime argument; the method takes a single `options`
Repository.prototype.listWithCursorPagination = async function <Entity extends ObjectLiteral>(
  this: Repository<Entity>,
  options: ICursorPaginationOptions<Entity>,
): Promise<CursorPaginated<Entity>> {
  const { take, cursor, order, where, relations } = options;

  const [sortField = CURSOR_TIEBREAKER_FIELD, rawDirection = 'ASC'] = Object.entries(order ?? {})[0] ?? [];
  const direction: 'asc' | 'desc' = String(rawDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';

  const alias = this.metadata.tableName;
  const sortColumn = resolveColumn({ repository: this, field: sortField });
  const idColumn = resolveColumn({ repository: this, field: CURSOR_TIEBREAKER_FIELD });

  const queryBuilder = this.createQueryBuilder(alias).setFindOptions({ where, relations });

  if (cursor) {
    const operator = direction === 'asc' ? '>' : '<';

    queryBuilder.andWhere(`(${alias}.${sortColumn}, ${alias}.${idColumn}) ${operator} (:__cursorValue, :__cursorId)`, {
      __cursorValue: cursor.value,
      __cursorId: cursor.id,
    });
  }

  const sortOrder = direction === 'asc' ? 'ASC' : 'DESC';

  // ! Cursor comes from the ::text cast: a hydrated Date/number loses the precision the keyset boundary needs.
  queryBuilder
    .orderBy(`${alias}.${sortColumn}`, sortOrder)
    .addOrderBy(`${alias}.${idColumn}`, sortOrder)
    .addSelect(`${alias}.${sortColumn}::text`, CURSOR_SORT_VALUE_ALIAS)
    .addSelect(`${alias}.${idColumn}::text`, CURSOR_ID_VALUE_ALIAS)
    .take(take + 1);

  const { entities, raw } = await queryBuilder.getRawAndEntities();

  const hasNext = entities.length > take;
  const items = hasNext ? entities.slice(0, take) : entities;

  let nextCursor: string | null = null;

  if (hasNext && items.length > 0) {
    const last = items[items.length - 1];
    const lastId = toCursorValue(last[CURSOR_TIEBREAKER_FIELD as keyof Entity]);

    // ! Resolve by id, not position: a to-many JOIN flattens `raw` to more rows than `entities`.
    const rawSortValueById = new Map<string, CursorValue>();
    for (const row of raw as Array<Record<string, unknown>>) {
      rawSortValueById.set(String(row[CURSOR_ID_VALUE_ALIAS]), row[CURSOR_SORT_VALUE_ALIAS] as CursorValue);
    }

    nextCursor = encodeCursor({
      field: sortField,
      value: rawSortValueById.get(String(lastId)) ?? toCursorValue(last[sortField as keyof Entity]),
      direction,
      id: lastId,
    });
  }

  return new CursorPaginated(items, {
    pagination: {
      type: PaginationType.Cursor,
      page_size: take,
      next_cursor: nextCursor,
      has_next: hasNext,
    },
  });
};
