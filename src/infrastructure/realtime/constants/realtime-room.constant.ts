// * socket.io room names. User-scoped events go to a per-user room (every device/tab of that user joins it on the
// * authenticated handshake, which also lets a per-user connection cap enumerate and evict that user's sockets
// * cluster-wide); global events to the shared room. Room membership — not the wire payload — is what scopes
// * delivery. The session/family rooms carry no events — they exist so a session_revoked kick can target exactly
// * the revoked credential's sockets (the Redis adapter propagates disconnectSockets across instances).
export const realtimeUserRoom = (userId: string): string => `user:${userId}`;

export const realtimeSessionRoom = (sessionId: string): string => `session:${sessionId}`;

export const realtimeFamilyRoom = (familyId: string): string => `family:${familyId}`;

export const REALTIME_GLOBAL_ROOM = 'global';
