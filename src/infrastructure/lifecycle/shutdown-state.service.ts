import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ShutdownStateService {
  private readonly logger = new Logger(ShutdownStateService.name);
  private draining = false;

  // * Flipped by the signal handler in main.ts before anything is torn down, so readiness can start
  // * failing while the process is still fully able to serve the requests already in flight.
  beginDrain(): void {
    if (this.draining) {
      return;
    }

    this.draining = true;
    this.logger.log('Draining: readiness now reports unavailable');
  }

  get isDraining(): boolean {
    return this.draining;
  }
}
