import { DateTime } from 'luxon';

import { ClockService } from './clock.service';

describe('ClockService', () => {
  let clock: ClockService;
  const fixed = new Date('2026-06-04T10:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixed);
    clock = new ClockService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('epochMillis returns the current instant as epoch milliseconds', () => {
    expect(clock.epochMillis()).toBe(fixed.getTime());
  });

  it('date returns the current instant as a Date', () => {
    const result = clock.date();

    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBe(fixed.getTime());
  });

  it('now returns the current instant as a Luxon DateTime', () => {
    const result = clock.now();

    expect(result).toBeInstanceOf(DateTime);
    expect(result.toMillis()).toBe(fixed.getTime());
  });
});
