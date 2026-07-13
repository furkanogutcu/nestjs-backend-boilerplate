import { Socket } from 'socket.io';

import { resolveClientIp, TrustProxyFn } from '@shared/utils/ip.util';

// * WS counterpart of the HTTP client-IP resolution (parseClientIp): express 'trust proxy' / req.ip do not apply to
// * socket.io handshakes, so the shared resolveClientIp core is run over the raw handshake instead. A forwarded client
// * IP (Cloudflare's cf-connecting-ip) is honoured ONLY when the direct peer (socket.handshake.address) is a configured
// * trusted proxy; otherwise the raw peer address is used. A client-forged x-forwarded-for from an untrusted peer is
// * therefore ignored — closing the per-IP handshake-rate-limit bypass that trusting the leftmost XFF hop allowed. The
// * compiled trust function is passed in (the gateway reads express's 'trust proxy fn' once) to keep this pure.
export function extractHandshakeIp(params: { socket: Socket; trustFn: TrustProxyFn | undefined }): string {
  const { socket, trustFn } = params;

  return resolveClientIp({
    remoteAddress: socket.handshake.address,
    headers: socket.handshake.headers,
    trustFn,
  });
}
