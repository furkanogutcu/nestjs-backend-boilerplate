import { Inject, Logger } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { Server, Socket } from 'socket.io';

import { env } from '@config/env.config';
import { ClockService } from '@infrastructure/clock/clock.service';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { ACCESS_TOKEN_VERIFIER } from '@shared/constants/access-token-verifier.constant';
import type { IAccessTokenVerifier, IVerifiedIdentity } from '@shared/interfaces/access-token-verifier.interface';
import { IRateLimitOptions } from '@shared/interfaces/rate-limit-rule.interface';
import { CacheKey } from '@shared/utils/cache-key.util';
import { TrustProxyFn } from '@shared/utils/ip.util';

import { REALTIME_MAX_SOCKETS_PER_USER } from '../constants/realtime-connection.constant';
import {
  REALTIME_HANDSHAKE_IP_RATE_LIMIT,
  REALTIME_HANDSHAKE_USER_RATE_LIMIT,
  REALTIME_INBOUND_FRAME_RATE_LIMIT,
} from '../constants/realtime-rate-limit.constant';
import {
  REALTIME_GLOBAL_ROOM,
  realtimeFamilyRoom,
  realtimeSessionRoom,
  realtimeUserRoom,
} from '../constants/realtime-room.constant';
import type { IRealtimePublisher } from '../interfaces/realtime-publisher.interface';
import { RealtimeMetricsService } from '../observability/realtime-metrics.service';
import { type RealtimeEvent, realtimeEventSchema } from '../schemas/realtime-event.schema';
import { extractHandshakeIp } from './handshake-ip.util';

// * Stable connect_error messages the client keys on — part of the wire contract (docs/client-integration/05-realtime.md).
const UNAUTHORIZED = 'unauthorized';
const RATE_LIMITED = 'rate_limited';
const FORBIDDEN_ORIGIN = 'forbidden_origin';

interface ISocketData {
  identity: IVerifiedIdentity;
  // * The connect instant, used to pick the oldest socket to evict when a user exceeds the connection cap. Kept
  // * on socket.data (unlike the expiry timer) because it is a plain number and must survive the Redis adapter's
  // * cross-instance fetchSockets serialization.
  connectedAtEpochMillis: number;
}

