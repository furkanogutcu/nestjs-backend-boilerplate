import { Logger } from '@nestjs/common';

import type { RealtimeEvent } from '../schemas/realtime-event.schema';
import { LogRealtimePublisher } from './log-realtime.publisher';

const event: RealtimeEvent = {
  type: 'notification',
  v: 1,
  emitted_at: '2026-06-20T10:00:00.000Z',
  data: { title: 'Hello' },
};

describe('LogRealtimePublisher', () => {
  let logSpy: jest.SpyInstance;
  let publisher: LogRealtimePublisher;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    publisher = new LogRealtimePublisher();
  });

  it('logs a user push with the target user and event type instead of pushing', () => {
    publisher.publishToUser({ userId: 'user-1', event });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user-1'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('notification'));
  });

  it('logs a global push with the event type instead of pushing', () => {
    publisher.publishGlobal({ event });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('notification'));
  });

  it('logs a session kick with the session id instead of disconnecting a socket', () => {
    publisher.disconnectSession({ sessionId: 'sess-1' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('sess-1'));
  });

  it('logs a family kick with the family id instead of disconnecting sockets', () => {
    publisher.disconnectFamily({ familyId: 'fam-1' });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('fam-1'));
  });
});
