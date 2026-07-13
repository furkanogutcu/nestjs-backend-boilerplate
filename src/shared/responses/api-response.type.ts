import { ICursorPaginationMeta } from './cursor-paginated.response';
import { IOffsetPaginationMeta } from './offset-paginated.response';

export interface IDataEnvelope<T> {
  data: T;
}

export interface IPaginatedEnvelope<T> {
  data: T[];
  meta: IOffsetPaginationMeta | ICursorPaginationMeta;
}

export interface IMessageEnvelope {
  message: string;
}
