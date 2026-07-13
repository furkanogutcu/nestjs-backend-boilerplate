import { PaginationType } from '@shared/enums/pagination-type.enum';

export interface ICursorPaginationMeta {
  pagination: {
    type: PaginationType.Cursor;
    page_size: number;
    next_cursor: string | null;
    has_next: boolean;
  };
}

export class CursorPaginated<T, M extends ICursorPaginationMeta = ICursorPaginationMeta> {
  constructor(
    readonly items: T[],
    readonly meta: M,
  ) {}
}
