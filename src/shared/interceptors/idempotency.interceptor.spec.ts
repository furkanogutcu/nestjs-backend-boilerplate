import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { createHash } from 'crypto';
import { Request } from 'express';
import { lastValueFrom } from 'rxjs';

import { IDEMPOTENCY_LOCK_TTL_SECONDS } from '@infrastructure/idempotency/idempotency.constant';
import { IdempotencyService } from '@infrastructure/idempotency/idempotency.service';
import {
  createCallHandler,
  createMockExecutionContext,
  createMockReflector,
  createMockRequest,
  createMockResponse,
} from '@test/helpers';

import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';
import { AppBadRequestException } from '../exceptions/bad-request.exception';
import { ExceptionCode } from '../exceptions/enums/exception-code.enum';
import { AppIdempotencyInProgressException } from '../exceptions/idempotency-in-progress.exception';
import { AppInternalException } from '../exceptions/internal.exception';
import { AppValidationException } from '../exceptions/validation.exception';
import { stableStringify } from '../utils/stable-stringify.util';
import { IdempotencyInterceptor } from './idempotency.interceptor';

const VALID_KEY = 'k'.repeat(20);
const ANON_KEY = 'a'.repeat(24);
const anonymousOptions = {
  scope: 'auth:guest',
  responseTtlSeconds: 120,
  principalSource: IdempotencyPrincipalSource.Anonymous,
};
const userOptions = {
  scope: 'shop:purchase',
  responseTtlSeconds: 300,
  principalSource: IdempotencyPrincipalSource.User,
};
const requiredUserOptions = { ...userOptions, required: true };

function setup({ options, request }: { options?: unknown; request?: Partial<Request> }): {
  interceptor: IdempotencyInterceptor;
  service: DeepMocked<IdempotencyService>;
  response: ReturnType<typeof createMockResponse>;
  context: ReturnType<typeof createMockExecutionContext>;
} {
  const service = createMock<IdempotencyService>();
  const interceptor = new IdempotencyInterceptor(createMockReflector(options), service);
  const response = createMockResponse();
  const context = createMockExecutionContext({
    request: createMockRequest({ body: {}, user: undefined, ...request }),
    response,
  });

  return { interceptor, service, response, context };
}

