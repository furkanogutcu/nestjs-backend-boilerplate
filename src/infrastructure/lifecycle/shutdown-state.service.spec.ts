import { Logger } from '@nestjs/common';

import { ShutdownStateService } from './shutdown-state.service';

describe('ShutdownStateService', () => {
  let service: ShutdownStateService;

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new ShutdownStateService();
  });

  it('does not report draining before a signal arrives', () => {
    expect(service.isDraining).toBe(false);
  });

  it('reports draining once the drain has begun', () => {
    service.beginDrain();

    expect(service.isDraining).toBe(true);
  });

  it('logs the transition exactly once even if the drain is triggered again', () => {
    const log = vi.spyOn(Logger.prototype, 'log');

    service.beginDrain();
    service.beginDrain();

    expect(service.isDraining).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
