import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';

import { RealtimeMetric } from './realtime-metrics.providers';

@Injectable()
export class RealtimeMetricsService {
  constructor(
    @InjectMetric(RealtimeMetric.ConnectedSockets) private readonly connectedSockets: Gauge,
    @InjectMetric(RealtimeMetric.Handshakes) private readonly handshakes: Counter<'outcome' | 'reason'>,
    @InjectMetric(RealtimeMetric.EventsPublished) private readonly eventsPublished: Counter<'type'>,
    @InjectMetric(RealtimeMetric.Kicks) private readonly kicks: Counter<'kind'>,
    @InjectMetric(RealtimeMetric.AdapterErrors) private readonly adapterErrors: Counter,
  ) {}

  socketConnected(): void {
    this.connectedSockets.inc();
  }

  socketDisconnected(): void {
    this.connectedSockets.dec();
  }

  recordHandshake({ outcome, reason }: { outcome: 'accepted' | 'rejected'; reason?: string }): void {
    this.handshakes.inc({ outcome, reason: reason ?? '' });
  }

  recordEventPublished({ type }: { type: string }): void {
    this.eventsPublished.inc({ type });
  }

  recordKick({ kind }: { kind: 'session' | 'family' | 'user_cap' }): void {
    this.kicks.inc({ kind });
  }

  recordAdapterError(): void {
    this.adapterErrors.inc();
  }
}
