import { lastValueFrom } from 'rxjs';
import { z, ZodType } from 'zod';

import { createCallHandler, createMockExecutionContext, createMockReflector } from '@test/helpers';

import { PaginationType } from '../enums/pagination-type.enum';
import { AppInternalException } from '../exceptions/internal.exception';
import { CursorPaginated, ICursorPaginationMeta } from '../responses/cursor-paginated.response';
import { MessageResponse } from '../responses/message.response';
import { IOffsetPaginationMeta, OffsetPaginated } from '../responses/offset-paginated.response';
import { ResponseInterceptor } from './response.interceptor';

const schema = z.object({ id: z.number(), name: z.string() });

async function intercept({
  payload,
  reflectorValue,
}: {
  payload: unknown;
  reflectorValue?: unknown;
}): Promise<unknown> {
  const interceptor = new ResponseInterceptor(createMockReflector(reflectorValue));

  return await lastValueFrom(interceptor.intercept(createMockExecutionContext(), createCallHandler(payload)));
}

describe('ResponseInterceptor', () => {
  it('passes through undefined without requiring a schema', async () => {
    await expect(intercept({ payload: undefined })).resolves.toBeUndefined();
  });

  it('wraps a MessageResponse as a message envelope', async () => {
    await expect(intercept({ payload: new MessageResponse('Done') })).resolves.toEqual({ message: 'Done' });
  });

  it('throws when a non-empty payload has no response schema', async () => {
    await expect(intercept({ payload: { id: 1, name: 'a' } })).rejects.toBeInstanceOf(AppInternalException);
  });

  it('wraps a single payload in a data envelope and strips unknown keys via the schema', async () => {
    await expect(
      intercept({ payload: { id: 1, name: 'Wheat', extra: 'stripped' }, reflectorValue: schema }),
    ).resolves.toEqual({
      data: { id: 1, name: 'Wheat' },
    });
  });

  it('serializes a paginated payload and preserves its meta', async () => {
    const meta: IOffsetPaginationMeta = {
      pagination: { type: PaginationType.Offset, page: 1, page_size: 20, total_count: 2, total_pages: 1 },
    };
    const paginated = new OffsetPaginated(
      [
        { id: 1, name: 'A', extra: 1 },
        { id: 2, name: 'B' },
      ],
      meta,
    );

    await expect(intercept({ payload: paginated, reflectorValue: schema })).resolves.toEqual({
      data: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      meta,
    });
  });

  it('throws AppInternalException when a single payload does not match its schema', async () => {
    await expect(
      intercept({ payload: { id: 'not-a-number', name: 'x' }, reflectorValue: schema }),
    ).rejects.toBeInstanceOf(AppInternalException);
  });

  it('wraps a non-Error thrown by the schema parser as an AppInternalException', async () => {
    const throwingSchema = {
      parse: () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately throwing a non-Error to exercise the fallback
        throw 'non-error failure';
      },
    } as unknown as ZodType;

    await expect(intercept({ payload: { id: 1, name: 'a' }, reflectorValue: throwingSchema })).rejects.toBeInstanceOf(
      AppInternalException,
    );
  });

  it('throws AppInternalException when a paginated item does not match its schema', async () => {
    const meta: IOffsetPaginationMeta = {
      pagination: { type: PaginationType.Offset, page: 1, page_size: 20, total_count: 1, total_pages: 1 },
    };
    const paginated = new OffsetPaginated([{ id: 'bad', name: 'x' }], meta);

    await expect(intercept({ payload: paginated, reflectorValue: schema })).rejects.toBeInstanceOf(
      AppInternalException,
    );
  });

  it('serializes a cursor-paginated payload and preserves its meta', async () => {
    const meta: ICursorPaginationMeta = {
      pagination: { type: PaginationType.Cursor, page_size: 20, next_cursor: 'abc', has_next: true },
    };
    const cursorPaginated = new CursorPaginated(
      [
        { id: 1, name: 'A', extra: 1 },
        { id: 2, name: 'B' },
      ],
      meta,
    );

    await expect(intercept({ payload: cursorPaginated, reflectorValue: schema })).resolves.toEqual({
      data: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      meta,
    });
  });
});
