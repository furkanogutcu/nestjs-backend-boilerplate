import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Request, Response } from 'express';
import { Counter, Histogram } from 'prom-client';
import { Observable, tap } from 'rxjs';

import { getCurrentTraceIds } from '@infrastructure/observability/otel.helpers';

const EXCLUDED_ROUTE_SUFFIXES = ['/metrics', '/health'];

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(
    @InjectMetric('http_request_duration_seconds')
    private readonly httpDuration: Histogram<string>,
    @InjectMetric('http_requests_total')
    private readonly httpTotal: Counter<string>,
  ) {}

  // eslint-disable-next-line no-restricted-syntax -- NestJS NestInterceptor.intercept signature is fixed (context, next)
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

          this.recordMetrics({ method, route: routePath, statusCode: response.statusCode, startTime });
        },
        error: (error: { status?: number; httpCode?: number }) => {
          const statusCode = error.status ?? error.httpCode ?? 500;

          this.recordMetrics({ method, route: routePath, statusCode, startTime });
        },
      }),
    );
  }

  private recordMetrics(params: { method: string; route: string; statusCode: number; startTime: number }): void {
    const { method, route, statusCode, startTime } = params;
    const duration = (performance.now() - startTime) / 1000;
    const labels = { method, route, status_code: statusCode.toString() };
    const traceIds = getCurrentTraceIds();

    if (traceIds) {
      this.httpDuration.observe({ labels, value: duration, exemplarLabels: { trace_id: traceIds.trace_id } });
    } else {
      this.httpDuration.observe(labels, duration);
    }

    this.httpTotal.inc(labels);
  }
}
