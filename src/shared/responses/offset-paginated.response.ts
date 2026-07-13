import { PaginationType } from '@shared/enums/pagination-type.enum';

export interface IOffsetPaginationMeta {
  pagination: {
    type: PaginationType.Offset;
    page: number;
    page_size: number;
    total_count: number;
    total_pages: number;
  };
}

export class OffsetPaginated<T> {
  constructor(
    readonly items: T[],
    readonly meta: IOffsetPaginationMeta,
  ) {}
}
