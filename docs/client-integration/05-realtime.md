# 05 — Real-time invalidation channel (WebSocket)

> The client obtains server-authoritative state via HTTP reads; this channel exists to eliminate **polling**.
> For **unpredictable** changes (e.g. a command from another of the user's devices) this
> WebSocket channel comes into play: the backend pushes a small, non-persistent event that says "**what** to invalidate",
> and the client refreshes the relevant HTTP read. For the common rules (`/api/v1`, `Authorization: Bearer`, the `{ "data": … }` envelope,
> snake_case) see [`00-overview.md`](./00-overview.md) first.
>
> **Source of truth:** The event envelope comes from `src/infrastructure/realtime/schemas/realtime-event.schema.ts`; the channel
> itself is **not** in `openapi.json` (it is WebSocket, not REST). This document is the authoritative
> human-readable form of the event contract; field names are kept exactly snake_case with the wire.

## 1. Model and rationale

- **The channel is not authoritative; it is only a staleness signal.** The event carries no value — it says only _which_ data
  changed. The real state always comes from the HTTP GET checkpoint (§03 read surfaces). If an event is
  missed, the cost is only the re-sync the client does on its next read/reconnection.
- **Best-effort delivery.** The channel has **no ack, replay, ordering, or delivery guarantee.** This is deliberate:
  durability/atomicity lives in the write's own transaction (server side), and the push to the client is a non-persistent
  hint. The client never uses a push as "data"; it uses it as a **"refresh this" command**.
- **Three layers work together:** (1) client local projection = smooth 60fps bar/countdown; (2) this WS channel =
  invalidation of unpredictable change; (3) HTTP = the single source of truth. Even if the channel fails, the app works
  correctly via HTTP reads (only cross-device freshness lags).

## 2. Connection

The channel runs over **socket.io (v4 protocol, Engine.IO 4)**. The client connects over the **same origin** as the backend
(the reverse-proxy/gateway forwards the `/socket.io` path to the backend); no separate host/CORS is needed.

| Point           | Value                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Path            | `/socket.io` (socket.io default)                                                                |
| Transport       | **`websocket` only** (no long-polling — no sticky-session needed across multiple instances)     |
| Event name      | single channel: **`event`** (all envelopes arrive on it; discrimination is in the `type` field) |
| Identity (auth) | handshake `auth.token` = a valid **access token** (the token itself from the Bearer)            |

### 2.1 Authentication (handshake)

The connection is verified **at handshake time**, **before** the connection is established (in server-side middleware): the client sends
`{ "token": "<access_token>" }` in the `auth` payload of the socket.io handshake. The global HTTP guard chain
is not applied to WebSocket; identity is enforced **in the channel's own handshake**. The backend verifies the token (signature + expiry +
revocation check, **the same** as the HTTP guard), and if valid connects the user to their own private channel; if invalid it
**rejects** the handshake.

- **Rejection = `connect_error`.** A rejected handshake produces no `connect` on the client; the socket.io client's
  `connect_error` event fires carrying a **fixed contract string** in the `error.message` field:
  | `error.message`                                                                                                                    | Meaning                                                                     | Client response                                                                                                                                    |
  | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `unauthorized`                                                                                                                     | Token missing / malformed / expired / revoked                               | Refresh the access token and reconnect with a fresh token; if the refresh is also rejected, the session is over (see [`01-auth.md`](./01-auth.md)) |
  | `rate_limited`                                                                                                                     | Handshake budget exceeded (per-IP flood gate or per-user limit — see below) | Wait with increasing backoff, then try — do not set up a tight reconnect loop                                                                      |
  | These two strings are **part of the wire contract**; every other `connect_error` (network error, etc.) is treated as transient and |
  | left to normal reconnect backoff.                                                                                                  |
- **Token freshness is the client's responsibility.** In HTTP an interceptor can refresh the token on a 401; in WS there is no such
  round trip. Therefore the client refreshes an expired/about-to-expire access token **before every (re)connection**
  (see the token model in [`01-auth.md`](./01-auth.md)), then performs the handshake with a fresh token.
- **A socket does not outlive its identity.** The moment the access token expires, the backend closes the current socket with
  `io server disconnect`; the client reconnects with a fresh token (the rule above already ensures this).
  In addition, **logout / session revocation** (not from another device of the same account, but the termination of the session itself:
  logout, refresh-token reuse detection, device-limit eviction) drops that session's live sockets **immediately**
  — again `io server disconnect`. In this case the client first tries refresh; if the refresh is rejected, the session is over.
- **Handshake rate limit (two layers).** Attempts are subject to two budgets: (1) **before** verification, a per-IP
  flood gate (kept wide so as not to collectively lock out users behind shared NAT/CGNAT), and (2) **after**
  verification, the real per-user budget (a few handshakes per minute). If either is exceeded, the handshake
  is rejected with `rate_limited`. A healthy client's backoff-based reconnect does not hit the limit; the limit cuts off handshake
  spam in a tight loop.
- **Concurrent connection ceiling.** The number of sockets a user has open at once is limited (across all devices/tabs
  together). When the ceiling is exceeded, the **oldest** connection is dropped with `io server disconnect` (the new connection survives —
  newest-wins); the dropped device follows the normal reconnect rule. Do not design a client that opens many parallel sockets for
  the same user.

### 2.2 Routing

The client joins no "room" — from the handshake token the backend automatically places the user into **their own user-channel**.
An event is delivered only to all of the target user's connected devices; it does not leak to another user.
Horizontal scale (multiple gateway instances) is transparent to the client.

## 3. Event envelope

