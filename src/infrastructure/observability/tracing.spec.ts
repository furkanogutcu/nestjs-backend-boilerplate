import type { IncomingMessage } from 'http';

// * A mutable env the mock reads by reference; each test sets fields before loading the module.
const mockEnv = {
  OTEL_ENABLED: false,
  OTEL_DEBUG: false,
  OTEL_SERVICE_NAME: 'app',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
  OTEL_TRACES_SAMPLER_RATIO: 0.25,
  SERVICE_RELEASE: 'unknown',
  NODE_ENV: 'test',
};

vi.mock('@config/env.config', () => ({ env: mockEnv }));

const startMock = vi.fn();
const shutdownMock = vi.fn<() => Promise<void>>();
const nodeSdkMock = vi.fn().mockImplementation(function () {
  return { start: startMock, shutdown: shutdownMock };
});

const setLoggerMock = vi.fn();
const diagErrorMock = vi.fn();

let capturedHttpOptions: { ignoreIncomingRequestHook?: (req: IncomingMessage) => boolean } = {};

const otlpExporterMock = vi.fn();
const otlpMetricExporterMock = vi.fn();
const metricReaderMock = vi.fn();
const consoleExporterMock = vi.fn();
const resourceFromAttributesMock = vi.fn().mockReturnValue({ resource: true });

vi.mock('@opentelemetry/api', () => ({
  diag: {
    setLogger: (...args: unknown[]) => setLoggerMock(...args),
    error: (...args: unknown[]) => diagErrorMock(...args),
  },
  DiagConsoleLogger: vi.fn(),
  DiagLogLevel: { DEBUG: 'DEBUG' },
}));

vi.mock('@opentelemetry/core', () => ({
  CompositePropagator: vi.fn(),
  W3CBaggagePropagator: vi.fn(),
  W3CTraceContextPropagator: vi.fn(),
}));

vi.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({
  OTLPTraceExporter: vi.fn().mockImplementation(function (opts: unknown) {
    return otlpExporterMock(opts);
  }),
}));

vi.mock('@opentelemetry/exporter-metrics-otlp-proto', () => ({
  OTLPMetricExporter: vi.fn().mockImplementation(function (opts: unknown) {
    return otlpMetricExporterMock(opts);
  }),
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: vi.fn().mockImplementation(function (opts: unknown) {
    return metricReaderMock(opts);
  }),
}));

vi.mock('@opentelemetry/instrumentation-express', () => ({ ExpressInstrumentation: vi.fn() }));
vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: vi.fn().mockImplementation(function (opts: typeof capturedHttpOptions) {
    capturedHttpOptions = opts;
  }),
}));
let capturedIoredisOptions: { dbStatementSerializer?: (command: string) => string } = {};
vi.mock('@opentelemetry/instrumentation-ioredis', () => ({
  IORedisInstrumentation: vi.fn().mockImplementation(function (opts: typeof capturedIoredisOptions) {
    capturedIoredisOptions = opts;
  }),
}));
vi.mock('@opentelemetry/instrumentation-nestjs-core', () => ({ NestInstrumentation: vi.fn() }));
vi.mock('@opentelemetry/instrumentation-pg', () => ({ PgInstrumentation: vi.fn() }));
vi.mock('@opentelemetry/instrumentation-runtime-node', () => ({ RuntimeNodeInstrumentation: vi.fn() }));

vi.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (attrs: unknown) => resourceFromAttributesMock(attrs),
}));

vi.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: nodeSdkMock }));

vi.mock('@opentelemetry/sdk-trace-node', () => ({
  ConsoleSpanExporter: vi.fn().mockImplementation(function () {
    return consoleExporterMock();
  }),
  ParentBasedSampler: vi.fn(),
  TraceIdRatioBasedSampler: vi.fn(),
}));

async function loadTracing(): Promise<{ startTracing: () => void; shutdownTracing: () => Promise<void> }> {
  // * The module starts tracing as an import side effect, so each case needs a fresh registry.
  vi.resetModules();

  return await import('./tracing.js');
}

