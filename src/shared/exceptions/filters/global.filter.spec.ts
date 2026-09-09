import { DeepMocked } from '@golevelup/ts-vitest';
import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { EntityNotFoundError, TypeORMError } from 'typeorm';
import type { MockInstance } from 'vitest';
import { z } from 'zod';

import { createMockArgumentsHost, createMockRequest, createMockResponse } from '@test/helpers';

import { AppBadRequestException } from '../bad-request.exception';
import { ExceptionCode } from '../enums/exception-code.enum';
import { IErrorResponse } from '../interfaces/error-response.interface';
import { AppInternalException } from '../internal.exception';
import { AppNotFoundException } from '../not-found.exception';
import { GlobalExceptionFilter } from './global.filter';

vi.mock('@config/env.config', () => ({ env: { NODE_ENV: 'test' } }));
vi.mock('@opentelemetry/api', () => ({ trace: { getActiveSpan: vi.fn() } }));

function mockActiveSpan(ids: { traceId: string; spanId: string } | undefined): void {
  vi.mocked(trace.getActiveSpan).mockReturnValue(ids ? ({ spanContext: () => ids } as never) : undefined);
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let request: DeepMocked<Request>;
  let response: DeepMocked<Response>;
  let loggerError: MockInstance;

  function catchException(exception: unknown): IErrorResponse<unknown> {
    filter.catch(exception, createMockArgumentsHost({ request, response }));

    return response.json.mock.calls.at(-1)?.[0] as IErrorResponse<unknown>;
  }

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    request = createMockRequest({ url: '/orders', method: 'POST', headers: {} });
    response = createMockResponse();

    loggerError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    mockActiveSpan(undefined);
  });

  it('does nothing when the response headers were already sent', () => {
    response = createMockResponse({ headersSent: true });

    filter.catch(new AppBadRequestException(), createMockArgumentsHost({ request, response }));

    expect(response.status).not.toHaveBeenCalled();
    expect(response.json).not.toHaveBeenCalled();
  });

  it('passes an AppException through untouched', () => {
    const body = catchException(new AppNotFoundException({ resourceName: 'Order' }));

    expect(response.status).toHaveBeenCalledWith(404);
    expect(body).toEqual({
      error: { code: ExceptionCode.ResourceNotFound, message: 'Order not found.', details: undefined },
    });
  });

  it('attaches the requestId from the X-Request-Id response header', () => {
    response.getHeader.mockReturnValue('req-123');

    const body = catchException(new AppBadRequestException());

    expect(body.error.requestId).toBe('req-123');
  });

  it('ignores a non-string X-Request-Id header', () => {
    response.getHeader.mockReturnValue(42);

    const body = catchException(new AppBadRequestException());

    expect(body.error.requestId).toBeUndefined();
  });

  it('treats a bare ZodError as a server-side data fault (500), not a client validation error', () => {
    const zodError = (z.object({ name: z.string() }).safeParse({}) as { error: z.ZodError }).error;

    const body = catchException(zodError);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
    expect(loggerError).toHaveBeenCalledWith(zodError);
  });

  it('maps a TypeORM EntityNotFoundError via its transformer', () => {
    const body = catchException(new EntityNotFoundError('Order', {}));

    expect(response.status).toHaveBeenCalledWith(404);
    expect(body.error.code).toBe(ExceptionCode.ResourceNotFound);
  });

  it('falls back to an internal error when a TypeORMError is not mappable', () => {
    const body = catchException(new TypeORMError('connection lost'));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
    expect(loggerError).toHaveBeenCalled();
  });

  it('maps a known NestJS HttpException via its transformer', () => {
    const body = catchException(new BadRequestException('bad payload'));

    expect(response.status).toHaveBeenCalledWith(400);
    expect(body.error.code).toBe(ExceptionCode.BadRequest);
  });

  it('falls back to an internal error for an unmapped HttpException', () => {
    const body = catchException(new HttpException('teapot', 418));

    expect(response.status).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
    expect(loggerError).toHaveBeenCalled();
  });

  it('maps a library http-error (e.g. body parser) via its transformer', () => {
    const httpError = Object.assign(new Error('request entity too large'), {
      statusCode: 413,
      type: 'entity.too.large',
      expose: true,
    });

    const body = catchException(httpError);

    expect(response.status).toHaveBeenCalledWith(413);
    expect(body.error.code).toBe(ExceptionCode.PayloadTooLarge);
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('wraps an unknown error as internal and logs its original error', () => {
    const original = new Error('boom');

    const body = catchException(original);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
    expect(loggerError).toHaveBeenCalledWith(original);
  });

  it('wraps a non-Error thrown value as internal and reports the wrapped exception', () => {
    const body = catchException('a bare string failure');

    expect(response.status).toHaveBeenCalledWith(500);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
    expect(loggerError).toHaveBeenCalledWith(expect.any(AppInternalException));
  });

  it('logs an AppInternalException using its original error', () => {
    const original = new Error('downstream failed');

    catchException(new AppInternalException({ error: original }));

    expect(loggerError).toHaveBeenCalledWith(original);
  });

  describe('internal error scrubbing', () => {
    it('scrubs the message, custom code, and details of an AppInternalException to a generic envelope', () => {
      const body = catchException(
        new AppInternalException({
          message: 'Unknown encryption key id "k1"',
          code: 'catalog_not_published',
          details: ['k1'] as never,
        }),
      );

      expect(response.status).toHaveBeenCalledWith(500);
      expect(body.error).toMatchObject({
        code: ExceptionCode.UnexpectedError,
        message: 'An unexpected error occurred.',
      });
      expect(body.error.details).toBeUndefined();
    });

    it('does not scrub client-safe 4xx code and messages', () => {
      const body = catchException(new AppNotFoundException({ resourceName: 'Order' }));

      expect(response.status).toHaveBeenCalledWith(404);
      expect(body.error.code).toBe(ExceptionCode.ResourceNotFound);
      expect(body.error.message).toBe('Order not found.');
    });
  });

  describe('traceId', () => {
    it('is omitted when there is no active span', () => {
      const body = catchException(new AppBadRequestException());

      expect(body.error.traceId).toBeUndefined();
    });

    it('is taken from the active OpenTelemetry span', () => {
      mockActiveSpan({ traceId: 'trace-from-span', spanId: 'span-1' });

      const body = catchException(new AppBadRequestException());

      expect(body.error.traceId).toBe('trace-from-span');
    });
  });

  it('uses the catch-block fallback when serializing the response throws', () => {
    response.json.mockImplementationOnce(() => {
      throw new Error('serialization failed');
    });

    const body = catchException(new AppBadRequestException());

    expect(response.status).toHaveBeenNthCalledWith(1, 400);
    expect(response.status).toHaveBeenNthCalledWith(2, 500);
    expect(response.json).toHaveBeenCalledTimes(2);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
    expect(loggerError).toHaveBeenCalled();
  });

  it('uses the catch-block fallback even when a non-Error is thrown during serialization', () => {
    response.json.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error fallback path
      throw 'non-error serialization failure';
    });

    const body = catchException(new AppBadRequestException());

    expect(response.status).toHaveBeenNthCalledWith(2, 500);
    expect(body.error.code).toBe(ExceptionCode.UnexpectedError);
  });
});
