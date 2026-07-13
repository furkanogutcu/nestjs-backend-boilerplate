import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';

// * Single source of truth for "now"; inject instead of Date.now()/new Date() so tests are deterministic. Accessor per boundary (Luxon DateTime / epoch millis / Date) — see ARCHITECTURE "Kod stili". Monotonic timing uses performance.now(), not this.
@Injectable()
export class ClockService {
  now(): DateTime {
    return DateTime.now();
  }

  epochMillis(): number {
    return Date.now();
  }

  date(): Date {
    return new Date();
  }
}
