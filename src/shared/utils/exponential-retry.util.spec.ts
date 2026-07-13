import { AppInternalException } from '../exceptions/internal.exception';
import { exponentialRetry } from './exponential-retry.util';
import { sleep } from './sleep.util';

jest.mock('./sleep.util');

const sleepMock = sleep as jest.MockedFunction<typeof sleep>;

describe('exponentialRetry', () => {
  beforeEach(() => {
    sleepMock.mockResolvedValue(undefined);
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  it('returns the result on the first successful attempt without sleeping', async () => {
    const fn = jest.fn<Promise<string>, []>().mockResolvedValue('ok');

    await expect(exponentialRetry({ fn })).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('retries after a failure and resolves with a later attempt', async () => {
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    await expect(exponentialRetry({ fn, baseDelayMs: 1000 })).resolves.toBe('recovered');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).toHaveBeenCalledWith(500);
  });

  it('throws the original error after exhausting every attempt', async () => {
    const error = new Error('always fails');
    const fn = jest.fn<Promise<never>, []>().mockRejectedValue(error);

    await expect(exponentialRetry({ fn, maxAttempts: 3, baseDelayMs: 1000 })).rejects.toBe(error);

    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it('wraps a non-Error rejection in an AppInternalException', async () => {
    const fn = jest.fn<Promise<never>, []>().mockRejectedValue('string failure');

    const result = exponentialRetry({ fn, maxAttempts: 1 });

    await expect(result).rejects.toBeInstanceOf(AppInternalException);
    await expect(result).rejects.toHaveProperty('message', 'string failure');
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it('grows the delay exponentially with jitter between attempts', async () => {
    const fn = jest.fn<Promise<never>, []>().mockRejectedValue(new Error('fail'));

    await expect(exponentialRetry({ fn, maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 10000 })).rejects.toThrow();

    expect(sleepMock.mock.calls.map((call) => call[0])).toEqual([50, 100, 200]);
  });

  it('throws a fallback AppInternalException when no attempts are configured', async () => {
    const fn = jest.fn<Promise<never>, []>();

    const result = exponentialRetry({ fn, maxAttempts: 0 });

    await expect(result).rejects.toBeInstanceOf(AppInternalException);
    await expect(result).rejects.toHaveProperty('message', 'Retry attempted with no executions');
    expect(fn).not.toHaveBeenCalled();
  });

  it('caps the exponential delay at maxDelayMs', async () => {
    const fn = jest.fn<Promise<never>, []>().mockRejectedValue(new Error('fail'));

    await expect(exponentialRetry({ fn, maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 1500 })).rejects.toThrow();

    expect(sleepMock.mock.calls.map((call) => call[0])).toEqual([500, 750, 750, 750]);
  });
});
