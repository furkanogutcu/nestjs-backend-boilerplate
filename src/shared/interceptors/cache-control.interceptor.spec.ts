import { lastValueFrom } from 'rxjs';

import { createCallHandler, createMockExecutionContext, createMockResponse } from '@test/helpers';

import { CacheControlInterceptor } from './cache-control.interceptor';

function setup(): {
  interceptor: CacheControlInterceptor;
  response: ReturnType<typeof createMockResponse>;
  context: ReturnType<typeof createMockExecutionContext>;
} {
  const interceptor = new CacheControlInterceptor();
  const response = createMockResponse();
  const context = createMockExecutionContext({ response });

  return { interceptor, response, context };
}

describe('CacheControlInterceptor', () => {
  it('defaults every response to Cache-Control: no-store', async () => {
    const { interceptor, response, context } = setup();

    const result = await lastValueFrom(interceptor.intercept(context, createCallHandler({ ok: true })));

    expect(result).toEqual({ ok: true });
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('sets the header before the handler runs so thrown errors stay non-cacheable', async () => {
    const { interceptor, response, context } = setup();

    await expect(lastValueFrom(interceptor.intercept(context, createCallHandler(new Error('boom'))))).rejects.toThrow(
      'boom',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});
