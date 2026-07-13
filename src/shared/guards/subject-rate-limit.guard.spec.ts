import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ExecutionContext } from '@nestjs/common';
import { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';

import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { createMockExecutionContext, createMockReflector, createMockRequest, createMockResponse } from '@test/helpers';

import { AppTooManyRequestException } from '../exceptions/too-many-request.exception';
import { SubjectRateLimitPolicy } from '../interfaces/rate-limit-rule.interface';
import { SubjectRateLimiterGuard } from './subject-rate-limit.guard';

function buildGuard(params: {
  rule: unknown;
  rateLimitService: DeepMocked<RateLimitService>;
}): SubjectRateLimiterGuard {
  return new SubjectRateLimiterGuard(createMockReflector(params.rule), params.rateLimitService);
}

describe('SubjectRateLimiterGuard', () => {
  let rateLimitService: DeepMocked<RateLimitService>;
  let response: DeepMocked<Response>;

  function contextWith(): ReturnType<typeof createMockExecutionContext> {
    const request = createMockRequest({ method: 'GET', path: '/orders' });
    request.context.ipAddress = '1.2.3.4';

    return createMockExecutionContext({ request, response });
  }

  beforeEach(() => {
    rateLimitService = createMock<RateLimitService>();
    response = createMockResponse();
  });

  it('allows the request without consuming when the policy is Off', async () => {
    const guard = buildGuard({ rule: { policy: SubjectRateLimitPolicy.Off }, rateLimitService });

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);
    expect(rateLimitService.consume).not.toHaveBeenCalled();
  });

  it('falls back to the Standard policy when no rule is defined', async () => {
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 1000 }));
    const guard = buildGuard({ rule: undefined, rateLimitService });

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);
    expect(rateLimitService.consume).toHaveBeenCalledWith({
      options: expect.objectContaining({ points: 100 }),
      rateLimitContext: expect.objectContaining({ request: expect.objectContaining({ ip_address: '1.2.3.4' }) }),
    });
  });

  it('sets rate-limit headers and allows the request on success', async () => {
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 5, msBeforeNext: 30000 }));
    const guard = buildGuard({
      rule: { policy: SubjectRateLimitPolicy.Standard, options: { points: 100, duration: 60 } },
      rateLimitService,
    });

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Limit', 100);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', 95);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Reset', 30);
  });

  it('sets Retry-After and throws when the limit is exceeded', async () => {
    rateLimitService.consume.mockRejectedValue(new RateLimiterRes(0, 5000, 100));
    const guard = buildGuard({
      rule: { policy: SubjectRateLimitPolicy.Standard, options: { points: 100, duration: 60 } },
      rateLimitService,
    });

    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(AppTooManyRequestException);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Limit', 100);
    expect(response.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', 0);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', 5);
  });

  it('rethrows unexpected errors from the rate-limit service', async () => {
    const failure = new Error('redis unavailable');
    rateLimitService.consume.mockRejectedValue(failure);
    const guard = buildGuard({
      rule: { policy: SubjectRateLimitPolicy.Standard, options: { points: 100, duration: 60 } },
      rateLimitService,
    });

    await expect(guard.canActivate(contextWith())).rejects.toBe(failure);
  });

  it('skips setting headers when no response object is available', async () => {
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 1000 }));
    const request = createMockRequest();
    request.context.ipAddress = '1.2.3.4';
    const http = createMock<HttpArgumentsHost>();
    http.getRequest.mockReturnValue(request);
    http.getResponse.mockReturnValue(undefined);
    const context = createMock<ExecutionContext>();
    context.switchToHttp.mockReturnValue(http);
    const guard = buildGuard({
      rule: { policy: SubjectRateLimitPolicy.Standard, options: { points: 100, duration: 60 } },
      rateLimitService,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(response.setHeader).not.toHaveBeenCalled();
  });

  it('builds the rate-limit key from the request url when the path is empty', async () => {
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 1000 }));
    const request = createMockRequest({ path: '', url: '/fallback-url' });
    request.context.ipAddress = '1.2.3.4';
    const guard = buildGuard({
      rule: { policy: SubjectRateLimitPolicy.Standard, options: { points: 100, duration: 60 } },
      rateLimitService,
    });

    await guard.canActivate(createMockExecutionContext({ request, response }));

    expect(rateLimitService.consume).toHaveBeenCalledWith({
      options: expect.anything(),
      rateLimitContext: expect.objectContaining({ request: expect.objectContaining({ path: '/fallback-url' }) }),
    });
  });

  it('passes the authenticated user id into the rate-limit context', async () => {
    rateLimitService.consume.mockResolvedValue(createMock<RateLimiterRes>({ consumedPoints: 1, msBeforeNext: 1000 }));
    const request = createMockRequest({ method: 'POST', path: '/auth/logout' });
    request.context.ipAddress = '1.2.3.4';
    request.user = { id: 'user-1' };
    const guard = buildGuard({
      rule: { policy: SubjectRateLimitPolicy.Sensitive, options: { points: 5, duration: 60 } },
      rateLimitService,
    });

    await guard.canActivate(createMockExecutionContext({ request, response }));

    expect(rateLimitService.consume).toHaveBeenCalledWith({
      options: expect.anything(),
      rateLimitContext: expect.objectContaining({ request: expect.objectContaining({ user_id: 'user-1' }) }),
    });
  });
});
