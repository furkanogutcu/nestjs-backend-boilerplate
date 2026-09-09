import { Redis } from 'ioredis';

import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';

const CONNECTIVITY_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

export function isRedisConnectivityError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === 'MaxRetriesPerRequestError') {
    return true;
  }

  const code = (error as NodeJS.ErrnoException).code;

  if (code !== undefined && CONNECTIVITY_ERROR_CODES.has(code)) {
    return true;
  }

  const message = error.message.toLowerCase();

  return (
    // * ioredis when disconnected with enableOfflineQueue:false
    message.includes('enableofflinequeue') ||
    message.includes('command timed out') ||
    message.includes('connection is closed')
  );
}

// ! Fail-closed: a connectivity error surfaces as a 503 rather than letting the caller proceed without Redis.
export function wrapRedisClient(client: Redis): Redis {
  return new Proxy(client, {
    // eslint-disable-next-line no-restricted-syntax -- Proxy "get" trap has a fixed (target, property, receiver) signature
    get(target, property, receiver): unknown {
      const value: unknown = Reflect.get(target, property, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      const command = value as (...args: unknown[]) => unknown;

      return (...args: unknown[]): unknown => {
        const result = command.apply(target, args);

        if (!(result instanceof Promise)) {
          return result;
        }

        return result.catch((error: unknown) => {
          if (isRedisConnectivityError(error)) {
            throw new AppServiceUnavailableException();
          }

          throw error;
        });
      };
    },
  });
}
