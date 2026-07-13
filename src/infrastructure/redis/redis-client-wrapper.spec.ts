import { createMock } from '@golevelup/ts-jest';
import { Redis } from 'ioredis';

import { AppServiceUnavailableException } from '@shared/exceptions/service-unavailable.exception';

import { isRedisConnectivityError, wrapRedisClient } from './redis-client-wrapper';

describe('isRedisConnectivityError', () => {
  it('flags MaxRetriesPerRequestError', () => {
    const error = new Error('reached the max retries per request limit');
    error.name = 'MaxRetriesPerRequestError';

    expect(isRedisConnectivityError(error)).toBe(true);
  });

  it.each(['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'])(
    'flags the socket error code %s',
    (code) => {
      const error = Object.assign(new Error('socket error'), { code });

      expect(isRedisConnectivityError(error)).toBe(true);
    },
  );

  it.each([
    "Stream isn't writeable and enableOfflineQueue options is false",
    'Command timed out',
    'Connection is closed.',
  ])('flags the transport message "%s"', (message) => {
    expect(isRedisConnectivityError(new Error(message))).toBe(true);
  });

  it('does not flag a ReplyError (server-side error, not an outage)', () => {
    const error = new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
    error.name = 'ReplyError';

    expect(isRedisConnectivityError(error)).toBe(false);
  });

  it('does not flag an arbitrary error or a non-error value', () => {
    expect(isRedisConnectivityError(new Error('boom'))).toBe(false);
    expect(isRedisConnectivityError('nope')).toBe(false);
  });
});

describe('wrapRedisClient', () => {
  it('passes through a resolved command result', async () => {
    const client = createMock<Redis>();
    client.get.mockResolvedValue('value');

    await expect(wrapRedisClient(client).get('k')).resolves.toBe('value');
  });

  it('returns a synchronous command result without attaching promise handling', () => {
    const client = createMock<Redis>();
    // * EventEmitter helpers on the client (e.g. listenerCount) return synchronously and must bypass the .catch() wrapper.
    client.listenerCount.mockReturnValue(3);

    expect(wrapRedisClient(client).listenerCount('connect')).toBe(3);
  });

  it('maps a connectivity error to a 503', async () => {
    const client = createMock<Redis>();
    client.set.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    await expect(wrapRedisClient(client).set('k', 'v')).rejects.toBeInstanceOf(AppServiceUnavailableException);
  });

  it('passes a ReplyError through untouched', async () => {
    const client = createMock<Redis>();
    const replyError = new Error('WRONGTYPE');
    replyError.name = 'ReplyError';
    client.get.mockRejectedValue(replyError);

    await expect(wrapRedisClient(client).get('k')).rejects.toBe(replyError);
  });

  it('returns non-function properties unchanged', () => {
    const client = createMock<Redis>();
    Object.assign(client, { status: 'ready' });

    expect(wrapRedisClient(client).status).toBe('ready');
  });
});
