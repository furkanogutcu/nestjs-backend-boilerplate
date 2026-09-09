import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-node';
import {
  ATTR_CLIENT_ADDRESS,
  ATTR_NETWORK_PEER_ADDRESS,
  ATTR_NETWORK_PEER_PORT,
  ATTR_URL_FULL,
  ATTR_URL_QUERY,
  ATTR_USER_AGENT_ORIGINAL,
} from '@opentelemetry/semantic-conventions';

// ! HTTP spans carry caller IP, user agent and query string — personal data that must not reach the trace backend.
const SCRUBBED_SPAN_ATTRIBUTES = [
  ATTR_CLIENT_ADDRESS,
  ATTR_NETWORK_PEER_ADDRESS,
  ATTR_NETWORK_PEER_PORT,
  ATTR_URL_QUERY,
  ATTR_USER_AGENT_ORIGINAL,
] as const;

export class ScrubbingSpanExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  // eslint-disable-next-line no-restricted-syntax -- SpanExporter.export signature is fixed (spans, resultCallback)
  export(spans: ReadableSpan[], resultCallback: Parameters<SpanExporter['export']>[1]): void {
    for (const span of spans) {
      const attributes = span.attributes as Record<string, unknown>;

      for (const key of SCRUBBED_SPAN_ATTRIBUTES) {
        delete attributes[key];
      }

      const fullUrl = attributes[ATTR_URL_FULL];

      // * url.full survives scrubbing because the path is useful, but its query string can carry tokens.
      if (typeof fullUrl === 'string') {
        attributes[ATTR_URL_FULL] = fullUrl.split('?')[0];
      }
    }

    this.inner.export(spans, resultCallback);
  }

  async shutdown(): Promise<void> {
    await this.inner.shutdown();
  }

  async forceFlush(): Promise<void> {
    await this.inner.forceFlush?.();
  }
}
