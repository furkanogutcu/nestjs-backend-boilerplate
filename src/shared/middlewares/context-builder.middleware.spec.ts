import { NextFunction, Response } from 'express';

import { createMockRequest } from '@test/helpers';

import { contextBuilder } from './context-builder.middleware';

describe('contextBuilder', () => {
  const response = {} as Response;
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('sets the ip address from req.ip and calls next', () => {
    const request = createMockRequest({ ip: '203.0.113.7' });

    contextBuilder(request, response, next);

    expect(request.context.ipAddress).toBe('203.0.113.7');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('falls back to "unknown" when req.ip is missing', () => {
    const request = createMockRequest({ ip: undefined });

    contextBuilder(request, response, next);

    expect(request.context.ipAddress).toBe('unknown');
  });

  it('stamps the context with the current timestamp', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const request = createMockRequest();

    contextBuilder(request, response, next);

    expect(request.context.timestamp).toBe(new Date('2026-01-01T00:00:00.000Z').getTime());

    vi.useRealTimers();
  });
});
