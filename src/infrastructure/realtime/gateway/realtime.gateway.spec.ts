import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { HttpAdapterHost } from '@nestjs/core';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { Server, Socket } from 'socket.io';

import { ClockService } from '@infrastructure/clock/clock.service';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import type { IAccessTokenVerifier } from '@shared/interfaces/access-token-verifier.interface';

import {
  REALTIME_GLOBAL_ROOM,
  realtimeFamilyRoom,
  realtimeSessionRoom,
  realtimeUserRoom,
} from '../constants/realtime-room.constant';
import { RealtimeMetricsService } from '../observability/realtime-metrics.service';
import type { RealtimeEvent } from '../schemas/realtime-event.schema';
import { RealtimeGateway } from './realtime.gateway';

const NOW_MS = new Date('2026-01-01T00:00:00.000Z').getTime();

const identity = {
  userId: 'user-1',
  sessionId: 'sess-1',
  familyId: 'fam-1',
  tokenExpiresAtEpochMillis: NOW_MS + 900_000,
};

const event: RealtimeEvent = {
  type: 'notification',
  v: 1,
  emitted_at: '2026-06-20T10:00:00.000Z',
  data: { title: 'Hello' },
};

type MockSocket = Socket & { join: jest.Mock; disconnect: jest.Mock; onAny: jest.Mock };

function socketWith({ token, origin }: { token?: unknown; origin?: string }): MockSocket {
  return {
    id: 's1',
    handshake: { auth: { token }, headers: origin ? { origin } : {}, address: '198.51.100.7' },
    data: {},
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    onAny: jest.fn(),
  } as unknown as MockSocket;
}

