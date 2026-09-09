# Shared test helpers (`test/helpers`, imported via `@test/helpers`)

Built on top of `@golevelup/ts-vitest`'s `createMock`. Prefer these over hand-writing mocks so call sites
stay short and type-safe. Source: `test/helpers/*.helper.ts`.

## HTTP — `http.helper.ts`

```ts
createMockRequest(overrides?: Partial<Request>): DeepMocked<Request>
// Defaults: method GET, url/path '/', empty headers/query, ip '127.0.0.1',
// context = { ipAddress: '127.0.0.1', timestamp: 0 } (the express.declaration augmentation).

createMockResponse(overrides?: Partial<Response>): DeepMocked<Response>
// status/json/send/setHeader are chainable (return the response). getHeader defaults to undefined.
// Pass { headersSent: true } / { statusCode: 201 } via overrides.
```

## Nest — `nest.helper.ts`

```ts
createMockExecutionContext({ request?, response?, handler?, contextClass? }): ExecutionContext
createMockArgumentsHost({ request?, response? }): ArgumentsHost
// Pass the SAME request/response mocks you assert on, so the spec and the unit share a single instance.

createMockReflector(value?): DeepMocked<Reflector>
// getAllAndOverride/get return `value`; one value suffices since each test drives a single decorator's metadata.

createCallHandler<T>(value: T | Error): CallHandler<T>
// handle() emits `value`, or throws if given an Error.

getParamDecoratorFactory(decorator: ParameterDecorator): (data, ctx) => unknown
// Recovers the createParamDecorator factory. Pass the APPLIED decorator: Pagination(), Search(['x']).
```

## Redis — `redis.helper.ts`

```ts
createMockRedis(): DeepMocked<Redis>
// Every command is auto-stubbed; configure it with mockResolvedValue / mockRejectedValue.
```

## TypeORM — `typeorm.helper.ts`

```ts
createMockRepository<T>(): DeepMocked<Repository<T>>
createMockEntityManager(): DeepMocked<EntityManager>
createMockDataSource(manager?): DeepMocked<DataSource>
// transaction(handler) runs the handler with the (given or new) EntityManager and returns its result —
// letting you assert the delegation; the real commit/rollback is covered in the integration suite.
```

## Adding a new helper

Keep helpers in `test/helpers/`, re-export them from `test/helpers/index.ts`, build on `createMock`, and
keep them type-safe (no `any`). Because they live outside `src`, they stay out of build and coverage.
