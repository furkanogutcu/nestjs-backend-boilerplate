import type { RealtimeEvent } from '../schemas/realtime-event.schema';

// * Provider-agnostic realtime publish port. `publishToUser` fans an ephemeral event to every live connection
// * of one user (all their devices/tabs, on any instance); `publishGlobal` to every connection. Best-effort,
// * fire-and-forget — no ack, no replay, no ordering guarantee. The disconnect pair is best-effort connection
// * hygiene for session_revoked kicks (enforcement lives in the revocation denylist, not here). Bound to a driver
// * (socket.io / log) by RealtimeModule via the REALTIME_PUBLISHER token.
export interface IRealtimePublisher {
  publishToUser(params: { userId: string; event: RealtimeEvent }): void;
  publishGlobal(params: { event: RealtimeEvent }): void;
  disconnectSession(params: { sessionId: string }): void;
  disconnectFamily(params: { familyId: string }): void;
}
