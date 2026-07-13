import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Request, Response } from 'express';
import { TypeORMError } from 'typeorm';
import z from 'zod';

import { getCurrentTraceIds } from '@infrastructure/observability/otel.helpers';

import { SENSITIVE_HEADER_KEYS } from '../../constants/sensitive-headers.constant';
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

  // eslint-disable-next-line no-restricted-syntax -- NestJS ExceptionFilter.catch signature is fixed (exception, host)
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) {
      return;
    }

    const requestId = this.getRequestId(response);
    const traceId = this.getTraceId();

    try {
      const appException = this.toAppException(exception);

      if (appException instanceof AppInternalException) {
        this.logger.error(appException);
        this.captureToSentry({ exception: appException, request, requestId });
      }

      response.status(appException.httpCode).json(this.toBody({ exception: appException, requestId, traceId }));
    } catch (error) {
      const fallback = new AppInternalException({ error: error instanceof Error ? error : undefined });

      this.logger.error(fallback);
      this.captureToSentry({ exception: fallback, request, requestId });

      response.status(fallback.httpCode).json(this.toBody({ exception: fallback, requestId, traceId }));
    }
  }

  private toAppException(exception: unknown): AppException<unknown> {
    if (exception instanceof AppException) {
      return exception;
    }

    // * A raw ZodError reaching the filter is never client input: request payloads convert to
    // * AppValidationException in AppZodValidationPipe (and the pagination/search/order-by param
    // * decorators), response bodies in ResponseInterceptor. What lands here is a server-side parse of
    // * stored or internal data (e.g. a published catalog snapshot that predates a schema change) — a
    // * data-integrity fault, not a bad request. Surface it as 500 so it is logged and reported.
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

    // * Internal faults must never leak their code, message, or details to the client — those can carry
    // * dependency names, key ids, or stored-data shapes. The real values are preserved for the operator via
    // * the logger.error + Sentry capture in catch(); the client gets only a generic envelope plus the
    // * correlation ids below. Masked in every environment, not just production, so non-prod deployments and
    // * any internet-reachable preview never disclose internals.
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

  private captureToSentry(params: { exception: AppInternalException; request: Request; requestId?: string }): void {
    const { exception, request, requestId } = params;

    Sentry.withScope((scope) => {
      const traceId = getCurrentTraceIds()?.trace_id;

      if (traceId) {
        scope.setTag('trace_id', traceId);
      }

      if (requestId) {
        scope.setTag('request_id', requestId);
      }

      // * Strip the query string: it can carry tokens, one-time codes, or ids that must not reach Sentry.
      scope.setExtra('url', request.url.split('?')[0]);
      scope.setExtra('method', request.method);
      scope.setExtra('headers', this.sanitizeHeaders(request.headers));
      scope.setLevel('error');

      const originalError = exception.originalError ?? exception;

      Sentry.captureException(originalError);
    });
  }

  private sanitizeHeaders(headers: Request['headers']): Record<string, unknown> {
    const sanitized: Record<string, unknown> = { ...headers };

    for (const key of SENSITIVE_HEADER_KEYS) {
      if (sanitized[key]) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }
}
