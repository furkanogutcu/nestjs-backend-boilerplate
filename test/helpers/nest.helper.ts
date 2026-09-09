import 'reflect-metadata';

import { createMock, DeepMocked } from '@golevelup/ts-vitest';
import { ArgumentsHost, CallHandler, ExecutionContext } from '@nestjs/common';
import { HttpArgumentsHost } from '@nestjs/common/interfaces';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable, of, throwError } from 'rxjs';

import { createMockRequest, createMockResponse } from './http.helper';

// * The '@nestjs/common/constants' subpath is not reliably exposed under package exports.
const ROUTE_ARGS_METADATA = '__routeArguments__';

export type MockHttpContext = {
  request?: DeepMocked<Request>;
  response?: DeepMocked<Response>;
  handler?: () => void;
  contextClass?: new () => object;
};

function buildHttpArgumentsHost({ request, response }: { request: Request; response: Response }): HttpArgumentsHost {
  const host = createMock<HttpArgumentsHost>();

  host.getRequest.mockReturnValue(request);
  host.getResponse.mockReturnValue(response);

  return host;
}

export function createMockExecutionContext(ctx: MockHttpContext = {}): ExecutionContext {
  const request = ctx.request ?? createMockRequest();
  const response = ctx.response ?? createMockResponse();

  const context = createMock<ExecutionContext>();

  context.switchToHttp.mockReturnValue(buildHttpArgumentsHost({ request, response }));
  context.getHandler.mockReturnValue(ctx.handler ?? ((): void => undefined));
  context.getClass.mockReturnValue(ctx.contextClass ?? class TestClass {});

  return context;
}

export function createMockArgumentsHost(ctx: MockHttpContext = {}): ArgumentsHost {
  const request = ctx.request ?? createMockRequest();
  const response = ctx.response ?? createMockResponse();

  const host = createMock<ArgumentsHost>();

  host.switchToHttp.mockReturnValue(buildHttpArgumentsHost({ request, response }));

  return host;
}

export function createMockReflector(value?: unknown): DeepMocked<Reflector> {
  const reflector = createMock<Reflector>();
  const list = value === undefined ? [] : [value];

  reflector.getAllAndOverride.mockReturnValue(value);
  reflector.get.mockReturnValue(value);
  reflector.getAll.mockReturnValue(list);
  reflector.getAllAndMerge.mockReturnValue(list);

  return reflector;
}

export function createCallHandler<T>(value: T | Error): CallHandler<T> {
  return {
    handle: (): Observable<T> => (value instanceof Error ? throwError(() => value) : of(value)),
  };
}

export function getParamDecoratorFactory(
  decorator: ParameterDecorator,
): (data: unknown, ctx: ExecutionContext) => unknown {
  class DecoratorHost {
    run(@decorator value: unknown): unknown {
      return value;
    }
  }

  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, DecoratorHost, 'run') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => unknown }
  >;

  return metadata[Object.keys(metadata)[0]].factory;
}
