import { Socket } from 'socket.io';

import { TrustProxyFn } from '@shared/utils/ip.util';

import { extractHandshakeIp } from './handshake-ip.util';

const trustAll: TrustProxyFn = () => true;
const trustNone: TrustProxyFn = () => false;

function socketWith({ cfConnectingIp, address = '10.0.0.2' }: { cfConnectingIp?: string; address?: string }): Socket {
  return {
    handshake: {
      headers: cfConnectingIp ? { 'cf-connecting-ip': cfConnectingIp } : {},
      address,
    },
  } as unknown as Socket;
}

describe('extractHandshakeIp', () => {
  it('uses cf-connecting-ip when the direct peer is a trusted proxy', () => {
    const socket = socketWith({ cfConnectingIp: '203.0.113.7' });

    expect(extractHandshakeIp({ socket, trustFn: trustAll })).toBe('203.0.113.7');
  });

  it('falls back to the raw peer address when trusted but no cf-connecting-ip is present', () => {
    expect(extractHandshakeIp({ socket: socketWith({}), trustFn: trustAll })).toBe('10.0.0.2');
  });

  it('ignores a client-forged cf-connecting-ip when the direct peer is NOT trusted', () => {
    const socket = socketWith({ cfConnectingIp: '203.0.113.7' });

    expect(extractHandshakeIp({ socket, trustFn: trustNone })).toBe('10.0.0.2');
  });

  it('ignores forwarded headers when no trust function is configured', () => {
    const socket = socketWith({ cfConnectingIp: '203.0.113.7' });

    expect(extractHandshakeIp({ socket, trustFn: undefined })).toBe('10.0.0.2');
  });
});
