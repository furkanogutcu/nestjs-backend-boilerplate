import { ExecutionContext } from '@nestjs/common';

import { AppValidationException } from '@shared/exceptions/validation.exception';
import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { IClientHeaders } from '../interfaces/client-headers.interface';
import { ClientHeaders } from './client-headers.decorator';

describe('ClientHeaders', () => {
  const factory = getParamDecoratorFactory(ClientHeaders());

  function run(headers: Record<string, string | string[] | undefined>): IClientHeaders {
    const context: ExecutionContext = createMockExecutionContext({ request: createMockRequest({ headers }) });

    return factory(undefined, context) as IClientHeaders;
  }

  it('extracts the user-agent and idempotency-key headers', () => {
    expect(run({ 'user-agent': 'jest', 'idempotency-key': 'a'.repeat(20) })).toEqual({
      userAgent: 'jest',
      idempotencyKey: 'a'.repeat(20),
    });
  });

  it('returns undefined for absent headers', () => {
    expect(run({})).toEqual({ userAgent: undefined, idempotencyKey: undefined });
  });

  it('takes the first value when a header is sent multiple times', () => {
    expect(run({ 'user-agent': ['first', 'second'] })).toMatchObject({ userAgent: 'first' });
  });

  it('rejects a too-short idempotency-key', () => {
    expect(() => run({ 'idempotency-key': 'short' })).toThrow(AppValidationException);
  });

  it('rejects a too-long idempotency-key', () => {
    expect(() => run({ 'idempotency-key': 'a'.repeat(129) })).toThrow(AppValidationException);
  });
});
