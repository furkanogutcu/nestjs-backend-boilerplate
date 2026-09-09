import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Histogram } from '@opentelemetry/api';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

import { getMeter } from '@infrastructure/observability/meter';

const EXCLUDED_ROUTE_SUFFIXES = ['/health'];

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  // * OTel derives count and sum from the histogram, so a separate request counter would be redundant.
  private readonly duration: Histogram = getMeter().createHistogram('http.server.request.duration', {
    description: 'Duration of inbound HTTP requests.',
    unit: 's',
  });

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // * Monotonic clock: duration must not be skewed by wall-clock jumps (NTP/DST), so this uses performance.now() not ClockService.
    const startTime = performance.now();
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;
    const routePath: string = request.route?.path ?? 'unknown';

    if (EXCLUDED_ROUTE_SUFFIXES.some((suffix) => routePath.endsWith(suffix))) {
      return next.handle();
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();

          this.record({ method, route: routePath, statusCode: response.statusCode, startTime });
        },
        error: (error: { status?: number; httpCode?: number }) => {
          const statusCode = error.status ?? error.httpCode ?? 500;

          this.record({ method, route: routePath, statusCode, startTime });
        },
      }),
    );
  }

  private record(params: { method: string; route: string; statusCode: number; startTime: number }): void {
    const { method, route, statusCode, startTime } = params;

    this.duration.record((performance.now() - startTime) / 1000, {
      'http.request.method': method,
      'http.route': route,
      'http.response.status_code': statusCode,
    });
  }
}
