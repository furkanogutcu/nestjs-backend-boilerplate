import { createMock } from '@golevelup/ts-jest';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { firstValueFrom, of } from 'rxjs';

import { REFRESH_TOKEN_COOKIE } from '../constants/auth.constant';
import { RefreshCookieInterceptor } from './refresh-cookie.interceptor';

function buildContext({
  headers,
  response,
}: {
  headers: Record<string, unknown>;
  response: Response;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }) as Request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

const handlerOf = (payload: unknown): CallHandler => ({ handle: () => of(payload) });

describe('RefreshCookieInterceptor', () => {
  let interceptor: RefreshCookieInterceptor;

  beforeEach(() => {
    interceptor = new RefreshCookieInterceptor();
  });

  it('moves the refresh token into a cookie and strips it from the body for a web client', async () => {
    const response = createMock<Response>();
    const ctx = buildContext({ headers: { 'x-client-type': 'web' }, response });
    const next = handlerOf({ access_token: 'a', refresh_token: 'rt', token_type: 'Bearer', expires_in: 900 });

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(response.cookie).toHaveBeenCalledWith(REFRESH_TOKEN_COOKIE, 'rt', expect.any(Object));
    expect(result).not.toHaveProperty('refresh_token');
    expect(result).toMatchObject({ access_token: 'a', token_type: 'Bearer' });
  });

  it('leaves the refresh token in the body for a mobile client', async () => {
    const response = createMock<Response>();
    const ctx = buildContext({ headers: {}, response });
    const next = handlerOf({ access_token: 'a', refresh_token: 'rt' });

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(response.cookie).not.toHaveBeenCalled();
    expect(result).toMatchObject({ refresh_token: 'rt' });
  });

  it('passes a payload without a refresh token straight through', async () => {
    const response = createMock<Response>();
    const ctx = buildContext({ headers: { 'x-client-type': 'web' }, response });
    const next = handlerOf({ message: 'ok' });

    const result = await firstValueFrom(interceptor.intercept(ctx, next));

    expect(response.cookie).not.toHaveBeenCalled();
    expect(result).toEqual({ message: 'ok' });
  });
});
