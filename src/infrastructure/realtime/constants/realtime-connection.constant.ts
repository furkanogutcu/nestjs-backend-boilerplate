// * Cap on a single user's simultaneous live sockets across the whole cluster (all their devices/tabs). A socket
// * that connects past the cap evicts the user's OLDEST connection (newest-wins device semantics, mirroring the
// * session family cap), bounding fan-out cost and stopping a client from silently accumulating zombie sockets.
// * Best-effort hygiene: enforced on connect via the Redis adapter's cluster-wide fetchSockets, fail-open if that
// * lookup errors (a limiter hiccup must never block a legitimate connection).
export const REALTIME_MAX_SOCKETS_PER_USER = 5;

// * engine.io connectTimeout: how long a socket that finished the raw upgrade but never sent the socket.io CONNECT
// * packet is held before being reaped. Lowered from the 45s default so an unauthenticated pre-CONNECT socket (the
// * connection-exhaustion vector the allowRequest gate also bounds) is dropped quickly.
export const REALTIME_CONNECT_TIMEOUT_MS = 10000;
