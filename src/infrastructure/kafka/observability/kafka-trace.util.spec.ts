import {
  Context,
  context,
  ContextManager,
  propagation,
  ROOT_CONTEXT,
  TextMapGetter,
  TextMapPropagator,
  TextMapSetter,
  trace,
} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';

import { extractTraceContext, hasActiveTrace, injectTraceContext } from './kafka-trace.util';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

// * The api package ships only a no-op context manager; this synchronous stack manager makes context.active() honour context.with in tests.
class StackContextManager implements ContextManager {
  private _active: Context = ROOT_CONTEXT;

  active(): Context {
    return this._active;
  }

  // eslint-disable-next-line no-restricted-syntax -- ContextManager.with signature is fixed (context, fn, thisArg, ...args)
  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    activeContext: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    const previous = this._active;
    this._active = activeContext;

    try {
      return fn.call(thisArg, ...args);
    } finally {
      this._active = previous;
    }
  }

  // eslint-disable-next-line no-restricted-syntax -- ContextManager.bind signature is fixed (context, target)
  bind<T>(_activeContext: Context, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this._active = ROOT_CONTEXT;

    return this;
  }
}

describe('kafka-trace.util', () => {
  beforeAll(() => context.setGlobalContextManager(new StackContextManager()));
  afterAll(() => context.disable());

  describe('with the W3C trace-context propagator', () => {
    beforeAll(() => propagation.setGlobalPropagator(new W3CTraceContextPropagator()));
    afterAll(() => propagation.disable());

    it('extracts a span context from a buffer-valued traceparent header', () => {
      const ctx = extractTraceContext({ traceparent: Buffer.from(TRACEPARENT) });

      const spanContext = trace.getSpanContext(ctx);
      expect(spanContext?.traceId).toBe(TRACE_ID);
      expect(spanContext?.spanId).toBe(SPAN_ID);
    });

    it('returns a context without a span when no traceparent header is present', () => {
      expect(trace.getSpanContext(extractTraceContext({}))).toBeUndefined();
    });

    it('injects the active span context as a traceparent header on the carrier', () => {
      const activeCtx = trace.setSpanContext(context.active(), {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        traceFlags: 1,
        isRemote: false,
      });
      const carrier: Record<string, string | Buffer> = {};

      context.with(activeCtx, () => injectTraceContext(carrier));

      expect(carrier.traceparent).toBe(TRACEPARENT);
    });

    it('returns the same carrier reference it was given', () => {
      const carrier: Record<string, string | Buffer> = {};

      expect(injectTraceContext(carrier)).toBe(carrier);
    });
  });

  // * A propagator that exercises the full TextMapGetter/Setter contract (keys + get + set), unlike the W3C one.
  describe('buffer-header adapter contract', () => {
    let observedKeys: string[] = [];
    let observedValues: (string | string[] | undefined)[] = [];

    const recordingPropagator: TextMapPropagator = {
      // eslint-disable-next-line no-restricted-syntax -- TextMapPropagator.inject signature is fixed (context, carrier, setter)
      inject: (_ctx: Context, carrier: unknown, setter: TextMapSetter) => {
        setter.set(carrier, 'x-trace', 'recorded');
      },
      // eslint-disable-next-line no-restricted-syntax -- TextMapPropagator.extract signature is fixed (context, carrier, getter)
      extract: (ctx: Context, carrier: unknown, getter: TextMapGetter) => {
        observedKeys = getter.keys(carrier);
        observedValues = [...observedKeys.map((key) => getter.get(carrier, key)), getter.get(carrier, 'absent-key')];

        return ctx;
      },
      fields: () => ['x-trace'],
    };

    beforeAll(() => propagation.setGlobalPropagator(recordingPropagator));
    afterAll(() => propagation.disable());

    beforeEach(() => {
      observedKeys = [];
      observedValues = [];
    });

    it('exposes every buffer header key and decodes values to strings', () => {
      extractTraceContext({ traceparent: Buffer.from('tp-value'), baggage: Buffer.from('bg-value') });

      expect(observedKeys).toEqual(expect.arrayContaining(['traceparent', 'baggage']));
      expect(observedValues).toEqual(expect.arrayContaining(['tp-value', 'bg-value']));
    });

    it('returns undefined for a header key that is absent', () => {
      extractTraceContext({ traceparent: Buffer.from('tp-value') });

      expect(observedValues).toContain(undefined);
    });

    it('writes values to the carrier through the setter on inject', () => {
      const carrier: Record<string, string | Buffer> = {};

      injectTraceContext(carrier);

      expect(carrier['x-trace']).toBe('recorded');
    });
  });

  describe('hasActiveTrace', () => {
    it('is false when no span is active', () => {
      expect(hasActiveTrace()).toBe(false);
    });

    it('is true within an active span context', () => {
      const span = trace.wrapSpanContext({ traceId: TRACE_ID, spanId: SPAN_ID, traceFlags: 1, isRemote: false });

      context.with(trace.setSpan(context.active(), span), () => {
        expect(hasActiveTrace()).toBe(true);
      });
    });
  });
});
