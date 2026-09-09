import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Response } from 'express';
import { TypeORMError } from 'typeorm';
import z from 'zod';

import { getCurrentTraceIds } from '@infrastructure/observability/otel.helpers';

import { AppException } from '../app.exception';
import { ExceptionCode } from '../enums/exception-code.enum';
import { IErrorResponse } from '../interfaces/error-response.interface';
import { AppInternalException } from '../internal.exception';
import { HttpErrorExceptionTransformer } from '../transformers/http-error.exception-transformer';
import { NestJSExceptionTransformer } from '../transformers/nestjs.exception-transformer';
import { TypeORMExceptionTransformer } from '../transformers/typeorm.exception-transformer';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (response.headersSent) {
      return;
    }

    const requestId = this.getRequestId(response);
    const traceId = this.getTraceId();

    try {
      const appException = this.toAppException(exception);

      if (appException instanceof AppInternalException) {
        this.logger.error(appException.originalError ?? appException);
      }

      response.status(appException.httpCode).json(this.toBody({ exception: appException, requestId, traceId }));
    } catch (error) {
      const fallback = new AppInternalException({ error: error instanceof Error ? error : undefined });

      this.logger.error(fallback.originalError ?? fallback);

      response.status(fallback.httpCode).json(this.toBody({ exception: fallback, requestId, traceId }));
    }
  }

  private toAppException(exception: unknown): AppException<unknown> {
    if (exception instanceof AppException) {
      return exception;
    }

    // ! A raw ZodError here is never client input — those convert upstream — so it is a data fault, not a 400.
    if (exception instanceof z.ZodError) {
      return new AppInternalException({ message: 'Internal data failed schema validation', error: exception });
    }

    if (exception instanceof TypeORMError) {
      const transformed = TypeORMExceptionTransformer.transform(exception);

      if (transformed) return transformed;
    }

    if (exception instanceof HttpException) {
      const transformed = NestJSExceptionTransformer.transform(exception);

      if (transformed) return transformed;
    }

    const httpError = HttpErrorExceptionTransformer.transform(exception);

    if (httpError) return httpError;

    return new AppInternalException({ error: exception instanceof Error ? exception : undefined });
  }

  private toBody(params: {
    exception: AppException<unknown>;
    requestId?: string;
    traceId?: string;
  }): IErrorResponse<unknown> {
    const { exception, requestId, traceId } = params;
    const body = exception.toJSON();

    // ! Masked in every environment: an internal code/message/details can carry dependency names and data shapes.
    if (exception instanceof AppInternalException) {
      body.error.code = ExceptionCode.UnexpectedError;
      body.error.message = 'An unexpected error occurred.';
      body.error.details = undefined;
    }

    if (requestId) {
      body.error.requestId = requestId;
    }

    if (traceId) {
      body.error.traceId = traceId;
    }

    return body;
  }

  private getRequestId(response: Response): string | undefined {
    const header = response.getHeader('X-Request-Id');

    return typeof header === 'string' ? header : undefined;
  }

  private getTraceId(): string | undefined {
    return getCurrentTraceIds()?.trace_id;
  }
}
