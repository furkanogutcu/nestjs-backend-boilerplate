import type { AddressInfo } from 'node:net';

import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import { SignJWT } from 'jose';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { io as ioClient, Socket } from 'socket.io-client';

import { ClockService } from '@infrastructure/clock/clock.service';
import { RateLimitService } from '@infrastructure/rate-limit/rate-limit.service';
import { REALTIME_MAX_SOCKETS_PER_USER } from '@infrastructure/realtime/constants/realtime-connection.constant';
import { RealtimeGateway } from '@infrastructure/realtime/gateway/realtime.gateway';
import { RealtimeMetricsService } from '@infrastructure/realtime/observability/realtime-metrics.service';
import { AccessTokenVerifierService } from '@modules/auth/services/access-token-verifier.service';
import { RevocationService } from '@modules/auth/services/revocation.service';
import { TokenService } from '@modules/auth/services/token.service';
import { ACCESS_TOKEN_VERIFIER } from '@shared/constants/access-token-verifier.constant';

const SESSION_OWNER = '0192f8a0-aaaa-7abc-8def-000000000001';

// * Exercises the real socket.io transport end-to-end (a real listening port + a real socket.io-client) that the
// * unit gateway spec mocks: the handshake authenticates through the REAL verifier (real JWT verify + claim map)
// * inside the REAL middleware, so every rejection is observed deterministically as connect_error with the
// * contract message ('unauthorized' / 'rate_limited') — no timing windows. The gateway is provided directly (not
// * via the env-driven RealtimeModule) with stubbed revocation/rate-limit lookups, so no DB/Redis/Kafka is needed;
// * a plain IoAdapter (single-instance, in-memory) carries the socket.
describe('Realtime gateway (e2e — real socket)', () => {
  let app: INestApplication;
  let gateway: RealtimeGateway;
  let tokenService: TokenService;
  let revocation: DeepMocked<RevocationService>;
  let rateLimitService: DeepMocked<RateLimitService>;
  let url: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
    tokenService = new TokenService();
    revocation = createMock<RevocationService>();
    rateLimitService = createMock<RateLimitService>();
    const verifier = new AccessTokenVerifierService(tokenService, revocation);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: RateLimitService, useValue: rateLimitService },
        { provide: ClockService, useValue: new ClockService() },
        { provide: RealtimeMetricsService, useValue: createMock<RealtimeMetricsService>() },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    gateway = moduleRef.get(RealtimeGateway);

    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) {
      client.removeAllListeners();
      client.disconnect();
    }
    await app.close();
  });

  beforeEach(() => {
    revocation.isRevoked.mockResolvedValue(false);
    rateLimitService.consumeByKey.mockResolvedValue(createMock<RateLimiterRes>());
  });

  async function mintToken({
    userId = 'p1',
    sessionId = '0192f8a0-cccc-7abc-8def-000000000003',
    familyId = 'f1',
  }: { userId?: string; sessionId?: string; familyId?: string } = {}): Promise<string> {
    const { token } = await tokenService.signAccessToken({ userId, sessionId, familyId });

    return token;
  }

  // * Signs an access token with an explicit expiry so a genuinely EXPIRED (not malformed) token can be minted —
  // * exercising the real verifier's jose exp check end-to-end. Reuses the same active key / issuer / audience the
  // * app resolves from env (via process.env, with the schema defaults), so a live-expiry token from this signer is
  // * accepted; that positive control proves a rejection is due to expiry, not a key/issuer/audience mismatch here.
  async function signWithExpiry({ expiresInSeconds }: { expiresInSeconds: number }): Promise<string> {
    const activeKid = process.env.JWT_ACCESS_ACTIVE_KID ?? '';
    const secret =
      (process.env.JWT_ACCESS_KEYS ?? '')
        .split(',')
        .map((pair) => pair.split(':'))
        .find(([kid]) => kid === activeKid)?.[1] ?? '';
    const nowSeconds = Math.floor(Date.now() / 1000);

    return await new SignJWT({ sid: SESSION_OWNER, fid: 'f1' })
      .setProtectedHeader({ alg: 'HS256', kid: activeKid })
      .setSubject('expiry-probe')
      .setIssuedAt()
      .setIssuer(process.env.JWT_ISSUER ?? 'app')
      .setAudience(process.env.JWT_AUDIENCE ?? 'app')
      .setExpirationTime(nowSeconds + expiresInSeconds)
      .sign(new TextEncoder().encode(secret));
  }

  function open(auth: Record<string, unknown>): Socket {
    const client = ioClient(url, { transports: ['websocket'], reconnection: false, auth });
    clients.push(client);

    return client;
  }

  // * Middleware auth makes acceptance/rejection deterministic: an accepted socket fires 'connect', a rejected
  // * one fires 'connect_error' with the contract message — exactly one of the two always arrives.
  async function settleHandshake(client: Socket): Promise<{ connected: boolean; reason?: string }> {
    return await new Promise((resolve) => {
      client.once('connect', () => resolve({ connected: true }));
      client.once('connect_error', (error: Error) => resolve({ connected: false, reason: error.message }));
    });
  }

  it('accepts a valid JWT and keeps the socket connected', async () => {
    await expect(settleHandshake(open({ token: await mintToken() }))).resolves.toEqual({ connected: true });
  });

  it("rejects a socket that presents no token with connect_error 'unauthorized'", async () => {
    await expect(settleHandshake(open({}))).resolves.toEqual({ connected: false, reason: 'unauthorized' });
  });

  it("rejects a malformed token with connect_error 'unauthorized'", async () => {
    await expect(settleHandshake(open({ token: 'not-a-jwt' }))).resolves.toEqual({
      connected: false,
      reason: 'unauthorized',
    });
  });

  it("rejects a valid-but-revoked session with connect_error 'unauthorized' (parity with the HTTP guard)", async () => {
    revocation.isRevoked.mockResolvedValue(true);

    await expect(settleHandshake(open({ token: await mintToken() }))).resolves.toEqual({
      connected: false,
      reason: 'unauthorized',
    });
  });

  it("rejects a rate-limited handshake with connect_error 'rate_limited'", async () => {
    rateLimitService.consumeByKey.mockRejectedValue(new RateLimiterRes());

    await expect(settleHandshake(open({ token: await mintToken() }))).resolves.toEqual({
      connected: false,
      reason: 'rate_limited',
    });
  });

  it("kicks every socket of a revoked session with 'io server disconnect'", async () => {
    const client = open({ token: await mintToken({ userId: 'kicked', sessionId: SESSION_OWNER }) });
    await expect(settleHandshake(client)).resolves.toEqual({ connected: true });

    const disconnected = new Promise<string>((resolve) => client.once('disconnect', resolve));
    gateway.disconnectSession({ sessionId: SESSION_OWNER });

    await expect(disconnected).resolves.toBe('io server disconnect');
  });

  it("kicks every socket of a revoked family with 'io server disconnect'", async () => {
    // * Distinct family so the kick targets only this socket, not the shared default-family sockets of other tests.
    const client = open({ token: await mintToken({ userId: 'fam-kicked', familyId: 'fam-to-revoke' }) });
    await expect(settleHandshake(client)).resolves.toEqual({ connected: true });

    const disconnected = new Promise<string>((resolve) => client.once('disconnect', resolve));
    gateway.disconnectFamily({ familyId: 'fam-to-revoke' });

    await expect(disconnected).resolves.toBe('io server disconnect');
  });

  it("rejects a genuinely expired JWT through the real verifier with connect_error 'unauthorized'", async () => {
    // * Positive control: a live-expiry token from the same signer is accepted (proves the signer's key/issuer/
    // * audience match the app), so the rejection below is attributable to expiry alone.
    await expect(settleHandshake(open({ token: await signWithExpiry({ expiresInSeconds: 900 }) }))).resolves.toEqual({
      connected: true,
    });

    await expect(settleHandshake(open({ token: await signWithExpiry({ expiresInSeconds: -10 }) }))).resolves.toEqual({
      connected: false,
      reason: 'unauthorized',
    });
  });

  it("rejects a handshake whose per-user budget is exhausted with connect_error 'rate_limited'", async () => {
    // * The IP tier (first consume) passes; the per-user tier (second consume, after verify) is over budget —
    // * proving the second tier keys on the verified user and still surfaces as the same wire message.
    rateLimitService.consumeByKey
      .mockResolvedValueOnce(createMock<RateLimiterRes>())
      .mockRejectedValueOnce(new RateLimiterRes());

    await expect(settleHandshake(open({ token: await mintToken() }))).resolves.toEqual({
      connected: false,
      reason: 'rate_limited',
    });
  });

  it('evicts a socket when a user exceeds the connection cap, keeping the newest connected', async () => {
    const userId = 'capped';
    const earlier: Socket[] = [];
    for (let index = 0; index < REALTIME_MAX_SOCKETS_PER_USER; index += 1) {
      const client = open({
        token: await mintToken({ userId, sessionId: `0192f8a0-dddd-7abc-8def-00000000000${index}` }),
      });
      await expect(settleHandshake(client)).resolves.toEqual({ connected: true });
      earlier.push(client);
    }

    // * cap+1 sockets ⇒ exactly one existing socket is evicted; race their disconnects to catch whichever it is.
    const evicted = Promise.race(
      earlier.map(async (client) => await new Promise<string>((resolve) => client.once('disconnect', resolve))),
    );

    const newest = open({ token: await mintToken({ userId, sessionId: '0192f8a0-eeee-7abc-8def-000000000099' }) });
    await expect(settleHandshake(newest)).resolves.toEqual({ connected: true });

    await expect(evicted).resolves.toBe('io server disconnect');
    expect(newest.connected).toBe(true);
  });
});
