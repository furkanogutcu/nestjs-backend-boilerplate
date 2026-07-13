import { Controller, Get, INestApplication, Logger } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import { OffsetPagination } from '@shared/decorators/offset-pagination.decorator';
import { ExceptionCode } from '@shared/exceptions/enums/exception-code.enum';
import { GlobalExceptionFilter } from '@shared/exceptions/filters/global.filter';
import { ResponseInterceptor } from '@shared/interceptors/response.interceptor';
import { AppZodValidationPipe } from '@shared/pipes/app-zod-validation.pipe';
import type { OffsetPaginationParams } from '@shared/schemas/offset-pagination.schema';

// * Stands in for stored data the server parses at runtime (e.g. a published catalog snapshot whose shape
// * predates a schema change): parsing it throws a raw ZodError from inside request handling — exactly the
// * way BalanceConfigService fails on a stale snapshot.
const storedDataSchema = z.object({ max_refund_bps: z.number().int() });

@Controller('zod-error-status')
class ZodErrorStatusTestController {
  @Get('client-input')
  clientInput(@OffsetPagination() pagination: OffsetPaginationParams): OffsetPaginationParams {
    return pagination;
  }

  @Get('stored-data')
  storedData(): unknown {
    return storedDataSchema.parse({});
  }
}

// * Locks the ZodError HTTP-status invariant end-to-end through the real global stack (pipe + decorators +
// * filter): client-input ZodErrors are 400 client faults, server-side data ZodErrors are 500 internal faults.
describe('ZodError HTTP status classification (e2e)', () => {
  let app: INestApplication;
  let loggerError: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ZodErrorStatusTestController],
      providers: [
        { provide: APP_PIPE, useClass: AppZodValidationPipe },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerError.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 400 for a client-input ZodError (invalid query param)', async () => {
    const response = await request(app.getHttpServer()).get('/zod-error-status/client-input?page_size=0').expect(400);

    expect(response.body.error).toMatchObject({
      code: ExceptionCode.ValidationFailed,
      details: [{ path: 'page_size' }],
    });
    expect(loggerError).not.toHaveBeenCalled();
  });

  it('returns 500 for a server-side ZodError (stored data fails its schema)', async () => {
    const response = await request(app.getHttpServer()).get('/zod-error-status/stored-data').expect(500);

    expect(response.body.error).toMatchObject({ code: ExceptionCode.UnexpectedError });
    expect(loggerError).toHaveBeenCalled();
  });
});