describe('RealtimeGateway', () => {
  let verifier: DeepMocked<IAccessTokenVerifier>;
  let rateLimitService: DeepMocked<RateLimitService>;
  let metrics: DeepMocked<RealtimeMetricsService>;
  let gateway: RealtimeGateway;
  let middleware: (socket: Socket, next: (err?: Error) => void) => void;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date(NOW_MS));
    verifier = createMock<IAccessTokenVerifier>();
    rateLimitService = createMock<RateLimitService>();
    rateLimitService.consumeByKey.mockResolvedValue(createMock<RateLimiterRes>());
    metrics = createMock<RealtimeMetricsService>();
    // * No trusted-proxy fn in tests, so extractHandshakeIp returns the raw handshake address (198.51.100.7).
    const httpAdapterHost = createMock<HttpAdapterHost>();
    httpAdapterHost.httpAdapter.getInstance.mockReturnValue({ get: () => undefined });
    gateway = new RealtimeGateway(verifier, rateLimitService, new ClockService(), metrics, httpAdapterHost);

    const use = jest.fn();
    gateway.afterInit({ use } as unknown as Server);
    middleware = use.mock.calls[0][0] as typeof middleware;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // * next() / next(err) is async (verifier + limiter are awaited); resolve it as a promise.
  async function runMiddleware(socket: Socket): Promise<Error | undefined> {
    return await new Promise((resolve) => middleware(socket, resolve));
  }

  describe('handshake middleware', () => {
    it('accepts a valid token, stashes the identity and reports the accepted handshake', async () => {
      verifier.verify.mockResolvedValue(identity);
      const client = socketWith({ token: 'valid-jwt' });

      const error = await runMiddleware(client);

      expect(error).toBeUndefined();
      expect(verifier.verify).toHaveBeenCalledWith({ token: 'valid-jwt' });
      expect(client.data).toMatchObject({ identity });
      expect(metrics.recordHandshake).toHaveBeenCalledWith({ outcome: 'accepted' });
    });

    it("rejects a disallowed browser Origin with connect_error 'forbidden_origin' before verifying", async () => {
      // * REALTIME_CORS_ORIGINS is empty in the test env, so any browser Origin is rejected (native-only).
      const error = await runMiddleware(socketWith({ token: 'valid-jwt', origin: 'https://evil.example' }));

      expect(error?.message).toBe('forbidden_origin');
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(metrics.recordHandshake).toHaveBeenCalledWith({ outcome: 'rejected', reason: 'forbidden_origin' });
    });

    it('accepts a native client that sends no Origin header', async () => {
      verifier.verify.mockResolvedValue(identity);

      const error = await runMiddleware(socketWith({ token: 'valid-jwt' }));

      expect(error).toBeUndefined();
    });

    it("rejects a missing token with connect_error 'unauthorized' without calling the verifier", async () => {
      const error = await runMiddleware(socketWith({}));

      expect(error?.message).toBe('unauthorized');
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(metrics.recordHandshake).toHaveBeenCalledWith({ outcome: 'rejected', reason: 'unauthorized' });
    });

    it("rejects a failed verification with connect_error 'unauthorized'", async () => {
      verifier.verify.mockRejectedValue(new Error('expired'));

      const error = await runMiddleware(socketWith({ token: 'bad-jwt' }));

      expect(error?.message).toBe('unauthorized');
    });

    it("rejects a rate-limited handshake with connect_error 'rate_limited' before touching the verifier", async () => {
      rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes());

      const error = await runMiddleware(socketWith({ token: 'valid-jwt' }));

      expect(error?.message).toBe('rate_limited');
      expect(verifier.verify).not.toHaveBeenCalled();
      expect(metrics.recordHandshake).toHaveBeenCalledWith({ outcome: 'rejected', reason: 'rate_limited' });
    });

    it('fails open when the rate limiter infrastructure errors (Redis down) and still authenticates', async () => {
      rateLimitService.consumeByKey.mockRejectedValue(new Error('connection refused'));
      verifier.verify.mockResolvedValue(identity);

      const error = await runMiddleware(socketWith({ token: 'valid-jwt' }));

      expect(error).toBeUndefined();
      expect(verifier.verify).toHaveBeenCalled();
    });

    it('scopes the first-tier budget to the handshake IP before verifying', async () => {
      verifier.verify.mockResolvedValue(identity);

      await runMiddleware(socketWith({ token: 'valid-jwt' }));

      expect(rateLimitService.consumeByKey).toHaveBeenNthCalledWith(1, {
        options: expect.objectContaining({ points: 60 }),
        key: expect.stringContaining('198.51.100.7'),
      });
    });

    it('consumes the per-user budget only after the token verifies', async () => {
      verifier.verify.mockResolvedValue(identity);

      await runMiddleware(socketWith({ token: 'valid-jwt' }));

      // * Second tier keys on the verified user, not the shared IP.
      expect(rateLimitService.consumeByKey).toHaveBeenNthCalledWith(2, {
        options: expect.objectContaining({ points: 10 }),
        key: expect.stringContaining('user-1'),
      });
    });

    it('never consumes the per-user budget when verification fails', async () => {
      verifier.verify.mockRejectedValue(new Error('expired'));

      await runMiddleware(socketWith({ token: 'bad-jwt' }));

      expect(rateLimitService.consumeByKey).toHaveBeenCalledTimes(1);
    });

    it("rejects an over-budget user with connect_error 'rate_limited' even from a fresh IP", async () => {
      verifier.verify.mockResolvedValue(identity);
      rateLimitService.consumeByKey
        .mockResolvedValueOnce(createMock<RateLimiterRes>())
        .mockRejectedValueOnce(new RateLimiterRes());

      const error = await runMiddleware(socketWith({ token: 'valid-jwt' }));

      expect(error?.message).toBe('rate_limited');
      expect(verifier.verify).toHaveBeenCalled();
    });

    it('fails open when the per-user limiter infrastructure errors and still authenticates', async () => {
      verifier.verify.mockResolvedValue(identity);
      rateLimitService.consumeByKey
        .mockResolvedValueOnce(createMock<RateLimiterRes>())
        .mockRejectedValueOnce(new Error('connection refused'));

      const error = await runMiddleware(socketWith({ token: 'valid-jwt' }));

      expect(error).toBeUndefined();
    });
  });

  describe('handleConnection (post-middleware)', () => {
    let fetchSockets: jest.Mock;

    function connectedSocket(): MockSocket {
      const client = socketWith({ token: 'valid-jwt' });
      (client.data as { identity: typeof identity }).identity = identity;

      return client;
    }

    // * A remote-socket stand-in as fetchSockets returns them: the eviction only reads `data.connectedAtEpochMillis`
    // * and calls `disconnect`.
    function roomSocket(connectedAtEpochMillis: number): { data: object; disconnect: jest.Mock } {
      return { data: { connectedAtEpochMillis }, disconnect: jest.fn() };
    }

    beforeEach(() => {
      fetchSockets = jest.fn().mockResolvedValue([]);
      (gateway as unknown as { server: Server }).server = {
        in: jest.fn().mockReturnValue({ fetchSockets }),
      } as unknown as Server;
    });

    it('joins the user, session, family and global rooms', async () => {
      const client = connectedSocket();

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith(realtimeUserRoom('user-1'));
      expect(client.join).toHaveBeenCalledWith(realtimeSessionRoom('sess-1'));
      expect(client.join).toHaveBeenCalledWith(realtimeFamilyRoom('fam-1'));
      expect(client.join).toHaveBeenCalledWith(REALTIME_GLOBAL_ROOM);
      expect(metrics.socketConnected).toHaveBeenCalled();
    });

    it('disconnects the socket when the access token expires (the credential bounds the connection)', async () => {
      const client = connectedSocket();

      await gateway.handleConnection(client);

      jest.advanceTimersByTime(899_999);
      expect(client.disconnect).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('cancels the expiry timer when the client disconnects first', async () => {
      const client = connectedSocket();

      await gateway.handleConnection(client);
      gateway.handleDisconnect(client);

      jest.advanceTimersByTime(900_000);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(metrics.socketDisconnected).toHaveBeenCalled();
    });

    it('evicts the oldest socket when the user exceeds the connection cap', async () => {
      // * 6 sockets for one user (cap is 5): the earliest-connected one is dropped, the rest stay.
      const roomSockets = [0, 1, 2, 3, 4, 5].map((offset) => roomSocket(NOW_MS + offset));
      fetchSockets.mockResolvedValue(roomSockets);

      await gateway.handleConnection(connectedSocket());

      expect(roomSockets[0].disconnect).toHaveBeenCalledWith(true);
      expect(roomSockets[1].disconnect).not.toHaveBeenCalled();
      expect(metrics.recordKick).toHaveBeenCalledWith({ kind: 'user_cap' });
    });

    it('does not evict when the user is at or under the connection cap', async () => {
      fetchSockets.mockResolvedValue([0, 1, 2, 3, 4].map((offset) => roomSocket(NOW_MS + offset)));

      await gateway.handleConnection(connectedSocket());

      expect(metrics.recordKick).not.toHaveBeenCalled();
    });

    it('allows the connection when the cap lookup fails (fail-open)', async () => {
      fetchSockets.mockRejectedValue(new Error('adapter down'));

      await expect(gateway.handleConnection(connectedSocket())).resolves.toBeUndefined();
      expect(metrics.socketConnected).toHaveBeenCalled();
    });

    it('disconnects a socket that floods inbound frames past the per-socket budget', async () => {
      const client = connectedSocket();
      await gateway.handleConnection(client);

      const onFrame = client.onAny.mock.calls[0][0] as () => void;
      for (let frame = 0; frame < 30; frame += 1) {
        onFrame();
      }
      expect(client.disconnect).not.toHaveBeenCalled();

      onFrame();
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });
  });

  describe('publishing and kicks', () => {
    let emit: jest.Mock;
    let to: jest.Mock;
    let disconnectSockets: jest.Mock;
    let inRooms: jest.Mock;

    beforeEach(() => {
      emit = jest.fn();
      to = jest.fn().mockReturnValue({ emit });
      disconnectSockets = jest.fn();
      inRooms = jest.fn().mockReturnValue({ disconnectSockets });
      (gateway as unknown as { server: Server }).server = { to, in: inRooms } as unknown as Server;
    });

    it('emits a user push to that user room only', () => {
      gateway.publishToUser({ userId: 'user-1', event });

      expect(to).toHaveBeenCalledWith(realtimeUserRoom('user-1'));
      expect(emit).toHaveBeenCalledWith('event', event);
      expect(metrics.recordEventPublished).toHaveBeenCalledWith({ type: 'notification' });
    });

    it('emits a global push to the global room', () => {
      gateway.publishGlobal({ event });

      expect(to).toHaveBeenCalledWith(REALTIME_GLOBAL_ROOM);
      expect(emit).toHaveBeenCalledWith('event', event);
    });

    it('drops a malformed outbound event instead of broadcasting it', () => {
      gateway.publishToUser({ userId: 'user-1', event: { type: '' } as unknown as RealtimeEvent });

      expect(emit).not.toHaveBeenCalled();
      expect(metrics.recordEventPublished).not.toHaveBeenCalled();
    });

    it('kicks a revoked session by closing every socket in its session room', () => {
      gateway.disconnectSession({ sessionId: 'sess-1' });

      expect(inRooms).toHaveBeenCalledWith(realtimeSessionRoom('sess-1'));
      expect(disconnectSockets).toHaveBeenCalledWith(true);
      expect(metrics.recordKick).toHaveBeenCalledWith({ kind: 'session' });
    });

    it('kicks a revoked family by closing every socket in its family room', () => {
      gateway.disconnectFamily({ familyId: 'fam-1' });

      expect(inRooms).toHaveBeenCalledWith(realtimeFamilyRoom('fam-1'));
      expect(disconnectSockets).toHaveBeenCalledWith(true);
      expect(metrics.recordKick).toHaveBeenCalledWith({ kind: 'family' });
    });
  });
});
