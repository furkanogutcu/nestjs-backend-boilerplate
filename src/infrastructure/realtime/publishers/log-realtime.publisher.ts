import { Injectable, Logger } from '@nestjs/common';

import type { IRealtimePublisher } from '../interfaces/realtime-publisher.interface';
import type { RealtimeEvent } from '../schemas/realtime-event.schema';

// * No-op driver for non-production / tests: opens no WebSocket server, just logs what would be dispatched.
// * Selected via REALTIME_DRIVER=log (the default outside production), so a unit/e2e run never binds a socket.
// * Mirrors the LogMailTransport pattern.
@Injectable()
export class LogRealtimePublisher implements IRealtimePublisher {
  private readonly logger = new Logger(LogRealtimePublisher.name);

  publishToUser({ userId, event }: { userId: string; event: RealtimeEvent }): void {
    this.logger.log(`Realtime (log driver — not pushed) → user=${userId} type=${event.type}`);
  }

  publishGlobal({ event }: { event: RealtimeEvent }): void {
    this.logger.log(`Realtime (log driver — not pushed) → global type=${event.type}`);
  }

  disconnectSession({ sessionId }: { sessionId: string }): void {
    this.logger.log(`Realtime (log driver — no socket) → kick session=${sessionId}`);
  }

  disconnectFamily({ familyId }: { familyId: string }): void {
    this.logger.log(`Realtime (log driver — no socket) → kick family=${familyId}`);
  }
}
