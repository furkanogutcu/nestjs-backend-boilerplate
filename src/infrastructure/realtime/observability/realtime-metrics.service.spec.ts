import { createMock } from '@golevelup/ts-jest';
import { Counter, Gauge } from 'prom-client';

import { RealtimeMetricsService } from './realtime-metrics.service';

describe('RealtimeMetricsService', () => {
  let connectedSockets: ReturnType<typeof createMock<Gauge>>;
  let handshakes: ReturnType<typeof createMock<Counter<'outcome' | 'reason'>>>;
  let eventsPublished: ReturnType<typeof createMock<Counter<'type'>>>;
  let kicks: ReturnType<typeof createMock<Counter<'kind'>>>;
  let adapterErrors: ReturnType<typeof createMock<Counter>>;
  let service: RealtimeMetricsService;

  beforeEach(() => {
    connectedSockets = createMock<Gauge>();
    handshakes = createMock<Counter<'outcome' | 'reason'>>();
    eventsPublished = createMock<Counter<'type'>>();
    kicks = createMock<Counter<'kind'>>();
    adapterErrors = createMock<Counter>();
    service = new RealtimeMetricsService(connectedSockets, handshakes, eventsPublished, kicks, adapterErrors);
  });

  it('moves the connected-sockets gauge up on connect and down on disconnect', () => {
    service.socketConnected();
    service.socketDisconnected();

    expect(connectedSockets.inc).toHaveBeenCalledTimes(1);
    expect(connectedSockets.dec).toHaveBeenCalledTimes(1);
  });

  it('records a rejected handshake with its reason label', () => {
    service.recordHandshake({ outcome: 'rejected', reason: 'expired_token' });

    expect(handshakes.inc).toHaveBeenCalledWith({ outcome: 'rejected', reason: 'expired_token' });
  });

  it('records an accepted handshake with an empty reason label when none is given', () => {
    service.recordHandshake({ outcome: 'accepted' });

    expect(handshakes.inc).toHaveBeenCalledWith({ outcome: 'accepted', reason: '' });
  });

  it('records a published event under its type label', () => {
    service.recordEventPublished({ type: 'notification' });

    expect(eventsPublished.inc).toHaveBeenCalledWith({ type: 'notification' });
  });

  it('records a kick under its kind label', () => {
    service.recordKick({ kind: 'family' });

    expect(kicks.inc).toHaveBeenCalledWith({ kind: 'family' });
  });

  it('increments the adapter-error counter on a realtime pub/sub failure', () => {
    service.recordAdapterError();

    expect(adapterErrors.inc).toHaveBeenCalledTimes(1);
  });
});
