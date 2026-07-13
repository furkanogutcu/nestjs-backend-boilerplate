import { Global, Module, Provider } from '@nestjs/common';

import { env } from '@config/env.config';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { KafkaModule } from '@infrastructure/kafka/kafka.module';

import { REALTIME_PUBLISHER } from './constants/realtime-publisher.constant';
import { RealtimeFanoutConsumer } from './consumers/realtime-fanout.consumer';
import { RealtimeGateway } from './gateway/realtime.gateway';
import { realtimeMetricProviders } from './observability/realtime-metrics.providers';
import { RealtimeMetricsService } from './observability/realtime-metrics.service';
import { LogRealtimePublisher } from './publishers/log-realtime.publisher';

// * Driver-conditional (env.REALTIME_DRIVER), evaluated at module load like MailModule. Three modes:
// *  - socketio: the gateway holds the io server + IS the publisher, and the Kafka → client fanout consumer runs.
// *              Production transport (env schema requires socketio in production).
// *  - log:      no gateway/socket; the fanout consumer still runs and the log publisher records what WOULD be
// *              kicked (dev/debug observability of the full pipeline without a live socket).
// *  - off:      nothing wired — no gateway, no consumer, no Kafka realtime group, no publisher.
// * Producers always emit session_revoked events into the outbox regardless of driver (standard outbox: the
// * producer is decoupled from consumers); under `off` no fanout consumes them, so they are simply not delivered,
// * which is fine (best-effort). @Global so the fanout injects REALTIME_PUBLISHER without importing this module.
const realtimeProviders: Provider[] = ((): Provider[] => {
  // * Metrics are registered under both live drivers so /metrics always exposes the realtime series: under
  // * socketio the gateway records sockets/handshakes/kicks; under log nothing increments (no socket), the
  // * series just report zero instead of disappearing.
  const observabilityProviders: Provider[] = [...realtimeMetricProviders, RealtimeMetricsService];

  switch (env.REALTIME_DRIVER) {
    case 'socketio':
      return [
        ...observabilityProviders,
        RealtimeGateway,
        { provide: REALTIME_PUBLISHER, useExisting: RealtimeGateway },
        RealtimeFanoutConsumer,
      ];
    case 'log':
      return [
        ...observabilityProviders,
        { provide: REALTIME_PUBLISHER, useClass: LogRealtimePublisher },
        RealtimeFanoutConsumer,
      ];
    default:
      return [];
  }
})();

@Global()
@Module({
  imports: [KafkaModule, DatabaseModule],
  providers: realtimeProviders,
  exports: env.REALTIME_DRIVER === 'off' ? [] : [REALTIME_PUBLISHER],
})
export class RealtimeModule {}