// * The socket.io realtime driver. Three jobs: (1) authenticate every connection in a handshake middleware — the
// * global HTTP guard chain does NOT run for WebSocket upgrades, so per-IP rate limiting and token verification
// * are enforced here, and a rejection surfaces client-side as connect_error('unauthorized'|'rate_limited');
// * (2) serve as the IRealtimePublisher the Kafka → client fanout emits and kicks through; (3) bound the
// * connection to its credential: the socket is disconnected when the access token would expire (the client
// * reconnects with a fresh token), and a session_revoked kick disconnects it immediately.
// * cors.origin comes from env so a browser client (the developer portal) can open the socket cross-origin; empty
// * list = same-origin / native only (a native mobile client sends no Origin, so it is unaffected).
@WebSocketGateway({
  cors: { origin: env.REALTIME_CORS_ORIGINS.length > 0 ? env.REALTIME_CORS_ORIGINS : false },
  // * WebSocket-only: no HTTP long-polling stage, so multi-instance deployments need no LB session affinity.
  transports: ['websocket'],
  // * Socket.io defaults, pinned on purpose: the 25s ping is what keeps an idle connection alive through
  // * reverse-proxy read timeouts (nginx defaults to 60s) — raising it past the proxy timeout would drop idle
  // * sockets every minute.
  pingInterval: 25000,
  pingTimeout: 20000,
  // * No inbound message handlers exist — anything beyond a trivial frame is abuse.
  maxHttpBufferSize: 1024,
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, IRealtimePublisher {
  private readonly logger = new Logger(RealtimeGateway.name);

  // * Access-token expiry timers keyed by socket id. Held here rather than on socket.data because the Redis
  // * adapter serializes socket.data across instances (fetchSockets) and a Node Timeout is circular — it cannot
  // * cross that boundary. Cleared on disconnect so the map never outlives its sockets.
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: IAccessTokenVerifier,
    private readonly rateLimitService: RateLimitService,
    private readonly clock: ClockService,
    private readonly metrics: RealtimeMetricsService,
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  afterInit(server: Server): void {
    // * Middleware rejection (next(err)) surfaces as connect_error BEFORE the connection event — the client can
    // * tell an auth failure from a network blip, and handleConnection only ever sees authenticated sockets.
    // eslint-disable-next-line no-restricted-syntax -- socket.io middleware signature is fixed (socket, next)
    server.use((socket, next) => void this.authenticateHandshake({ socket, next }));
  }

  async handleConnection(client: Socket): Promise<void> {
    const { identity } = client.data as ISocketData;
    (client.data as ISocketData).connectedAtEpochMillis = this.clock.epochMillis();

    this.installInboundThrottle(client);

    await client.join(realtimeUserRoom(identity.userId));
    await client.join(realtimeSessionRoom(identity.sessionId));
    await client.join(realtimeFamilyRoom(identity.familyId));
    await client.join(REALTIME_GLOBAL_ROOM);

    this.scheduleExpiryDisconnect({ client, identity });
    this.metrics.socketConnected();

    // * After joining, so the count includes this socket: trim the user back to the cap (evicting oldest first).
    await this.evictOverCapSockets({ userId: identity.userId });
  }

  handleDisconnect(client: Socket): void {
    const expiryTimer = this.expiryTimers.get(client.id);

    if (expiryTimer) {
      clearTimeout(expiryTimer);
      this.expiryTimers.delete(client.id);
    }

    this.metrics.socketDisconnected();
  }

  publishToUser({ userId, event }: { userId: string; event: RealtimeEvent }): void {
    const validated = this.validateOutbound(event);

    if (!validated) {
      return;
    }

    this.server.to(realtimeUserRoom(userId)).emit('event', validated);
    this.metrics.recordEventPublished({ type: validated.type });
  }

  publishGlobal({ event }: { event: RealtimeEvent }): void {
    const validated = this.validateOutbound(event);

    if (!validated) {
      return;
    }

    this.server.to(REALTIME_GLOBAL_ROOM).emit('event', validated);
    this.metrics.recordEventPublished({ type: validated.type });
  }

  disconnectSession({ sessionId }: { sessionId: string }): void {
    // * Redis adapter propagates disconnectSockets cluster-wide, so the revoked session's sockets die on every instance.
    this.server.in(realtimeSessionRoom(sessionId)).disconnectSockets(true);
    this.metrics.recordKick({ kind: 'session' });
  }

  disconnectFamily({ familyId }: { familyId: string }): void {
    this.server.in(realtimeFamilyRoom(familyId)).disconnectSockets(true);
    this.metrics.recordKick({ kind: 'family' });
  }

  private async authenticateHandshake({
    socket,
    next,
  }: {
    socket: Socket;
    next: (err?: Error) => void;
  }): Promise<void> {
    // * Origin gate: engine.io's cors.origin only writes response headers, it does not block the upgrade, so the
    // * allowlist is enforced here. A browser cannot forge Origin, so this rejects cross-site drive-by connections;
    // * a native client sends no Origin and is unaffected (empty allowlist therefore means native-only).
    const origin = socket.handshake.headers.origin;

    if (origin !== undefined && !this.isOriginAllowed(origin)) {
      this.metrics.recordHandshake({ outcome: 'rejected', reason: FORBIDDEN_ORIGIN });

      return next(new Error(FORBIDDEN_ORIGIN));
    }

    const ip = extractHandshakeIp({ socket, trustFn: this.getTrustProxyFn() });

    // * Tier 1: per-IP flood gate, consumed BEFORE the verify so a token-less loop never reaches the JWT +
    // * revocation lookup. Wide enough (60/min) not to lock a shared NAT out (see the constant's rationale).
    const ipRateLimitError = await this.consumeBudget({
      options: REALTIME_HANDSHAKE_IP_RATE_LIMIT,
      key: CacheKey.join('realtime-handshake', ip),
      subject: `ip=${ip}`,
    });

    if (ipRateLimitError) {
      return next(ipRateLimitError);
    }

    const token = this.extractToken(socket);
    let identity: IVerifiedIdentity;

    try {
      if (token === null) {
        throw new Error('no token in handshake auth');
      }

      identity = await this.verifier.verify({ token });
    } catch (error) {
      this.logger.warn(`Realtime handshake rejected: ${error instanceof Error ? error.message : 'invalid token'}`);
      this.metrics.recordHandshake({ outcome: 'rejected', reason: UNAUTHORIZED });

      return next(new Error(UNAUTHORIZED));
    }

    // * Tier 2: the real per-client budget, keyed on the verified user rather than the shared NAT IP.
    const userRateLimitError = await this.consumeBudget({
      options: REALTIME_HANDSHAKE_USER_RATE_LIMIT,
      key: CacheKey.join('realtime-handshake-user', identity.userId),
      subject: `user=${identity.userId}`,
    });

    if (userRateLimitError) {
      return next(userRateLimitError);
    }

    (socket.data as ISocketData).identity = identity;
    this.metrics.recordHandshake({ outcome: 'accepted' });

    next();
  }

  private async consumeBudget({
    options,
    key,
    subject,
  }: {
    options: IRateLimitOptions;
    key: string;
    subject: string;
  }): Promise<Error | null> {
    try {
      await this.rateLimitService.consumeByKey({ options, key });

      return null;
    } catch (error) {
      if (error instanceof RateLimiterRes) {
        this.logger.warn(`Realtime handshake rejected: rate limited (${subject})`);
        this.metrics.recordHandshake({ outcome: 'rejected', reason: RATE_LIMITED });

        return new Error(RATE_LIMITED);
      }

      // * Fail-open on limiter infrastructure errors (Redis down): the limiter is a throttle, not an auth control —
      // * token verification (with its DB-fallback revocation check) still runs, and hard-rejecting here would keep
      // * every reconnecting client out for the whole Redis outage + recovery window.
      this.logger.error(
        `Realtime handshake rate limiter unavailable, failing open: ${error instanceof Error ? error.message : 'unknown error'}`,
      );

      return null;
    }
  }

  private scheduleExpiryDisconnect({ client, identity }: { client: Socket; identity: IVerifiedIdentity }): void {
    // * The socket must not outlive its credential: disconnect when the access token expires; the client
    // * reconnects with a freshly refreshed token (its auth provider re-evaluates per attempt).
    const ttlMs = Math.max(0, identity.tokenExpiresAtEpochMillis - this.clock.epochMillis());

    this.expiryTimers.set(
      client.id,
      setTimeout(() => client.disconnect(true), ttlMs),
    );
  }

  // * Enforce the per-user socket cap cluster-wide: fetchSockets goes through the Redis adapter, so both the
  // * count and the eviction span every instance. Over the cap, the OLDEST connections are dropped (newest-wins,
  // * matching the session family cap). Best-effort — a two-connect race can momentarily leave cap+1 (the next
  // * connect trims it) and any adapter error fails open, since a hygiene control must never block a real connect.
  private async evictOverCapSockets({ userId }: { userId: string }): Promise<void> {
    try {
      const sockets = await this.server.in(realtimeUserRoom(userId)).fetchSockets();

      if (sockets.length <= REALTIME_MAX_SOCKETS_PER_USER) {
        return;
      }

      const oldestFirst = [...sockets].sort(
        // eslint-disable-next-line no-restricted-syntax -- Array.sort comparator signature is fixed (a, b)
        (a, b) => (a.data as ISocketData).connectedAtEpochMillis - (b.data as ISocketData).connectedAtEpochMillis,
      );

      for (const socket of oldestFirst.slice(0, sockets.length - REALTIME_MAX_SOCKETS_PER_USER)) {
        socket.disconnect(true);
        this.metrics.recordKick({ kind: 'user_cap' });
      }
    } catch (error) {
      this.logger.error(
        `Realtime connection-cap eviction failed, allowing the connection: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: unknown };

    return typeof auth.token === 'string' && auth.token.length > 0 ? auth.token : null;
  }

  private isOriginAllowed(origin: string): boolean {
    // * Empty allowlist = native-only: a browser Origin never matches, so cross-site connections are rejected.
    return env.REALTIME_CORS_ORIGINS.includes(origin);
  }

  private getTrustProxyFn(): TrustProxyFn | undefined {
    // * Reuse the same compiled trust function express derives from TRUST_PROXY (set in main.ts before listen), so
    // * WS handshake-IP resolution matches the HTTP path's per-hop trust rather than blindly trusting a header.
    return this.httpAdapterHost.httpAdapter?.getInstance().get('trust proxy fn') as TrustProxyFn | undefined;
  }

  private installInboundThrottle(client: Socket): void {
    // * No @SubscribeMessage handlers exist, so a well-behaved client emits nothing; this in-memory fixed-window
    // * counter kills a socket that floods inbound frames (parser-CPU abuse) without a Redis round-trip per frame.
    const { points, duration } = REALTIME_INBOUND_FRAME_RATE_LIMIT;
    const windowMs = duration * 1000;
    let windowStartEpochMillis = this.clock.epochMillis();
    let frameCount = 0;

    client.onAny(() => {
      const now = this.clock.epochMillis();

      if (now - windowStartEpochMillis > windowMs) {
        windowStartEpochMillis = now;
        frameCount = 0;
      }

      frameCount += 1;

      if (frameCount > points) {
        this.logger.warn(`Realtime socket ${client.id} exceeded inbound frame budget; disconnecting`);
        client.disconnect(true);
      }
    });
  }

  private validateOutbound(event: RealtimeEvent): RealtimeEvent | null {
    // * The schema is the outbound allowlist, enforced at the emit boundary so a publisher cannot ship a malformed
    // * envelope to clients: a bad event is dropped (best-effort transport) rather than broadcast raw.
    const parsed = realtimeEventSchema.safeParse(event);

    if (!parsed.success) {
      this.logger.error(`Dropping malformed realtime event: ${parsed.error.message}`);

      return null;
    }

    return parsed.data;
  }
}
