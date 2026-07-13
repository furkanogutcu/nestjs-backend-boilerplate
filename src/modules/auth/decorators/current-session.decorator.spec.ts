import { ExecutionContext } from '@nestjs/common';

import { AppInternalException } from '@shared/exceptions/internal.exception';
import { createMockExecutionContext, createMockRequest, getParamDecoratorFactory } from '@test/helpers';

import { CurrentSession } from './current-session.decorator';

describe('CurrentSession', () => {
  const factory = getParamDecoratorFactory(CurrentSession());

  function run(session: { id: string; familyId: string } | undefined): { id: string; familyId: string } {
    const context: ExecutionContext = createMockExecutionContext({ request: createMockRequest({ session }) });

    return factory(undefined, context) as { id: string; familyId: string };
  }

  it('returns the authenticated session from the request', () => {
    expect(run({ id: 'session-1', familyId: 'family-1' })).toEqual({ id: 'session-1', familyId: 'family-1' });
  });

  it('throws when the request is not authenticated', () => {
    expect(() => run(undefined)).toThrow(AppInternalException);
  });
});
