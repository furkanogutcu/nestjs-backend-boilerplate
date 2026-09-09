import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ShutdownStateService {
  private readonly logger = new Logger(ShutdownStateService.name);
  private draining = false;

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
