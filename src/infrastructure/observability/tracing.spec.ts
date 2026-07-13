/* eslint-disable @typescript-eslint/no-require-imports -- isolateModules requires a dynamic require per scenario */
import type { IncomingMessage } from 'http';

// * A mutable env the mock reads by reference; each test sets fields before loading the module.
const mockEnv = {
  OTEL_ENABLED: false,
  OTEL_DEBUG: false,
  OTEL_SERVICE_NAME: 'app',
  OTEL_EXPORTER_OTLP_ENDPOINT: 'http://otel-collector:4318',
  OTEL_TRACES_SAMPLER_RATIO: 0.25,
  SENTRY_RELEASE: undefined as string | undefined,
  NODE_ENV: 'test',
};

jest.mock('@config/env.config', () => ({ env: mockEnv }));

const startMock = jest.fn();
const shutdownMock = jest.fn<Promise<void>, []>();
const nodeSdkMock = jest.fn().mockImplementation(() => ({ start: startMock, shutdown: shutdownMock }));

const setLoggerMock = jest.fn();
const diagErrorMock = jest.fn();

let capturedHttpOptions: { ignoreIncomingRequestHook?: (req: IncomingMessage) => boolean } = {};

const otlpExporterMock = jest.fn();
const consoleExporterMock = jest.fn();
const resourceFromAttributesMock = jest.fn().mockReturnValue({ resource: true });

jest.mock('@opentelemetry/api', () => ({
  diag: {
    setLogger: (...args: unknown[]) => setLoggerMock(...args),
    error: (...args: unknown[]) => diagErrorMock(...args),
  },
  DiagConsoleLogger: jest.fn(),
  DiagLogLevel: { DEBUG: 'DEBUG' },
}));

jest.mock('@opentelemetry/core', () => ({
  CompositePropagator: jest.fn(),
  W3CBaggagePropagator: jest.fn(),
  W3CTraceContextPropagator: jest.fn(),
}));

jest.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({
  OTLPTraceExporter: jest.fn().mockImplementation((opts: unknown) => otlpExporterMock(opts)),
}));

jest.mock('@opentelemetry/instrumentation-express', () => ({ ExpressInstrumentation: jest.fn() }));
jest.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: jest.fn().mockImplementation((opts: typeof capturedHttpOptions) => {
    capturedHttpOptions = opts;
  }),
}));
let capturedIoredisOptions: { dbStatementSerializer?: (command: string) => string } = {};
jest.mock('@opentelemetry/instrumentation-ioredis', () => ({
  IORedisInstrumentation: jest.fn().mockImplementation((opts: typeof capturedIoredisOptions) => {
    capturedIoredisOptions = opts;
  }),
}));
jest.mock('@opentelemetry/instrumentation-nestjs-core', () => ({ NestInstrumentation: jest.fn() }));
jest.mock('@opentelemetry/instrumentation-pg', () => ({ PgInstrumentation: jest.fn() }));

jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: (attrs: unknown) => resourceFromAttributesMock(attrs),
}));

jest.mock('@opentelemetry/sdk-node', () => ({ NodeSDK: nodeSdkMock }));

jest.mock('@opentelemetry/sdk-trace-node', () => ({
  ConsoleSpanExporter: jest.fn().mockImplementation(() => consoleExporterMock()),
  ParentBasedSampler: jest.fn(),
  TraceIdRatioBasedSampler: jest.fn(),
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
  ATTR_SERVICE_VERSION: 'service.version',
}));

function loadTracing(): { startTracing: () => void } {
  let mod!: { startTracing: () => void };

  jest.isolateModules(() => {
    mod = require('./tracing') as { startTracing: () => void };
  });

  return mod;
}

