import { sleep } from './sleep.util';

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves only after the given delay elapses', async () => {
    const onResolved = vi.fn();

    const pending = sleep(1000).then(onResolved);

    await vi.advanceTimersByTimeAsync(999);
    expect(onResolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('schedules a single timer with the requested duration', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const pending = sleep(2500);
    await vi.advanceTimersByTimeAsync(2500);
    await pending;

    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2500);
  });

  it('resolves immediately for a zero delay', async () => {
    const pending = sleep(0);
    await vi.advanceTimersByTimeAsync(0);

    await expect(pending).resolves.toBeUndefined();
  });
});
