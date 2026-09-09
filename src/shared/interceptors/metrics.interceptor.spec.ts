import { Request } from 'express';
import { lastValueFrom } from 'rxjs';

import { createCallHandler, createMockExecutionContext, createMockRequest, createMockResponse } from '@test/helpers';

import { MetricsInterceptor } from './metrics.interceptor';

const mockRecord = jest.fn();

jest.mock('@infrastructure/observability/meter', () => ({
  getMeter: () => ({ createHistogram: () => ({ record: mockRecord }) }),
}));

describe('MetricsInterceptor', () => {
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
    mockRecord.mockClear();
    interceptor = new MetricsInterceptor();
  });

  it('passes through /api/v1/health without recording metrics', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(contextFor({ routePath: '/api/v1/health' }), createCallHandler('ok')),
    );

    expect(result).toBe('ok');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('records duration with method/route/status attributes on success', async () => {
    await lastValueFrom(
      interceptor.intercept(contextFor({ routePath: '/api/v1/orders', statusCode: 201 }), createCallHandler('ok')),
    );

    expect(mockRecord).toHaveBeenCalledWith(expect.any(Number), {
      'http.request.method': 'POST',
      'http.route': '/api/v1/orders',
      'http.response.status_code': 201,
    });
  });

  it('records the failure status when the handler throws', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(
          contextFor({ routePath: '/api/v1/orders' }),
          createCallHandler(Object.assign(new Error('boom'), { status: 422 })),
        ),
      ),
    ).rejects.toThrow('boom');

    expect(mockRecord).toHaveBeenCalledWith(expect.any(Number), {
      'http.request.method': 'POST',
      'http.route': '/api/v1/orders',
      'http.response.status_code': 422,
    });
  });

  it('labels an unmatched route as unknown', async () => {
    await lastValueFrom(interceptor.intercept(contextFor({ routePath: undefined }), createCallHandler('ok')));

    expect(mockRecord).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ 'http.route': 'unknown' }));
  });
});
