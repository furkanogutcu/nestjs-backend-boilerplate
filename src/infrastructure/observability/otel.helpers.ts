import { trace } from '@opentelemetry/api';

export interface ITraceIds {
  trace_id: string;
  span_id: string;
}

export function getCurrentTraceIds(): ITraceIds | undefined {
  const spanContext = trace.getActiveSpan()?.spanContext();

  if (!spanContext) {
    return undefined;
  }

  return { trace_id: spanContext.traceId, span_id: spanContext.spanId };
}
