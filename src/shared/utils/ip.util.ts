import { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

import { Request } from 'express';

const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

// * Express 'trust proxy fn' signature (proxy-addr): tells whether the address at a given hop is a trusted proxy.
export type TrustProxyFn = (address: string | undefined, hop: number) => boolean;

export function parseClientIp(params: { req: Request; fallbackIp?: string }): string {
  const { req, fallbackIp = 'unknown' } = params;
  const trustFn = req.app?.get('trust proxy fn') as TrustProxyFn | undefined;

  if (isTrustedPeer({ remoteAddress: req.socket?.remoteAddress, trustFn })) {
    const cloudflareIp = extractCloudflareIp(req.headers);

    if (cloudflareIp) {
      return cloudflareIp;
    }
  }

  return req.ip ?? fallbackIp;
}

// * The security-critical core shared with the WebSocket handshake path (extractHandshakeIp): only honour a
// * forwarded client IP when the DIRECT peer is a configured trusted proxy — a client-forged header from an
// * untrusted peer is ignored. Kept here so HTTP and WS resolve identically off one audited algorithm.
export function isTrustedPeer(params: {
  remoteAddress: string | undefined;
  trustFn: TrustProxyFn | undefined;
}): boolean {
  const { remoteAddress, trustFn } = params;

  if (typeof trustFn !== 'function' || !remoteAddress) {
    return false;
  }

  return trustFn(remoteAddress, 0);
}

export function extractCloudflareIp(headers: IncomingHttpHeaders): string | undefined {
  const header = headers[CF_CONNECTING_IP_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  return value && isIP(value) !== 0 ? value : undefined;
}

// * Raw-input client-IP resolution used by the WebSocket paths (socket.io handshake + engine.io upgrade), which have
// * no express Request. Same trust discipline as parseClientIp: Cloudflare's cf-connecting-ip is authoritative only
// * when the direct peer is a configured trusted proxy; otherwise the raw peer address is used, so a client-forged
// * x-forwarded-for from an untrusted peer cannot influence the result.
export function resolveClientIp(params: {
  remoteAddress: string | undefined;
  headers: IncomingHttpHeaders;
  trustFn: TrustProxyFn | undefined;
  fallbackIp?: string;
}): string {
  const { remoteAddress, headers, trustFn, fallbackIp = 'unknown' } = params;

  if (isTrustedPeer({ remoteAddress, trustFn })) {
    const cloudflareIp = extractCloudflareIp(headers);

    if (cloudflareIp) {
      return cloudflareIp;
    }
  }

  return remoteAddress ?? fallbackIp;
}
