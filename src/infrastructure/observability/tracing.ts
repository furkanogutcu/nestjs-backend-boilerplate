import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

import { env } from '@config/env.config';

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
    [ATTR_SERVICE_VERSION]: env.SENTRY_RELEASE ?? 'unknown',
    'deployment.environment': env.NODE_ENV,
  });

  const traceExporter = env.OTEL_DEBUG
    ? new ConsoleSpanExporter()
    : new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(env.OTEL_TRACES_SAMPLER_RATIO) }),
    textMapPropagator: new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => {
          const url = req.url ?? '';

          return ['/health', '/metrics', '/api/v1/health', '/api/v1/metrics'].some((path) => url.startsWith(path));
        },
      }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation({ requireParentSpan: true }),
      new IORedisInstrumentation({ requireParentSpan: true, dbStatementSerializer: (command) => command }),
    ],
  });

  sdk.start();

  process.once('SIGTERM', () => {
    void sdk?.shutdown().catch((error) => diag.error('OpenTelemetry shutdown failed', error));
  });
}

startTracing();