describe('tracing', () => {
  // * Stub process.once so the SDK's SIGTERM registration is captured without leaking a real listener per loadTracing call.
  let onceSpy: jest.SpyInstance;

  beforeEach(() => {
    mockEnv.OTEL_ENABLED = false;
    mockEnv.OTEL_DEBUG = false;
    mockEnv.SENTRY_RELEASE = undefined;
    mockEnv.NODE_ENV = 'test';
    shutdownMock.mockResolvedValue(undefined);
    capturedHttpOptions = {};
    capturedIoredisOptions = {};
    onceSpy = jest.spyOn(process, 'once').mockReturnValue(process);
  });

  describe('startup gate', () => {
    it('does not boot the SDK when tracing is disabled', () => {
      mockEnv.OTEL_ENABLED = false;
      mockEnv.OTEL_DEBUG = false;

      loadTracing();

      expect(nodeSdkMock).not.toHaveBeenCalled();
      expect(startMock).not.toHaveBeenCalled();
    });

    it('boots the SDK when OTEL_ENABLED is true', () => {
      mockEnv.OTEL_ENABLED = true;

      loadTracing();

      expect(nodeSdkMock).toHaveBeenCalledTimes(1);
      expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('boots the SDK in debug mode even when OTEL_ENABLED is false', () => {
      mockEnv.OTEL_ENABLED = false;
      mockEnv.OTEL_DEBUG = true;

      loadTracing();

      expect(startMock).toHaveBeenCalledTimes(1);
    });

    it('does not boot a second time once already started (idempotent)', () => {
      mockEnv.OTEL_ENABLED = true;

      const mod = loadTracing();
      mod.startTracing();

      expect(startMock).toHaveBeenCalledTimes(1);
      expect(nodeSdkMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('exporter and logger selection', () => {
    it('uses the OTLP exporter and no debug logger in production mode', () => {
      mockEnv.OTEL_ENABLED = true;
      mockEnv.OTEL_DEBUG = false;

      loadTracing();

      expect(otlpExporterMock).toHaveBeenCalledWith({ url: 'http://otel-collector:4318/v1/traces' });
      expect(consoleExporterMock).not.toHaveBeenCalled();
      expect(setLoggerMock).not.toHaveBeenCalled();
    });

    it('uses the console exporter and a debug logger in debug mode', () => {
      mockEnv.OTEL_DEBUG = true;

      loadTracing();

      expect(consoleExporterMock).toHaveBeenCalledTimes(1);
      expect(otlpExporterMock).not.toHaveBeenCalled();
      expect(setLoggerMock).toHaveBeenCalledTimes(1);
    });

    it('falls back to an "unknown" service version when SENTRY_RELEASE is unset', () => {
      mockEnv.OTEL_ENABLED = true;
      mockEnv.SENTRY_RELEASE = undefined;

      loadTracing();

      expect(resourceFromAttributesMock).toHaveBeenCalledWith(
        expect.objectContaining({ 'service.name': 'app', 'service.version': 'unknown' }),
      );
    });

    it('uses SENTRY_RELEASE as the service version when present', () => {
      mockEnv.OTEL_ENABLED = true;
      mockEnv.SENTRY_RELEASE = '1.2.3';

      loadTracing();

      expect(resourceFromAttributesMock).toHaveBeenCalledWith(expect.objectContaining({ 'service.version': '1.2.3' }));
    });
  });

  describe('ignoreIncomingRequestHook', () => {
    function hookFor(url: string | undefined): boolean {
      mockEnv.OTEL_ENABLED = true;
      loadTracing();

      return capturedHttpOptions.ignoreIncomingRequestHook!({ url } as IncomingMessage);
    }

    it.each([['/health'], ['/metrics'], ['/api/v1/health'], ['/api/v1/metrics'], ['/api/v1/health/ready']])(
      'ignores the operational path %s',
      (url) => {
        expect(hookFor(url)).toBe(true);
      },
    );

    it.each([['/api/v1/orders'], ['/'], ['/users/123']])('traces the business path %s', (url) => {
      expect(hookFor(url)).toBe(false);
    });

    it('matches operational paths by prefix (a documented over-match)', () => {
      // * The hook uses startsWith, so any path sharing an operational prefix is also ignored.
      expect(hookFor('/healthz-internal')).toBe(true);
    });

    it('treats a missing url as a business path', () => {
      expect(hookFor(undefined)).toBe(false);
    });
  });

  describe('redis statement serializer', () => {
    it('records the raw redis command as the db statement', () => {
      mockEnv.OTEL_ENABLED = true;

      loadTracing();

      expect(capturedIoredisOptions.dbStatementSerializer!('GET user:42')).toBe('GET user:42');
    });
  });

  describe('graceful shutdown', () => {
    function captureSigtermHandler(): () => void {
      mockEnv.OTEL_ENABLED = true;

      loadTracing();

      const call = onceSpy.mock.calls.find(([event]) => event === 'SIGTERM');

      return call![1] as () => void;
    }

    it('shuts the SDK down on SIGTERM', () => {
      const handler = captureSigtermHandler();

      handler();

      expect(shutdownMock).toHaveBeenCalledTimes(1);
    });

    it('logs via diag when shutdown rejects', async () => {
      shutdownMock.mockRejectedValueOnce(new Error('shutdown failed'));
      const handler = captureSigtermHandler();

      handler();
      await Promise.resolve();
      await Promise.resolve();

      expect(diagErrorMock).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    });
  });
});
