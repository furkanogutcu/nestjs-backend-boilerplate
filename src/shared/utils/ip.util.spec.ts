import { Request } from 'express';

import { extractCloudflareIp, isTrustedPeer, parseClientIp, TrustProxyFn } from './ip.util';

const trustAll: TrustProxyFn = () => true;
const trustNone: TrustProxyFn = () => false;

type RequestOverrides = {
  ip?: string;
  remoteAddress?: string;
  trusted?: boolean;
  headers?: Record<string, string | string[] | undefined>;
};

function makeRequest({ ip, remoteAddress, trusted, headers }: RequestOverrides): Request {
  return {
    ip,
    headers: headers ?? {},
    socket: { remoteAddress } as Request['socket'],
    app: {
      get: (key: string) => (key === 'trust proxy fn' ? () => trusted ?? false : undefined),
    },
  } as unknown as Request;
}

describe('parseClientIp', () => {
  it('returns req.ip when present', () => {
    const request = { ip: '203.0.113.7' } as Request;

    expect(parseClientIp({ req: request })).toBe('203.0.113.7');
  });

  it('falls back to "unknown" when req.ip is undefined', () => {
    const request = { ip: undefined } as unknown as Request;

    expect(parseClientIp({ req: request })).toBe('unknown');
  });

  it('uses a custom fallback when provided and req.ip is undefined', () => {
    const request = { ip: undefined } as unknown as Request;

    expect(parseClientIp({ req: request, fallbackIp: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('prefers req.ip over the custom fallback', () => {
    const request = { ip: '198.51.100.4' } as Request;

    expect(parseClientIp({ req: request, fallbackIp: '0.0.0.0' })).toBe('198.51.100.4');
  });

  describe('CF-Connecting-IP (hybrid)', () => {
    it('prefers CF-Connecting-IP over req.ip when the request is from a trusted proxy', () => {
      const request = makeRequest({
        ip: '10.0.0.5',
        remoteAddress: '10.0.0.5',
        trusted: true,
        headers: { 'cf-connecting-ip': '203.0.113.9' },
      });

      expect(parseClientIp({ req: request })).toBe('203.0.113.9');
    });

    it('ignores a spoofed CF-Connecting-IP when the immediate peer is NOT trusted', () => {
      const request = makeRequest({
        ip: '198.51.100.1',
        remoteAddress: '198.51.100.1',
        trusted: false,
        headers: { 'cf-connecting-ip': '1.2.3.4' },
      });

      expect(parseClientIp({ req: request })).toBe('198.51.100.1');
    });

    it('falls back to req.ip when trusted but CF-Connecting-IP is absent', () => {
      const request = makeRequest({ ip: '203.0.113.20', remoteAddress: '10.0.0.5', trusted: true });

      expect(parseClientIp({ req: request })).toBe('203.0.113.20');
    });

    it('ignores an invalid CF-Connecting-IP value and falls back to req.ip', () => {
      const request = makeRequest({
        ip: '203.0.113.21',
        remoteAddress: '10.0.0.5',
        trusted: true,
        headers: { 'cf-connecting-ip': 'not-an-ip' },
      });

      expect(parseClientIp({ req: request })).toBe('203.0.113.21');
    });

    it('uses the first entry when CF-Connecting-IP arrives as an array', () => {
      const request = makeRequest({
        ip: '10.0.0.5',
        remoteAddress: '10.0.0.5',
        trusted: true,
        headers: { 'cf-connecting-ip': ['2001:db8::1', '1.2.3.4'] },
      });

      expect(parseClientIp({ req: request })).toBe('2001:db8::1');
    });

    it('falls back to req.ip when the socket has no remote address', () => {
      const request = makeRequest({
        ip: '203.0.113.30',
        remoteAddress: undefined,
        trusted: true,
        headers: { 'cf-connecting-ip': '203.0.113.99' },
      });

      expect(parseClientIp({ req: request })).toBe('203.0.113.30');
    });
  });
});

describe('isTrustedPeer', () => {
  it('rejects the peer when no trust function is configured', () => {
    expect(isTrustedPeer({ remoteAddress: '10.0.0.5', trustFn: undefined })).toBe(false);
  });

  it('rejects the peer when the remote address is missing', () => {
    expect(isTrustedPeer({ remoteAddress: undefined, trustFn: trustAll })).toBe(false);
  });

  it('delegates to the trust function when both are present', () => {
    expect(isTrustedPeer({ remoteAddress: '10.0.0.5', trustFn: trustAll })).toBe(true);
    expect(isTrustedPeer({ remoteAddress: '198.51.100.1', trustFn: trustNone })).toBe(false);
  });
});

describe('extractCloudflareIp', () => {
  it('returns a valid single-value header', () => {
    expect(extractCloudflareIp({ 'cf-connecting-ip': '203.0.113.9' })).toBe('203.0.113.9');
  });

  it('uses the first entry of an array-valued header', () => {
    expect(extractCloudflareIp({ 'cf-connecting-ip': ['2001:db8::1', '1.2.3.4'] })).toBe('2001:db8::1');
  });

  it('returns undefined when the header is absent', () => {
    expect(extractCloudflareIp({})).toBeUndefined();
  });

  it('returns undefined when the header value is not a valid IP', () => {
    expect(extractCloudflareIp({ 'cf-connecting-ip': 'not-an-ip' })).toBeUndefined();
  });
});
