// * Kafka consumer-group id for the realtime fanout bridge. A single stable group across instances so the
// * SessionRevoked partitions are balanced over the gateway nodes (each event handled once per group, then the
// * owning instance kicks the matching sockets).
export const REALTIME_FANOUT_CONSUMER_GROUP = 'realtime-fanout';
