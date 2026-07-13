import { AppInternalException } from '../exceptions/internal.exception';
import { sleep } from './sleep.util';

export interface IExponentialRetryParams<T> {
  fn: () => Promise<T>;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function exponentialRetry<T>(params: IExponentialRetryParams<T>): Promise<T> {
  const { fn, maxAttempts = 3, baseDelayMs = 2000, maxDelayMs = 30000 } = params;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new AppInternalException({ message: String(error) });

      if (attempt === maxAttempts) break;

      const exponentialDelay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delayWithJitter = Math.random() * exponentialDelay;

      await sleep(delayWithJitter);
    }
  }

  throw lastError ?? new AppInternalException({ message: 'Retry attempted with no executions' });
}
