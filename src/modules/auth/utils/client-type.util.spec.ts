import type { Request } from 'express';

import { ClientType } from '../enums/client-type.enum';
import { resolveClientType } from './client-type.util';

const request = (headers: Record<string, unknown>): Request => ({ headers }) as unknown as Request;

describe('resolveClientType', () => {
  it('returns Web when x-client-type is web (case-insensitive)', () => {
    expect(resolveClientType(request({ 'x-client-type': 'WEB' }))).toBe(ClientType.Web);
  });

  it('defaults to Mobile when the header is absent', () => {
    expect(resolveClientType(request({}))).toBe(ClientType.Mobile);
  });

  it('treats any other value as Mobile', () => {
    expect(resolveClientType(request({ 'x-client-type': 'desktop' }))).toBe(ClientType.Mobile);
  });

  it('reads the first value when the header arrives as an array', () => {
    expect(resolveClientType(request({ 'x-client-type': ['web', 'mobile'] }))).toBe(ClientType.Web);
  });
});
