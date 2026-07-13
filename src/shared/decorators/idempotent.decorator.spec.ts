import { Reflector } from '@nestjs/core';

import { IdempotencyPrincipalSource } from '../enums/idempotency-principal-source.enum';
import { Idempotent, IDEMPOTENT_KEY } from './idempotent.decorator';

describe('Idempotent', () => {
  const reflector = new Reflector();

  it('defaults the principal source to User', () => {
    class Target {
      @Idempotent({ scope: 'auth:guest', responseTtlSeconds: 120 })
      handler(): string {
        return 'ok';
      }
    }

    expect(reflector.get(IDEMPOTENT_KEY, Target.prototype.handler)).toEqual({
      scope: 'auth:guest',
      responseTtlSeconds: 120,
      principalSource: IdempotencyPrincipalSource.User,
      required: false,
    });
  });

  it('defaults required to false and keeps an explicit required: true', () => {
    class Target {
      @Idempotent({ scope: 'production:facility:purchase', responseTtlSeconds: 300, required: true })
      handler(): string {
        return 'ok';
      }
    }

    expect(reflector.get(IDEMPOTENT_KEY, Target.prototype.handler)).toMatchObject({ required: true });
  });

  it('keeps an explicitly provided principal source', () => {
    class Target {
      @Idempotent({
        scope: 'auth:guest',
        responseTtlSeconds: 120,
        principalSource: IdempotencyPrincipalSource.Anonymous,
      })
      handler(): string {
        return 'ok';
      }
    }

    expect(reflector.get(IDEMPOTENT_KEY, Target.prototype.handler)).toMatchObject({
      principalSource: IdempotencyPrincipalSource.Anonymous,
    });
  });
});
