vi.mock('@config/env.config', () => ({ env: { NODE_ENV: 'production' } }));

import { env } from '@config/env.config';
import { AppForbiddenException } from '@shared/exceptions/forbidden.exception';
import { createMockExecutionContext, createMockRequest } from '@test/helpers';

import { RequireHttpsGuard } from './require-https.guard';

function setNodeEnv(value: string): void {
  (env as { NODE_ENV: string }).NODE_ENV = value;
}

describe('RequireHttpsGuard', () => {
  const guard = new RequireHttpsGuard();

  it('allows any request outside production', () => {
    setNodeEnv('test');
    const context = createMockExecutionContext({ request: createMockRequest({ secure: false }) });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows secure requests in production', () => {
    setNodeEnv('production');
    const context = createMockExecutionContext({ request: createMockRequest({ secure: true }) });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects insecure requests in production', () => {
    setNodeEnv('production');
    const context = createMockExecutionContext({ request: createMockRequest({ secure: false }) });

    expect(() => guard.canActivate(context)).toThrow(AppForbiddenException);
  });
});
