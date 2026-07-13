// * DI token for the active realtime publisher (an IRealtimePublisher). Consumers (the Kafka → client fanout
// * bridge) depend only on this token + the interface, never on a concrete driver — RealtimeModule binds it to
// * the socket.io gateway or the no-op log publisher selected by env.REALTIME_DRIVER, so swapping the transport
// * (e.g. to Centrifugo) later is a one-line change with no consumer edits.
export const REALTIME_PUBLISHER = Symbol('REALTIME_PUBLISHER');
