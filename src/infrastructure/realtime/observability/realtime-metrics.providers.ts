import { makeCounterProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';

export const RealtimeMetric = {
  ConnectedSockets: 'realtime_connected_sockets',
  Handshakes: 'realtime_handshakes_total',
  EventsPublished: 'realtime_events_published_total',
  Kicks: 'realtime_kicks_total',
  AdapterErrors: 'realtime_adapter_errors_total',
} as const;

export const realtimeMetricProviders = [
  makeGaugeProvider({ name: RealtimeMetric.ConnectedSockets, help: 'Current number of connected realtime sockets' }),
  makeCounterProvider({
    name: RealtimeMetric.Handshakes,
    help: 'Total realtime handshake attempts by outcome (reason set on rejections)',
    labelNames: ['outcome', 'reason'],
  }),
  makeCounterProvider({
    name: RealtimeMetric.EventsPublished,
    help: 'Total realtime dispatches through the publisher by event type',
    labelNames: ['type'],
  }),
  makeCounterProvider({
    name: RealtimeMetric.Kicks,
    help: 'Total realtime kick disconnects by kind (session/family revocation, per-user connection cap)',
    labelNames: ['kind'],
  }),
  makeCounterProvider({
    name: RealtimeMetric.AdapterErrors,
    help: 'Total realtime Redis-adapter pub/sub connection errors (cross-instance kick/socket-cap transport health)',
  }),
];
