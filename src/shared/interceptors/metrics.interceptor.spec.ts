import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { Request } from 'express';
import { Counter, Histogram } from 'prom-client';
import { lastValueFrom } from 'rxjs';

import { getCurrentTraceIds } from '@infrastructure/observability/otel.helpers';
import { createCallHandler, createMockExecutionContext, createMockRequest, createMockResponse } from '@test/helpers';

import { MetricsInterceptor } from './metrics.interceptor';

jest.mock('@infrastructure/observability/otel.helpers', () => ({
  getCurrentTraceIds: jest.fn(),
}));

const getCurrentTraceIdsMock = getCurrentTraceIds as jest.MockedFunction<typeof getCurrentTraceIds>;

describe('MetricsInterceptor', () => {
  let httpDuration: DeepMocked<Histogram<string>>;
  let httpTotal: DeepMocked<Counter<string>>;
  let interceptor: MetricsInterceptor;

  function contextFor({
    routePath,
    statusCode = 200,
  }: {
    routePath: string | undefined;
    statusCode?: number;
  }): ReturnType<typeof createMockExecutionContext> {
    const request = createMockRequest({ method: 'POST' });
    Object.assign(request, { route: routePath === undefined ? undefined : { path: routePath } } as Partial<Request>);
    const response = createMockResponse({ statusCode });

    return createMockExecutionContext({ request, response });
  }

  beforeEach(() => {
    getCurrentTraceIdsMock.mockReturnValue(undefined);
    httpDuration = createMock<Histogram<string>>();
    httpTotal = createMock<Counter<string>>();
    interceptor = new MetricsInterceptor(httpDuration, httpTotal);
  });

  it.each([['/api/v1/metrics'], ['/api/v1/health']])(
    'passes through %s without recording metrics',
    async (routePath) => {
      const result = await lastValueFrom(interceptor.intercept(contextFor({ routePath }), createCallHandler('ok')));

      expect(result).toBe('ok');
      expect(httpDuration.observe).not.toHaveBeenCalled();
      expect(httpTotal.inc).not.toHaveBeenCalled();
    },
  );

  it('records duration and count with method/route/status labels on success', async () => {
    await lastValueFrom(
      interceptor.intercept(contextFor({ routePath: '/api/v1/orders', statusCode: 201 }), createCallHandler('ok')),
    );

    const labels = { method: 'POST', route: '/api/v1/orders', status_code: '201' };
    expect(httpDuration.observe).toHaveBeenCalledWith(labels, expect.any(Number));
    expect(httpTotal.inc).toHaveBeenCalledWith(labels);
  });

  it('attaches a trace_id exemplar to the duration histogram when a span is active', async () => {
    getCurrentTraceIdsMock.mockReturnValue({ trace_id: 'trace-abc', span_id: 'span-xyz' });

    await lastValueFrom(
      interceptor.intercept(contextFor({ routePath: '/api/v1/orders', statusCode: 200 }), createCallHandler('ok')),
    );

    const labels = { method: 'POST', route: '/api/v1/orders', status_code: '200' };
    expect(httpDuration.observe).toHaveBeenCalledWith({
      labels,
      value: expect.any(Number),
      exemplarLabels: { trace_id: 'trace-abc' },
    });
    expect(httpTotal.inc).toHaveBeenCalledWith(labels);
  });

  it('labels the route as "unknown" when the request has no matched route', async () => {
    await lastValueFrom(interceptor.intercept(contextFor({ routePath: undefined }), createCallHandler('ok')));

    expect(httpTotal.inc).toHaveBeenCalledWith(expect.objectContaining({ route: 'unknown' }));
  });

  it('records a 500 status when the handler errors without a status', async () => {
    const context = contextFor({ routePath: '/api/v1/orders' });

    await expect(lastValueFrom(interceptor.intercept(context, createCallHandler(new Error('boom'))))).rejects.toThrow(
      'boom',
    );
    expect(httpTotal.inc).toHaveBeenCalledWith(expect.objectContaining({ status_code: '500' }));
  });

  it('uses error.status when the handler error carries one', async () => {
    const context = contextFor({ routePath: '/api/v1/orders' });
    const error = Object.assign(new Error('not found'), { status: 404 });

    await expect(lastValueFrom(interceptor.intercept(context, createCallHandler(error)))).rejects.toThrow('not found');
    expect(httpTotal.inc).toHaveBeenCalledWith(expect.objectContaining({ status_code: '404' }));
  });

  it('falls back to error.httpCode when there is no status', async () => {
    const context = contextFor({ routePath: '/api/v1/orders' });
    const error = Object.assign(new Error('unprocessable'), { httpCode: 422 });

    await expect(lastValueFrom(interceptor.intercept(context, createCallHandler(error)))).rejects.toThrow(
      'unprocessable',
    );
    expect(httpTotal.inc).toHaveBeenCalledWith(expect.objectContaining({ status_code: '422' }));
  });
});