describe('IdempotencyInterceptor', () => {
  it('passes through when the route is not idempotent', async () => {
    const { interceptor, service, context } = setup({ options: undefined });

    const result = await lastValueFrom(interceptor.intercept(context, createCallHandler('handler-result')));

    expect(result).toBe('handler-result');
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('passes through when no Idempotency-Key header is present', async () => {
    const { interceptor, service, context } = setup({ options: anonymousOptions, request: { headers: {} } });

    const result = await lastValueFrom(interceptor.intercept(context, createCallHandler('handler-result')));

    expect(result).toBe('handler-result');
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('rejects a missing Idempotency-Key on a route that requires one', () => {
    const { interceptor, service, context } = setup({
      options: requiredUserOptions,
      request: { headers: {}, user: { id: 'user-1' } },
    });

    let thrown: unknown;
    try {
      interceptor.intercept(context, createCallHandler('x'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppBadRequestException);
    expect((thrown as AppBadRequestException).code).toBe(ExceptionCode.IdempotencyKeyRequired);
    expect(service.execute).not.toHaveBeenCalled();
  });

  it('runs the idempotency service when a required route is given a key', async () => {
    const { interceptor, service, context } = setup({
      options: requiredUserOptions,
      request: { headers: { 'idempotency-key': VALID_KEY }, user: { id: 'user-1' } },
    });
    service.execute.mockResolvedValue('done');

    await lastValueFrom(interceptor.intercept(context, createCallHandler('done')));

    expect(service.execute).toHaveBeenCalled();
  });

  it('rejects an out-of-bounds Idempotency-Key', () => {
    const { interceptor, context } = setup({
      options: anonymousOptions,
      request: { headers: { 'idempotency-key': 'short' } },
    });

    expect(() => interceptor.intercept(context, createCallHandler('x'))).toThrow(AppValidationException);
  });

  it('resolves the anonymous principal and fingerprints the body', async () => {
    const { interceptor, service, context } = setup({
      options: anonymousOptions,
      request: { headers: { 'idempotency-key': ANON_KEY }, body: { field: 'x' } },
    });
    service.execute.mockImplementation(async (options) => await options.compute());

    const result = await lastValueFrom(interceptor.intercept(context, createCallHandler({ computed: true })));

    expect(result).toEqual({ computed: true });
    expect(service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'auth:guest',
        principal: createHash('sha256').update('127.0.0.1:').digest('hex'),
        key: ANON_KEY,
        fingerprint: createHash('sha256')
          .update(stableStringify({ params: {}, body: { field: 'x' }, query: {} }))
          .digest('hex'),
        lockTtlSeconds: IDEMPOTENCY_LOCK_TTL_SECONDS,
        responseTtlSeconds: 120,
      }),
    );
  });

  it('binds the anonymous principal to client IP + user-agent so a colliding key cannot cross clients', async () => {
    const principalFor = async ({ ip, userAgent }: { ip: string; userAgent: string }): Promise<string> => {
      const { interceptor, service, context } = setup({
        options: anonymousOptions,
        request: { headers: { 'idempotency-key': ANON_KEY, 'user-agent': userAgent }, ip },
      });
      service.execute.mockResolvedValue('ok');

      await lastValueFrom(interceptor.intercept(context, createCallHandler('ok')));

      return service.execute.mock.calls[0][0].principal;
    };

    const first = await principalFor({ ip: '203.0.113.1', userAgent: 'DeviceA' });
    const differentIp = await principalFor({ ip: '203.0.113.2', userAgent: 'DeviceA' });
    const sameClientRetry = await principalFor({ ip: '203.0.113.1', userAgent: 'DeviceA' });

    expect(first).not.toBe(differentIp);
    expect(first).toBe(sameClientRetry);
  });

  it('takes the first repeated Idempotency-Key value and tolerates a missing body', async () => {
    const { interceptor, service, context } = setup({
      options: anonymousOptions,
      request: { headers: { 'idempotency-key': [ANON_KEY, 'second-key'] }, body: undefined },
    });
    service.execute.mockResolvedValue('ok');

    await lastValueFrom(interceptor.intercept(context, createCallHandler('ok')));

    expect(service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        key: ANON_KEY,
        fingerprint: createHash('sha256')
          .update(stableStringify({ params: {}, body: null, query: {} }))
          .digest('hex'),
      }),
    );
  });

  it('tolerates a missing query string when fingerprinting', async () => {
    const { interceptor, service, context } = setup({
      options: anonymousOptions,
      request: { headers: { 'idempotency-key': ANON_KEY }, body: { field: 'x' }, query: undefined },
    });
    service.execute.mockResolvedValue('ok');

    await lastValueFrom(interceptor.intercept(context, createCallHandler('ok')));

    expect(service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        fingerprint: createHash('sha256')
          .update(stableStringify({ params: {}, body: { field: 'x' }, query: null }))
          .digest('hex'),
      }),
    );
  });

  it('produces the same fingerprint regardless of body key order', async () => {
    const fingerprintFor = async (body: object): Promise<string> => {
      const { interceptor, service, context } = setup({
        options: anonymousOptions,
        request: { headers: { 'idempotency-key': ANON_KEY }, body },
      });
      service.execute.mockResolvedValue('ok');

      await lastValueFrom(interceptor.intercept(context, createCallHandler('ok')));

      return service.execute.mock.calls[0][0].fingerprint;
    };

    expect(await fingerprintFor({ a: 1, b: 2 })).toBe(await fingerprintFor({ b: 2, a: 1 }));
  });

  it('distinguishes requests by query string', async () => {
    const fingerprintFor = async (query: Record<string, string>): Promise<string> => {
      const { interceptor, service, context } = setup({
        options: anonymousOptions,
        request: { headers: { 'idempotency-key': ANON_KEY }, body: {}, query },
      });
      service.execute.mockResolvedValue('ok');

      await lastValueFrom(interceptor.intercept(context, createCallHandler('ok')));

      return service.execute.mock.calls[0][0].fingerprint;
    };

    expect(await fingerprintFor({ q: '1' })).not.toBe(await fingerprintFor({ q: '2' }));
  });

  it('distinguishes requests by route path params, so a reused key on a different :id conflicts', async () => {
    const fingerprintFor = async (params: Record<string, string>): Promise<string> => {
      const { interceptor, service, context } = setup({
        options: anonymousOptions,
        request: { headers: { 'idempotency-key': ANON_KEY }, body: {}, params },
      });
      service.execute.mockResolvedValue('ok');

      await lastValueFrom(interceptor.intercept(context, createCallHandler('ok')));

      return service.execute.mock.calls[0][0].fingerprint;
    };

    expect(await fingerprintFor({ id: 'facility-a' })).not.toBe(await fingerprintFor({ id: 'facility-b' }));
  });

  it('resolves the user principal from the authenticated request', async () => {
    const { interceptor, service, context } = setup({
      options: userOptions,
      request: { headers: { 'idempotency-key': VALID_KEY }, user: { id: 'user-1' } },
    });
    service.execute.mockResolvedValue('done');

    await lastValueFrom(interceptor.intercept(context, createCallHandler('done')));

    expect(service.execute).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'shop:purchase', principal: 'user-1', responseTtlSeconds: 300 }),
    );
  });

  it('throws when a user-scoped route has no authenticated user', () => {
    const { interceptor, context } = setup({
      options: userOptions,
      request: { headers: { 'idempotency-key': VALID_KEY } },
    });

    expect(() => interceptor.intercept(context, createCallHandler('x'))).toThrow(AppInternalException);
  });

  it('rejects a sub-threshold anonymous key (entropy floor)', () => {
    const { interceptor, context } = setup({
      options: anonymousOptions,
      request: { headers: { 'idempotency-key': VALID_KEY } },
    });

    // * VALID_KEY is 20 chars — below the anonymous floor of 24.
    expect(() => interceptor.intercept(context, createCallHandler('x'))).toThrow(AppValidationException);
  });

  it('propagates a conflict raised by the idempotency service', async () => {
    const { interceptor, service, context } = setup({
      options: anonymousOptions,
      request: { headers: { 'idempotency-key': ANON_KEY } },
    });
    service.execute.mockRejectedValue(new AppIdempotencyInProgressException());

    await expect(lastValueFrom(interceptor.intercept(context, createCallHandler('x')))).rejects.toBeInstanceOf(
      AppIdempotencyInProgressException,
    );
  });
});
