import { IRateLimitOptions } from '@shared/interfaces/rate-limit-rule.interface';

// * Tier 1 — per-IP flood gate, consumed BEFORE the JWT verify + revocation lookup so a token-less loop cannot
// * hammer them. This is deliberately NOT a per-client budget: carrier-grade NAT puts whole user populations
// * behind one IP, so a tight per-IP cap would lock legitimate users out during a reconnect wave. 60/min caps
// * verifier load at ~1 QPS/IP while leaving a mid-size CGNAT pod headroom. Revisit with real NAT telemetry
// * before the mobile client ships.
export const REALTIME_HANDSHAKE_IP_RATE_LIMIT: IRateLimitOptions = {
  points: 60,
  duration: 60,
};

// * Tier 2 — the real per-client budget, consumed AFTER the token verifies (so it keys on the authenticated
// * user, not the shared IP). A healthy client needs only a handful of handshakes per minute (socket.io backs
// * off between retries), so 10/min stops one credential's tight reconnect loop without touching its neighbours
// * behind the same NAT.
export const REALTIME_HANDSHAKE_USER_RATE_LIMIT: IRateLimitOptions = {
  points: 10,
  duration: 60,
};

// * Engine-level per-IP gate, consumed in the adapter's allowRequest BEFORE engine.io allocates a Socket (the
// * namespace tiers above only run after the client sends the CONNECT packet, so a client that completes the raw
// * upgrade and never CONNECTs would otherwise hold a socket for the full connectTimeout untouched by any budget).
// * This caps raw connection attempts per IP to stop that pre-CONNECT exhaustion vector. Separate budget/key from
// * the namespace tier-1 so a normal connect (one engine gate + one namespace tier-1) never double-charges either.
export const REALTIME_ENGINE_HANDSHAKE_IP_RATE_LIMIT: IRateLimitOptions = {
  points: 60,
  duration: 60,
};

// * Per-socket inbound frame budget, enforced in-memory (never a Redis round-trip on the frame hot path). There are
// * NO @SubscribeMessage handlers, so a well-behaved client emits nothing; any inbound frame is decoded then dropped,
// * spending parser CPU. 30 frames / 10s is generous enough to tolerate a stray client emit yet kills a tight
// * frame-flood loop (the socket is disconnected on breach).
export const REALTIME_INBOUND_FRAME_RATE_LIMIT: IRateLimitOptions = {
  points: 30,
  duration: 10,
};
