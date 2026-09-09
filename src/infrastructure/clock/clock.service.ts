import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';

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
