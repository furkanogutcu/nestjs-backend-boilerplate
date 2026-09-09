import { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';

import { Request } from 'express';

const CF_CONNECTING_IP_HEADER = 'cf-connecting-ip';

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

// ! Honour a forwarded IP only when the DIRECT peer is trusted, or anyone can forge cf-connecting-ip.
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