All events arrive on the `event` channel and form a **discriminated union** distinguished by the `type` field. There is currently a single type;
as the channel grows new types are added (§3.3 forward-compat below).

### 3.1 Push envelope (generic)

Server→client pushes carry a common, **versioned** envelope. The boilerplate ships with a generic sample event; domain
events are mapped into this envelope (recipe: `ARCHITECTURE.md` "Realtime").

```json
{
  "type": "resource_invalidated",
  "v": 1,
  "emitted_at": "2026-06-20T10:00:00.000Z",
  "data": { "resource_id": "01923a45-b6c7-78d9-8a1b-2c3d4e5f6789" }
}
```

| Field        | Meaning                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| `type`       | Type discriminator; the client routes on it or ignores what it does not recognize.                |
| `v`          | The type's contract version (§3.3).                                                               |
| `emitted_at` | The event's production time (ISO 8601, UTC) — not an ordering guarantee, for display/diagnostics. |
| `data`       | Type-specific, optional payload; the concrete implementation narrows it.                          |

Additionally, **`session_revoked`** is a _kick_ event: when a session or token family is revoked (logout, reuse
detection, family-cap eviction) the backend drops the relevant live sockets; the client reconnects with a fresh token.

### 3.3 Forward-compat and versioning

The envelope is a union and **will grow** (as the application adds its own push types). **Standard — for every event type:**

- Every event carries `type` (type discriminator) and `v` (that type's contract version, starting from `1`).
- An **additive change** (a new optional field) does **not** bump `v`; the client ignores a field it does not know.
- A **breaking reshape** (removing/renaming a field or changing its meaning) bumps `v` on the same `type`. A
  **semantically new** push becomes a new `type`.
- The client **silently ignores a `type` it does not recognize OR a `v` it does not recognize** (not an error) — a new event type or
  version bump does not break old clients, it only causes them not to see that push (HTTP re-sync compensates).

## 4. Client behavior

### 4.1 What to do on an event

When an invalidation push is received, the **displayed** read(s) that the event points to are invalidated and re-fetched
(which reads are tied to which event is the application's own mapping). Because the event carries no value, the
client does **not do a blind update**; it only triggers the relevant HTTP read and displays the authoritative
checkpoint returned.

### 4.2 Eliminating one's own echo (`source_sid`)

The HTTP response of the device that **issued the command** already carries the fresh authoritative state; re-fetching a second time
on the WS echo of the same change is unnecessary. Therefore the client **skips** the event if its `source_sid` equals **its own active
session's session id**. If `source_sid == null` (a session-less change) it is not skipped — it is applied.

> **Granularity:** The matching is at the **session** (device) level, not the tab/connection level. Two connections sharing
> the same session (e.g. one session, two tabs) treat each other's echo as "their own echo". Since in the product **one device = one
> session**, this is the correct behavior; separate devices are separate sessions and apply each other's changes.

### 4.3 Reconnection and resync

If the socket has been disconnected for a while (network change, sleep), events may have been **missed** during that time. **On
reconnection**, the client re-fetches **all live production reads + the balance** without waiting for individual events. Likewise, when the
app returns to the **foreground** (`visibilitychange`/foreground), triggering a resync resets the local-projection drift in a long-open
session.

## 5. Delivery guarantees (and non-guarantees)

- **No guarantees:** delivery, ordering, replay, ack — none. An event may arrive twice, never, or
  out of order. The client must be resilient to all of these; the solution is always **re-sync from HTTP**.
- **Idempotent consumption:** If the same event arrives twice, the second re-fetch is harmless (the same checkpoint is returned).
- **Scale/geography transparent to the client:** the event goes to the user-channel; cross-instance fanout is internal to the backend.
- **Scope — invalidation only (rule):** This channel is an _invalidation_ channel, not a general message
  path. Events carry no data (they are a hint about "what became stale"), are unguaranteed (no delivery/ordering/ack),
  and echo-suppression is at session granularity. A need that carries payload or requires ordered or guaranteed delivery
  (e.g. **chat/messaging**, notification history) must **not** reuse this channel — it must be built on a separate channel
  with its own envelope, ordering, persistence, and delivery semantics. This channel's QoS is wrong for chat (a
  lost/duplicate/out-of-order message is unacceptable in chat, normal here).

## 6. Errors and edge cases

- **Handshake rejection:** `connect_error` + contract message (§2.1 table). `unauthorized` → refresh the token and
  reconnect; if the refresh also fails (refresh token dead) the session is over — stop connecting and route the user back to
  authentication (see [`01-auth.md`](./01-auth.md)). `rate_limited` → wait with backoff.
- **Server-initiated disconnect (`io server disconnect`):** there can be two reasons — the access token expiring
  (expected, periodic) or the session being revoked (logout / reuse detection / device-limit eviction). The two are not
  distinguished; the correct response is the same: **try refresh** → if successful, connect with a fresh token; if refresh is rejected, the
  session is over.
- **Reconnection storm:** the client must reconnect with increasing backoff and ensure token freshness (§2.1) before each
  attempt. The two-layer handshake rate limit (per-IP + per-user, §2.1) cuts off tight loops with `rate_limited`.
- **Missed event:** this is normal; §4.3 resync and the next HTTP read correct the state. The channel functioning is
  **not required** for the app — it only speeds up cross-device freshness.
- **Idle connection / proxy timeout:** the server sends a ping every 25s (`pingInterval=25000`,
  `pingTimeout=20000`) — as long as the intervening reverse-proxy's read timeout (e.g. nginx `proxy_read_timeout`,
  default 60s) is longer than this ping period, the idle socket does not drop. The proxy config must make this
  relationship explicit.
