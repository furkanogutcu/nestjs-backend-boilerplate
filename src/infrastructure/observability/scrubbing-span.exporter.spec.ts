import { ExportResult, ExportResultCode } from '@opentelemetry/core';
import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-node';

import { ScrubbingSpanExporter } from './scrubbing-span.exporter';

function spanWith(attributes: Record<string, unknown>): ReadableSpan {
  return { attributes } as unknown as ReadableSpan;
}

function innerExporter(): { exporter: SpanExporter; exported: ReadableSpan[][] } {
  const exported: ReadableSpan[][] = [];

  return {
    exported,
    exporter: {
      export: (spans: ReadableSpan[], done: (result: ExportResult) => void) => {
        exported.push(spans);
        done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: async () => {},
      forceFlush: async () => {},
    },
  };
}

describe('ScrubbingSpanExporter', () => {
  it('drops every personal-data attribute the http instrumentation records', () => {
    const { exporter, exported } = innerExporter();
    const span = spanWith({
      'client.address': '203.0.113.7',
      'network.peer.address': '10.0.0.4',
      'network.peer.port': 54321,
      'url.query': 'token=secret',
      'user_agent.original': 'App/1.0 (iPhone; iOS 26.0)',
      'url.path': '/api/v1/me',
      'http.route': '/api/v1/me',
    });

    new ScrubbingSpanExporter(exporter).export([span], vi.fn());

    expect(exported[0][0].attributes).toEqual({ 'url.path': '/api/v1/me', 'http.route': '/api/v1/me' });
  });

  it('strips the query string from url.full but keeps the path', () => {
    const { exporter, exported } = innerExporter();
    const span = spanWith({ 'url.full': 'https://api.example.com/auth/reset?token=super-secret' });

    new ScrubbingSpanExporter(exporter).export([span], vi.fn());

    expect(exported[0][0].attributes).toEqual({ 'url.full': 'https://api.example.com/auth/reset' });
  });

  it('leaves a span without scrubbable attributes untouched', () => {
    const { exporter, exported } = innerExporter();
    const span = spanWith({ 'db.system': 'postgresql', 'http.route': '/api/v1/orders' });

    new ScrubbingSpanExporter(exporter).export([span], vi.fn());

    expect(exported[0][0].attributes).toEqual({ 'db.system': 'postgresql', 'http.route': '/api/v1/orders' });
  });

  it('passes the export result through to the caller', () => {
    const { exporter } = innerExporter();
    const done = vi.fn();

    new ScrubbingSpanExporter(exporter).export([spanWith({})], done);

    expect(done).toHaveBeenCalledWith({ code: ExportResultCode.SUCCESS });
  });

  it('delegates shutdown and forceFlush to the wrapped exporter', async () => {
    const inner = { export: vi.fn(), shutdown: vi.fn(async () => {}), forceFlush: vi.fn(async () => {}) };
    const scrubbing = new ScrubbingSpanExporter(inner);

    await scrubbing.shutdown();
    await scrubbing.forceFlush();

    expect(inner.shutdown).toHaveBeenCalled();
    expect(inner.forceFlush).toHaveBeenCalled();
  });

  it('tolerates a wrapped exporter that does not implement forceFlush', async () => {
    const inner = { export: vi.fn(), shutdown: vi.fn(async () => {}) };

    await expect(new ScrubbingSpanExporter(inner).forceFlush()).resolves.toBeUndefined();
  });
});
