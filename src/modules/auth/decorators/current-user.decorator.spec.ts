import { ExecutionContext } from '@nestjs/common';

import { AppInternalException } from '@shared/exceptions/internal.exception';
import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { CurrentUser } from './current-user.decorator';

describe('CurrentUser', () => {
  const factory = getParamDecoratorFactory(CurrentUser());

  function run(user: { id: string } | undefined): { id: string } {
    const context: ExecutionContext = createMockExecutionContext({ request: createMockRequest({ user }) });

    return factory(undefined, context) as { id: string };
  }

  it('returns the authenticated user from the request', () => {
    expect(run({ id: 'user-1' })).toEqual({ id: 'user-1' });
  });

  it('throws when the request is not authenticated', () => {
    expect(() => run(undefined)).toThrow(AppInternalException);
  });
});
