import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { Request, Response } from 'express';

export function createMockRequest(overrides: Partial<Request> = {}): DeepMocked<Request> {
  const request = createMock<Request>();

  Object.assign(request, {
    method: 'GET',
    url: '/',
    path: '/',
    originalUrl: '/',
    headers: {},
    query: {},
    params: {},
    ip: '127.0.0.1',
    context: { ipAddress: '127.0.0.1', timestamp: 0 },
    ...overrides,
  });

  return request;
}

export function createMockResponse(overrides: Partial<Response> = {}): DeepMocked<Response> {
  const response = createMock<Response>();

  Object.assign(response, { statusCode: 200, headersSent: false, ...overrides });

  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  response.send.mockReturnValue(response);
  response.setHeader.mockReturnValue(response);
  response.getHeader.mockReturnValue(undefined);

  return response;
}