describe('tracing', () => {
  beforeEach(() => {
    mockEnv.OTEL_ENABLED = false;
    mockEnv.OTEL_DEBUG = false;
    mockEnv.SERVICE_RELEASE = 'unknown';
    mockEnv.NODE_ENV = 'test';
    shutdownMock.mockResolvedValue(undefined);
    capturedHttpOptions = {};
    capturedIoredisOptions = {};
  });

  describe('startup gate', () => {
    it('does not boot the SDK when tracing is disabled', async () => {
      mockEnv.OTEL_ENABLED = false;
      mockEnv.OTEL_DEBUG = false;

      await loadTracing();

      expect(nodeSdkMock).not.toHaveBeenCalled();
      expect(startMock).not.toHaveBeenCalled();
    });

    it('boots the SDK when OTEL_ENABLED is true', async () => {
      mockEnv.OTEL_ENABLED = true;

      await loadTracing();

      expect(nodeSdkMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('boots the SDK in debug mode even when OTEL_ENABLED is false', async () => {
      mockEnv.OTEL_ENABLED = false;
      mockEnv.OTEL_DEBUG = true;

      await loadTracing();

      expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('does not boot a second time once already started (idempotent)', async () => {
      mockEnv.OTEL_ENABLED = true;

      const mod = await loadTracing();
      mod.startTracing();

      expect(startMock).toHaveBeenCalledTimes(1);
      expect(nodeSdkMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('exporter and logger selection', () => {
    it('uses the OTLP exporter and no debug logger in production mode', async () => {
      mockEnv.OTEL_ENABLED = true;
      mockEnv.OTEL_DEBUG = false;

      await loadTracing();

      expect(otlpExporterMock).toHaveBeenCalledWith({ url: 'http://otel-collector:4318/v1/traces' });
      expect(consoleExporterMock).not.toHaveBeenCalled();
      expect(setLoggerMock).not.toHaveBeenCalled();
    });

    it('exports metrics to the OTLP metrics endpoint on a fixed interval', async () => {
      mockEnv.OTEL_ENABLED = true;

      await loadTracing();

      expect(otlpMetricExporterMock).toHaveBeenCalledWith({ url: 'http://otel-collector:4318/v1/metrics' });
      expect(metricReaderMock).toHaveBeenCalledWith(expect.objectContaining({ exportIntervalMillis: 15000 }));
    });

    it('uses the console exporter and a debug logger in debug mode', async () => {
      mockEnv.OTEL_DEBUG = true;

      await loadTracing();

      expect(consoleExporterMock).toHaveBeenCalledTimes(1);
      expect(otlpExporterMock).not.toHaveBeenCalled();
      expect(setLoggerMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to an "unknown" service version when SERVICE_RELEASE is unset', async () => {
      mockEnv.OTEL_ENABLED = true;
      mockEnv.SERVICE_RELEASE = 'unknown';

      await loadTracing();

      expect(resourceFromAttributesMock).toHaveBeenCalledWith(
        expect.objectContaining({ 'service.name': 'app', 'service.version': 'unknown' }),
      );
    });

    it('uses SERVICE_RELEASE as the service version when present', async () => {
      mockEnv.OTEL_ENABLED = true;
      mockEnv.SERVICE_RELEASE = '1.2.3';

      await loadTracing();

      expect(resourceFromAttributesMock).toHaveBeenCalledWith(expect.objectContaining({ 'service.version': '1.2.3' }));
    });
  });

  describe('ignoreIncomingRequestHook', () => {
    async function hookFor(url: string | undefined): Promise<boolean> {
      mockEnv.OTEL_ENABLED = true;
      await loadTracing();

      return capturedHttpOptions.ignoreIncomingRequestHook!({ url } as IncomingMessage);
    }

    it.each([['/health'], ['/api/v1/health'], ['/api/v1/health/ready']])(
      'ignores the operational path %s',
      async (url) => {
        expect(await hookFor(url)).toBe(true);
      },
    );

    it.each([['/api/v1/orders'], ['/'], ['/users/123']])('traces the business path %s', async (url) => {
      expect(await hookFor(url)).toBe(false);
    });

    it('matches operational paths by prefix (a documented over-match)', async () => {
      expect(await hookFor('/healthz-internal')).toBe(true);
    });

    it('treats a missing url as a business path', async () => {
      expect(await hookFor(undefined)).toBe(false);
    });
  });

  describe('redis statement serializer', () => {
    it('records the raw redis command as the db statement', async () => {
      mockEnv.OTEL_ENABLED = true;

      await loadTracing();

      expect(capturedIoredisOptions.dbStatementSerializer!('GET user:42')).toBe('GET user:42');
    });
  });

  describe('shutdownTracing', () => {
    it('shuts the SDK down and tolerates being called twice', async () => {
      mockEnv.OTEL_ENABLED = true;
      const mod = await loadTracing();

      await mod.shutdownTracing();
      await mod.shutdownTracing();

      expect(shutdownMock).toHaveBeenCalledTimes(1);
    });

    it('logs via diag when shutdown rejects instead of throwing', async () => {
      shutdownMock.mockRejectedValueOnce(new Error('shutdown failed'));
      mockEnv.OTEL_ENABLED = true;
      const mod = await loadTracing();

      await expect(mod.shutdownTracing()).resolves.toBeUndefined();
      expect(diagErrorMock).toHaveBeenCalled();
    });

    it('is a no-op when the SDK never started', async () => {
      mockEnv.OTEL_ENABLED = false;
      mockEnv.OTEL_DEBUG = false;
      const mod = await loadTracing();

      await expect(mod.shutdownTracing()).resolves.toBeUndefined();
      expect(shutdownMock).not.toHaveBeenCalled();
    });
  });
});
