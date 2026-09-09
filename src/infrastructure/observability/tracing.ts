import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { env } from '@config/env.config';

import { ScrubbingSpanExporter } from './scrubbing-span.exporter';

const METRIC_EXPORT_INTERVAL_MS = 15000;

let sdk: NodeSDK | undefined;

export function startTracing(): void {
  const shouldStart = env.OTEL_ENABLED || env.OTEL_DEBUG;

  if (shouldStart === false || sdk) {
    return;
  }

  if (env.OTEL_DEBUG) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: env.OTEL_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: env.SERVICE_RELEASE,
    'deployment.environment': env.NODE_ENV,
  });

  // ! Every exporter is wrapped: scrubbing at the SDK boundary is what keeps caller IPs and query strings
  // ! out of the trace backend, and the console exporter is used in debug runs on real request data too.
  const traceExporter = new ScrubbingSpanExporter(
    env.OTEL_DEBUG
      ? new ConsoleSpanExporter()
      : new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
  );

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics` }),
      exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(env.OTEL_TRACES_SAMPLER_RATIO) }),
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? '';

          return ['/health', '/api/v1/health'].some((path) => url.startsWith(path));
        },
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation({ requireParentSpan: true }),
      new IORedisInstrumentation({ requireParentSpan: true, dbStatementSerializer: (command) => command }),
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();

  process.once('SIGTERM', () => {
    void sdk?.shutdown().catch((error) => diag.error('OpenTelemetry shutdown failed', error));
  });
}

startTracing();
