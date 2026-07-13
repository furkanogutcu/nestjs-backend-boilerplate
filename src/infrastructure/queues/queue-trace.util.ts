import { Context, context, propagation } from '@opentelemetry/api';

export const OTEL_JOB_KEY = '_otel';

type WithJobTrace<T> = T & { [OTEL_JOB_KEY]: Record<string, string> };

export function withJobTrace<T extends object>(data: T): WithJobTrace<T> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);

  return { ...data, [OTEL_JOB_KEY]: carrier };
}

export function extractJobTrace(data: unknown): Context {
  const carrier = (data as Record<string, unknown> | null)?.[OTEL_JOB_KEY];

  return propagation.extract(context.active(), (carrier ?? {}) as Record<string, string>);
}
