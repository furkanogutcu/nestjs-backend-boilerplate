import { Global, MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import {
  makeCounterProvider,
  makeHistogramProvider,
  PrometheusModule as NestPrometheusModule,
} from '@willsoto/nestjs-prometheus';
import basicAuth from 'express-basic-auth';
import { register, Registry, RegistryContentType } from 'prom-client';

import { versioningConfig } from '@config/app.config';
import { env } from '@config/env.config';
import { MetricsInterceptor } from '@shared/interceptors/metrics.interceptor';

import { MetricsController } from './metrics.controller';

// * Exemplars require an OpenMetrics registry; this must be set before any exemplar-enabled metric is created during DI.
(register as Registry<RegistryContentType>).setContentType(Registry.OPENMETRICS_CONTENT_TYPE);

const httpDurationProvider = makeHistogramProvider({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  enableExemplars: true,
});

const httpRequestsProvider = makeCounterProvider({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

@Global()
@Module({
  imports: [
    NestPrometheusModule.register({
      controller: MetricsController,
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [MetricsInterceptor, httpDurationProvider, httpRequestsProvider],
  exports: [NestPrometheusModule, MetricsInterceptor, httpDurationProvider, httpRequestsProvider],
})
export class PrometheusModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    const metricsUser = env.METRICS_AUTH_USER;
    const metricsPassword = env.METRICS_AUTH_PASSWORD;

    // * Gate on the credentials being configured, not on NODE_ENV: any environment that reaches an untrusted
    // * network (staging, a preview deploy) must protect /metrics the moment creds exist. Production still forces
    // * the creds via env.schema, so the gate is effectively mandatory there.
    if (metricsUser && metricsPassword) {
      consumer
        .apply(
          basicAuth({
            users: { [metricsUser]: metricsPassword },
            challenge: true,
            realm: 'Metrics',
          }),
        )
        .forRoutes({
          path: `${versioningConfig.prefix}${versioningConfig.defaultVersion}/metrics`,
          method: RequestMethod.GET,
        });
    }
  }
}
