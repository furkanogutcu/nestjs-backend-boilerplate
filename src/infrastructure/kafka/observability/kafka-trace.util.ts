import { Context, context, propagation, TextMapGetter, TextMapSetter, trace } from '@opentelemetry/api';

const bufferHeaderGetter: TextMapGetter<Record<string, Buffer>> = {
  keys: (carrier) => Object.keys(carrier),
  // eslint-disable-next-line no-restricted-syntax -- OpenTelemetry TextMapGetter.get signature is fixed (carrier, key)
  get: (carrier, key) => carrier[key]?.toString(),
};

const headerSetter: TextMapSetter<Record<string, string | Buffer>> = {
  // eslint-disable-next-line no-restricted-syntax -- OpenTelemetry TextMapSetter.set signature is fixed (carrier, key, value)
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};

export function extractTraceContext(headers: Record<string, Buffer>): Context {
  return propagation.extract(context.active(), headers, bufferHeaderGetter);
}

export function injectTraceContext<T extends Record<string, string | Buffer>>(carrier: T): T {
  propagation.inject(context.active(), carrier, headerSetter);

  return carrier;
}

export function hasActiveTrace(): boolean {
  return trace.getActiveSpan() !== undefined;
}
