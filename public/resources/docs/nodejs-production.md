# Node.js in Production: Architecture, NestJS, Data, Jobs & Observability

Senior backend rounds rarely ask "what is middleware?". They ask how you **build and run** a Node service:

- How do you structure it?
- How do you validate config and input?
- Which ORM do you use, and how do you pool connections?
- How do background jobs and file uploads work?
- How do you make outbound calls resilient?
- How do you shut down cleanly in Kubernetes?
- How do you log, measure and trace?
- How do you test against a real database and ship a small, safe container?

This doc is the production playbook, with **NestJS** covered in depth because many Node job descriptions list it.

> Framework code (NestJS decorators, Express, Prisma) is shown as non-runnable TypeScript or Node.js. **Config validation, retries with exponential backoff and jitter, and a circuit breaker** are **runnable with tests**.

## Architecture & configuration

### How do you structure a large Node.js/TypeScript backend? 🔥

**Organise by feature (domain module), and layer inside each module:**

```text
src/
  modules/
    meetings/
      meetings.routes.ts        # HTTP layer: parse/validate input, call the service, map to the response
      meetings.service.ts       # business logic: orchestrates, enforces rules, no HTTP or SQL details
      meetings.repository.ts    # data access: SQL/ORM only
      meetings.schemas.ts       # zod schemas = runtime validation + inferred TS types
      meetings.events.ts        # domain events published by this module
      meetings.test.ts
    recordings/ …
    billing/ …
  shared/
    db.ts  logger.ts  errors.ts  config.ts  auth.ts  http-client.ts
  app.ts                        # composition root: build dependencies, register routes
  server.ts                     # start/stop: listen, signals, graceful shutdown
```

**Principles:**

- **Thin controllers, rich services, dumb repositories.** HTTP concerns (status codes, headers) never leak into services. SQL never leaks into controllers.
- **Dependency injection,** even without a framework: services receive their dependencies through constructors or factory parameters. This makes **testing with fakes** trivial and keeps the wiring in one place, the **composition root**.
- **Typed domain errors** (`NotFoundError`, `ConflictError`, `ForbiddenError`) thrown by services and mapped to HTTP **once**, in an error middleware.
- **Modules talk through service interfaces or events**, not by reaching into each other's tables. That keeps a later split into services possible: the **modular monolith**.
- **Hexagonal / ports-and-adapters** when the domain is complex: the core defines interfaces (ports), and the infrastructure implements them (adapters for Postgres, S3, Stripe).

```tslib
// Dependency injection without a framework: a factory + composition root
export function createMeetingService(deps: { repo: MeetingRepo; events: EventBus; clock: () => Date }) {
  return {
    async schedule(input: ScheduleMeetingInput, actor: User) {
      if (input.start <= deps.clock()) throw new ValidationError('start must be in the future');
      const meeting = await deps.repo.insert({ ...input, hostId: actor.id });
      await deps.events.publish({ type: 'MeetingScheduled', meetingId: meeting.id });
      return meeting;
    },
  };
}

// app.ts: wire the real implementations once
const meetings = createMeetingService({ repo: new PgMeetingRepo(pool), events: outboxBus, clock: () => new Date() });
// test: createMeetingService({ repo: inMemoryRepo, events: fakeBus, clock: () => fixedDate })
```

### How do you manage configuration and secrets? 🔥

**The 12-factor approach:**

- Configuration comes from the **environment**, never from code. One build artifact runs in every environment.
- **Validate the whole config at startup and fail fast**, listing *every* problem at once. Otherwise you find the missing `DATABASE_URL` at 2 a.m. on the first request.
- **Parse into types:** `PORT` is a number, `FEATURE_X` a boolean, enums are checked.
- **Freeze** the config object, and inject it rather than reading `process.env` throughout the code.

**Secrets:**

- Keep them in a **secret manager** (AWS Secrets Manager, SSM Parameter Store, Vault, Kubernetes Secrets with encryption at rest), injected at runtime.
- Never commit them, and never bake them into images.
- **Never log** config objects without redaction.
- **Rotate** them. For DB credentials, use short-lived IAM auth or Secrets Manager rotation, and make the pool **re-read credentials** on authentication failure.

```ts
// Minimal typed config loader (what zod/envalid do), with every error reported at once
type Rule<T> = (raw: string | undefined, key: string) => T;

const str = (def?: string): Rule<string> => (raw, key) => {
  const v = raw ?? def;
  if (v === undefined || v === '') throw new Error(`${key} is required`);
  return v;
};
const int = (opts: { def?: number; min?: number; max?: number } = {}): Rule<number> => (raw, key) => {
  if (raw === undefined) { if (opts.def !== undefined) return opts.def; throw new Error(`${key} is required`); }
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`${key} must be an integer, got "${raw}"`);
  if (opts.min !== undefined && n < opts.min) throw new Error(`${key} must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new Error(`${key} must be <= ${opts.max}`);
  return n;
};
const bool = (def = false): Rule<boolean> => (raw, key) => {
  if (raw === undefined) return def;
  if (['true', '1', 'yes'].includes(raw.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(raw.toLowerCase())) return false;
  throw new Error(`${key} must be a boolean, got "${raw}"`);
};
const oneOf = <T extends string>(values: readonly T[], def?: T): Rule<T> => (raw, key) => {
  const v = (raw ?? def) as T | undefined;
  if (!v || !values.includes(v)) throw new Error(`${key} must be one of ${values.join('|')}, got "${raw}"`);
  return v;
};

function loadConfig<S extends Record<string, Rule<unknown>>>(schema: S, env: Record<string, string | undefined>) {
  const errors: string[] = [];
  const out = {} as { [K in keyof S]: ReturnType<S[K]> };
  for (const key of Object.keys(schema) as (keyof S)[]) {
    try { out[key] = schema[key](env[key as string], key as string) as ReturnType<S[typeof key]>; }
    catch (e) { errors.push((e as Error).message); }
  }
  if (errors.length) throw new Error(`Invalid configuration:\n  - ${errors.join('\n  - ')}`);
  return Object.freeze(out);
}

const schema = {
  NODE_ENV: oneOf(['development', 'test', 'production'] as const, 'development'),
  PORT: int({ def: 3000, min: 1, max: 65535 }),
  DATABASE_URL: str(),
  DB_POOL_MAX: int({ def: 10, min: 1, max: 100 }),
  ENABLE_RECORDING_V2: bool(false),
};

test('parses, coerces and applies defaults', () => {
  const cfg = loadConfig(schema, { NODE_ENV: 'production', DATABASE_URL: 'postgres://db/app', ENABLE_RECORDING_V2: 'true' });
  expect(cfg).toEqual({ NODE_ENV: 'production', PORT: 3000, DATABASE_URL: 'postgres://db/app', DB_POOL_MAX: 10, ENABLE_RECORDING_V2: true });
  expect(Object.isFrozen(cfg)).toBe(true);
});
test('reports every problem at once (fail fast at boot)', () => {
  expect(() => loadConfig(schema, { NODE_ENV: 'prod', PORT: 'abc', DB_POOL_MAX: '500' })).toThrow(
    /NODE_ENV must be one of[\s\S]*PORT must be an integer[\s\S]*DATABASE_URL is required[\s\S]*DB_POOL_MAX must be <= 100/,
  );
});
```

### How do you validate requests, and why aren't TypeScript types enough? 🔥

**TypeScript types are erased at runtime.** `req.body as CreateMeetingDto` is a **promise to the compiler, not a check**. Anything from outside the process (HTTP bodies, query strings, headers, queue messages, third-party webhooks, environment variables, even your own database's JSONB) must be **validated at the boundary**.

```tslib
import { z } from 'zod';

export const CreateMeeting = z.object({
  title: z.string().trim().min(1).max(200),
  start: z.coerce.date(),                                      // query/body strings → Date
  durationMin: z.number().int().min(5).max(24 * 60),
  kind: z.enum(['meeting', 'webinar']).default('meeting'),
  invitees: z.array(z.string().email()).max(500).default([]),
}).strict();                                                   // reject unknown fields (mass-assignment protection)

export type CreateMeetingInput = z.infer<typeof CreateMeeting>;   // ONE source of truth for the type and the validation

// Generic middleware
const validate = (schema: z.ZodTypeAny) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ type: 'https://errors.example.com/validation', title: 'Invalid request',
      errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  }
  req.body = result.data;                                       // the parsed, coerced, defaulted value
  next();
};
router.post('/meetings', validate(CreateMeeting), createMeetingHandler);
```

**Details worth mentioning:**

- **Share schemas with the frontend** (a monorepo package), so React forms (react-hook-form + zod resolver) and the API agree.
- Generate **OpenAPI** from the schemas (`zod-to-openapi`) or validate against OpenAPI (`express-openapi-validator`). Fastify uses JSON Schema natively, which is fast because it's compiled with Ajv.
- **Limit sizes:** body size (`express.json({ limit: '100kb' })`), array lengths, string lengths. Large payloads are a DoS vector.
- **Mass assignment:** never spread `req.body` into an ORM `update()`. Whitelist fields (`.strict()` / `pick`).

## NestJS

### What is NestJS, and what are its building blocks? 🔥

**NestJS** is an opinionated, Angular-inspired Node framework built on Express or Fastify. It provides **modules, dependency injection and decorators**, which gives large teams a consistent structure.

| Building block | Role |
|---|---|
| **Module** (`@Module`) | Groups controllers and providers. `imports`/`exports` define boundaries. The root `AppModule` composes everything |
| **Controller** (`@Controller`, `@Get`, `@Post`) | HTTP layer: routes, params (`@Param`, `@Body`, `@Query`) |
| **Provider** (`@Injectable`) | Services, repositories, factories, injected by the **DI container** via constructor types |
| **Guard** | Authorisation: can this request proceed? (`CanActivate`) |
| **Pipe** | Validation and transformation of inputs (`ValidationPipe` with class-validator, `ParseIntPipe`, zod pipes) |
| **Interceptor** | AOP-style wrapping: logging, timing, caching, response mapping, timeouts (uses RxJS) |
| **Exception filter** | Maps thrown exceptions to responses |
| **Middleware** | Express-style, runs before route resolution |

```tslib
@Module({
  imports: [TypeOrmModule.forFeature([Meeting]), RecordingsModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
  exports: [MeetingsService],
})
export class MeetingsModule {}

@Controller('meetings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}       // injected by type

  @Post()
  @Roles('host')
  create(@Body() dto: CreateMeetingDto, @CurrentUser() user: User) {
    return this.meetings.schedule(dto, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.meetings.findOne(id);
  }
}

export class CreateMeetingDto {
  @IsString() @Length(1, 200) title!: string;
  @IsDateString() start!: string;
  @IsInt() @Min(5) durationMin!: number;
}
```

**How DI works:**

- TypeScript's `emitDecoratorMetadata` emits the constructor parameter **types** as metadata (`design:paramtypes`).
- Nest reads it with `reflect-metadata` and resolves the providers from the module graph.
- **Interfaces don't exist at runtime**, so injecting an interface needs a **token**: `@Inject(MEETING_REPO)` with `{ provide: MEETING_REPO, useClass: PgMeetingRepo }`.

### Explain the NestJS request lifecycle 🔥

The order in which Nest runs the pieces for a request:

```text
Incoming request
 → Middleware (global → module)
 → Guards (global → controller → route)                   e.g. JWT auth, roles
 → Interceptors, BEFORE (global → controller → route)     e.g. start timer, check cache
 → Pipes (global → controller → route → parameter)        validation/transformation of @Body/@Param
 → Controller handler → services
 → Interceptors, AFTER (route → controller → global)      map the response, log the duration
 → Exception filters (route → controller → global)        only if something threw
 → Response
```

**Why it matters in interviews:**

- **Guards run before pipes**, so authorisation happens before validation. An unauthorised user gets 401/403, not a 400 telling them about your schema.
- **Interceptors wrap the handler like an onion**, using RxJS `next.handle().pipe(map(…), timeout(5000), catchError(…))`.
- **Exception filters** catch both `HttpException`s and unknown errors. Map domain errors to HTTP codes here.

```tslib
@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = performance.now();
    const req = ctx.switchToHttp().getRequest();
    return next.handle().pipe(
      tap(() => this.metrics.observe(req.route.path, performance.now() - started)),
      timeout(10_000),                                     // fail slow handlers
    );
  }
}

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter {
  catch(err: DomainError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const status = err instanceof NotFoundError ? 404 : err instanceof ConflictError ? 409 : 422;
    res.status(status).json({ type: err.type, title: err.message });
  }
}
```

### What are NestJS provider scopes and custom providers?

**Provider scopes:**

| Scope | Lifetime | Cost |
|---|---|---|
| **DEFAULT (singleton)** | One instance for the whole app | The fastest. Use it for almost everything; services must be **stateless** per request |
| **REQUEST** | A new instance per request | **Bubbles up**: anything injecting a request-scoped provider also becomes request-scoped, so whole graphs are rebuilt per request. Measurable overhead |
| **TRANSIENT** | A new instance per injection site | Rare (per-consumer loggers) |

**Prefer singletons plus `AsyncLocalStorage`** (nestjs-cls) for per-request context such as tenant or request id, instead of REQUEST scope. For multi-tenant connection selection, Nest has **durable providers** (one sub-tree per tenant, not per request).

**Custom providers:**

```tslib
providers: [
  { provide: 'CLOCK', useValue: () => new Date() },
  { provide: MEETING_REPO, useClass: process.env.DB === 'mongo' ? MongoMeetingRepo : PgMeetingRepo },
  {
    provide: 'PG_POOL',
    useFactory: async (config: ConfigService) => {           // async factory: awaits before the app starts
      const pool = new Pool({ connectionString: config.get('DATABASE_URL'), max: 10 });
      await pool.query('SELECT 1');
      return pool;
    },
    inject: [ConfigService],
  },
]
```

**Circular dependencies** between providers or modules need `forwardRef(() => OtherService)`. That's a **smell**. Extract shared logic, or communicate through events.

### How do you test NestJS applications?

```tslib
// Unit-ish test with the real DI container and overridden dependencies
const moduleRef = await Test.createTestingModule({ imports: [MeetingsModule] })
  .overrideProvider(MEETING_REPO).useValue(inMemoryRepo)
  .overrideGuard(JwtAuthGuard).useValue({ canActivate: () => true })
  .compile();
const service = moduleRef.get(MeetingsService);

// e2e: boot the HTTP app and hit it with supertest
const app = moduleRef.createNestApplication();
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
await app.init();
await request(app.getHttpServer()).post('/meetings').send({ title: '' }).expect(400);
```

**Rules:**

- Use **the same global pipes, filters and interceptors** in e2e tests as in `main.ts`. A common bug is tests passing without the `ValidationPipe` that production uses. Factor it into a `configureApp(app)` function.
- **`ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`** strips or rejects unknown properties, which prevents mass assignment.

## Data access

### Prisma vs TypeORM vs Sequelize vs Drizzle vs Knex/Kysely: how do you choose? 🔥

| | **Prisma** | **TypeORM** | **Sequelize** | **Drizzle** | **Knex / Kysely** |
|---|---|---|---|---|---|
| Style | Schema-first (`schema.prisma`), generated typed client | Decorator entities, Active Record or Data Mapper | Model definitions, older API | **SQL-like TypeScript DSL**, schema in TS | Query builder (Kysely is fully type-safe) |
| Type safety | **Excellent**, generated | Partial (relations are often `any`-ish) | Weak | **Excellent** | Knex: weak; **Kysely: excellent** |
| Migrations | Prisma Migrate (diffs the schema) | Generated/migration classes | Umzug-based | drizzle-kit | Knex migrations / Kysely migrator |
| Raw SQL | `$queryRaw` (tagged templates, safe) | QueryBuilder / `query()` | `query()` | It *is* SQL-shaped | It *is* SQL-shaped |
| Performance and overhead | Historically a separate query engine; newer versions moved to a TS/WASM engine with lower overhead | Moderate | Moderate | **Thin**, close to raw | Thin |
| Serverless / edge | Driver adapters and Accelerate | Heavy | Heavy | **Great** (HTTP drivers: Neon, PlanetScale, D1) | Good |
| Best for | Fast product development with strong types | NestJS projects already using it; teams from Java/Hibernate | Legacy codebases | SQL-savvy teams wanting types and control | Complex SQL with types (Kysely) |

**What to say:**

- "I pick based on how much SQL the team wants to see. **Prisma** for productivity and type safety. **Drizzle or Kysely** when we write complex SQL and want it type-checked."
- "In every case I watch for **N+1** (`include` everywhere), keep **raw SQL** for reports, and run **migrations as reviewed SQL**."

### How do you configure database connection pooling in Node? 🔥

```node
// node-postgres: ONE pool per process, created at startup and shared
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,                          // per instance: total = instances × max must stay < DB max_connections
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,   // fail fast when the pool is exhausted instead of hanging
  statement_timeout: 5_000,         // server-side guard per query
  application_name: 'meetings-api', // visible in pg_stat_activity
});
pool.on('error', (err) => logger.error({ err }, 'idle client error'));   // otherwise it can crash the process
```

**Symptoms of pool exhaustion:**

- Requests hang, then time out.
- `connectionTimeoutMillis` errors appear.
- `pg_stat_activity` shows many **idle in transaction** sessions.

**Causes:**

- **Leaked clients:** `pool.connect()` without `release()` on an error path.
- **Long transactions:** a slow external call inside a transaction.
- **Pool too small** for the concurrency.
- **Slow queries** holding connections.

**Fixes:**

- `try/finally release()`.
- A transaction helper (see [Transactions & Locking](/docs/db-transactions-locking)).
- Timeouts at every level.
- Metrics on pool `totalCount`, `idleCount` and `waitingCount`.

**Serverless and many instances:**

- Each Lambda container has its own pool, so 1,000 concurrent Lambdas means 1,000+ connections.
- Use **RDS Proxy** or PgBouncer.
- Keep **`max: 1–2`** per Lambda, with the client created **outside the handler**.
- Or use HTTP-based serverless drivers (Neon, Data API).
- **Prisma:** `connection_limit` in the URL, Prisma Accelerate or Data Proxy, or driver adapters with a pooler.

### How do you implement the repository pattern and unit of work in Node?

```tslib
// Repository: hides SQL; accepts an optional transaction-bound executor
interface Db { query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }

export class PgMeetingRepo {
  constructor(private readonly db: Db) {}
  withTx(tx: Db) { return new PgMeetingRepo(tx); }                  // same repo, bound to a transaction
  async findById(id: number) {
    const { rows } = await this.db.query<Meeting>('SELECT * FROM meetings WHERE id = $1', [id]);
    return rows[0] ?? null;
  }
  async markLive(id: number) {
    const { rows } = await this.db.query<Meeting>(
      `UPDATE meetings SET status = 'live', started_at = now() WHERE id = $1 AND status = 'scheduled' RETURNING *`, [id]);
    if (!rows[0]) throw new ConflictError('meeting is not in a startable state');
    return rows[0];
  }
}

// Unit of work: one transaction across several repositories + outbox
await withTransaction(pool, async (tx) => {
  const meeting = await meetingRepo.withTx(tx).markLive(id);
  await auditRepo.withTx(tx).record('meeting.started', meeting.id, actor.id);
  await outbox.withTx(tx).add({ type: 'MeetingStarted', meetingId: meeting.id });
});
```

**Talking points:**

- **Repositories return domain objects.** Services never see SQL.
- **Transactions are opened by the service or use case**, not inside repositories.
- **Conditional updates** (`WHERE status = 'scheduled'`) enforce state transitions atomically.

## Background work & I/O

### How do you run background jobs reliably? 🔥

**What goes to the background:**

- Anything **slow, retryable or not needed for the response**: emails, webhooks, recording post-processing, PDF generation, LLM calls, report exports, search indexing.

**Queue options:**

| Option | Notes |
|---|---|
| **BullMQ** (Redis) | Node-native. Delays, priorities, retries with backoff, rate limits, repeatable jobs, flows (parent/child jobs), dashboards (Bull Board) |
| **SQS** (+ Lambda or a worker) | Managed, scales to anything. **Visibility timeout**, **DLQ** via a redrive policy, FIFO queues for ordering and deduplication |
| **RabbitMQ** | Routing (exchanges), acknowledgements, per-message TTL, DLX |
| **Kafka** | An event log with replay. For streams, not simple task queues |
| **pg-boss / Graphile Worker** | Postgres-backed queues (`SKIP LOCKED`). No extra infrastructure, and jobs are enqueued **transactionally** with your data |

**Reliability rules:**

1. **At-least-once delivery means idempotent handlers.** Use a dedupe key (`jobId`) or an idempotency table. Design side effects to tolerate reruns.
2. **Retries with exponential backoff and jitter.** Classify errors: retry 5xx, timeouts and 429s; **don't retry validation errors** (they go to the DLQ).
3. **Dead-letter queue** after N attempts, with alerting and a replay tool.
4. **Visibility timeout / lock duration** must exceed the job duration. Extend it with heartbeats for long jobs, or the job runs twice.
5. **Enqueue after the commit**, or use the outbox, so jobs never reference rows that don't exist.
6. **Make every job traceable:** a correlation id from the originating request, and metrics for queue depth, age of the oldest message, and failure rate.

```js
// Retry with exponential backoff + FULL jitter, retrying only transient errors
class HttpError extends Error { constructor(status) { super(`HTTP ${status}`); this.status = status; } }
const isRetryable = (err) => !err.status || err.status >= 500 || err.status === 429;

async function retry(fn, { attempts = 5, baseMs = 100, capMs = 5_000, sleep, random = Math.random } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (!isRetryable(err) || attempt >= attempts) throw err;
      const ceiling = Math.min(capMs, baseMs * 2 ** (attempt - 1));
      await sleep(Math.floor(random() * ceiling));          // full jitter: spread retries, avoid thundering herds
    }
  }
}

const delays = [];
const fakeSleep = async (ms) => { delays.push(ms); };       // no real waiting in tests

test('retries transient failures with growing, jittered delays', async () => {
  delays.length = 0;
  let calls = 0;
  const result = await retry(async () => { calls++; if (calls < 4) throw new HttpError(503); return 'ok'; },
    { sleep: fakeSleep, random: () => 0.5 });
  expect(result).toBe('ok');
  expect(calls).toBe(4);
  expect(delays).toEqual([50, 100, 200]);                  // 0.5 × (100, 200, 400)
});
test('does not retry client errors', async () => {
  let calls = 0;
  await expect(retry(async () => { calls++; throw new HttpError(422); }, { sleep: fakeSleep })).rejects.toThrow('HTTP 422');
  expect(calls).toBe(1);
});
test('gives up after max attempts and caps the delay', async () => {
  delays.length = 0;
  await expect(retry(async () => { throw new HttpError(500); }, { attempts: 8, sleep: fakeSleep, random: () => 0.999 })).rejects.toThrow('HTTP 500');
  expect(delays).toHaveLength(7);
  expect(Math.max(...delays)).toBeLessThanOrEqual(5_000);
});
```

### How do you run scheduled (cron) jobs when there are several instances?

**The problem:** `node-cron` inside a service with **5 replicas runs the job 5 times**.

**Solutions:**

| Approach | How |
|---|---|
| **External scheduler** (preferred) | Kubernetes `CronJob`, **EventBridge Scheduler** → Lambda/SQS, Cloud Scheduler, GitHub Actions for ops tasks. The scheduler triggers exactly one execution |
| **Queue-based repeatable jobs** | BullMQ repeatable jobs: the schedule lives in Redis, and one worker picks up each occurrence |
| **Leader lock** | Each instance tries `pg_try_advisory_lock` or a Redis `SET NX PX`; only the winner runs. Handle the lock expiring mid-run (see fencing tokens in [Redis & Caching](/docs/redis-caching)) |

**Whichever you choose:**

- Make the job **idempotent and resumable**, with checkpoints.
- Record each run's status: start, end, items processed, errors.
- Alert on **missed** runs, not only failed ones.

### How do you handle file uploads (large PDFs, recordings) in Node? 🔥

**Option 1: stream through the server.** Use this only when you must inspect or transform the file on the way:

```node
import busboy from 'busboy';
import { pipeline } from 'node:stream/promises';
import { Upload } from '@aws-sdk/lib-storage';

app.post('/documents', (req, res, next) => {
  const bb = busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
  bb.on('file', async (_field, file, info) => {
    try {
      if (info.mimeType !== 'application/pdf') { file.resume(); return res.status(415).end(); }
      const upload = new Upload({                           // S3 multipart upload, streamed, constant memory
        client: s3,
        params: { Bucket: 'docs-raw', Key: `${req.user.tenantId}/${crypto.randomUUID()}.pdf`, Body: file, ContentType: 'application/pdf' },
      });
      file.on('limit', () => upload.abort());              // fileSize exceeded
      await upload.done();
      res.status(201).json({ ok: true });
    } catch (err) { next(err); }
  });
  req.pipe(bb);
});
```

**Option 2 (preferred for big files): upload directly to S3 with a presigned URL.**

1. The client asks the API for an upload URL. The API authorises the request and returns a **presigned PUT URL**, or a **presigned POST policy** with `content-length-range` and content-type conditions. Expiry is a few minutes.
2. The browser uploads **directly to S3**. The Node server never touches the bytes, so there's no memory, bandwidth or timeout pressure.
3. The client calls `POST /documents/:id/complete`, or an **S3 event** triggers processing (Lambda → virus scan → text extraction → the LLM redaction pipeline, as in RBF).
4. **Multipart uploads** for files over ~100 MB: parallel parts, resumable.

**Security checklist:**

- Validate type by **magic bytes**, not just the extension or `Content-Type`: a PDF starts with `%PDF-`.
- **Size limits.**
- **Malware scanning** before files are made available.
- **Random keys** (never user-supplied paths).
- **Private buckets** with presigned GETs for downloads.
- Strip metadata where needed.
- **Tenant-prefixed keys** plus IAM conditions.

### How do you stream responses: SSE, LLM tokens and large exports? 🔥

**Server-Sent Events** are a one-way server→client stream over plain HTTP. They suit progress updates and **streaming LLM output**:

```node
app.get('/documents/:id/redaction/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',                      // stop Nginx from buffering the stream
  });
  const ac = new AbortController();
  req.on('close', () => ac.abort());                // client went away → stop upstream work (and stop paying for tokens)

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);   // keeps proxies from timing out
  try {
    for await (const event of llm.streamRedaction(req.params.id, { signal: ac.signal })) {
      if (!res.write(`event: token\ndata: ${JSON.stringify(event)}\n\n`)) {
        await once(res, 'drain');                   // respect backpressure from slow clients
      }
    }
    res.write('event: done\ndata: {}\n\n');
  } catch (err) {
    if (!ac.signal.aborted) res.write(`event: error\ndata: ${JSON.stringify({ message: 'failed' })}\n\n`);
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});
```

**Large CSV or JSON exports:**

- **Stream rows from a database cursor** (`pg-query-stream`) through a transform to `res`. Never build the whole file in memory.
- For very large or slow exports, run a **background job** that writes to S3 and notify the user with a link.

**WebSockets** are for bidirectional communication (chat, presence, collaborative editing). See [WebSockets & Real-time](/docs/websockets-realtime).

## Reliability

### How do you make outbound calls resilient? Timeouts, retries, circuit breakers and bulkheads 🔥

**Every network call can hang, fail or slow down.** Defend in layers:

| Pattern | What it does | Node tooling |
|---|---|---|
| **Timeouts** (always!) | Bound each call's latency; the default is often **infinite** | `AbortSignal.timeout(ms)` with fetch/undici, SDK timeouts, `statement_timeout` |
| **Retries + backoff + jitter** | Ride out transient failures | `p-retry`, SDK retry config. **Only for idempotent operations**, or with idempotency keys |
| **Circuit breaker** | Stop calling a failing dependency for a while: fail fast and let it recover | `opossum`, `cockatiel` |
| **Bulkhead** | Limit concurrent calls per dependency, so one slow dependency can't consume every socket and the event loop | `p-limit`, undici pool `connections`, separate pools |
| **Fallback** | Degrade gracefully: cached data, a default, or a partial response | App logic |
| **Hedging** (advanced) | Send a second request if the first is slow, and take the fastest | Use carefully; it doubles load |

**Retry budget:** with nested retries (3 at each of 3 layers), one user request can trigger **27** downstream calls. **Retry at one layer**, ideally the edge or the caller closest to the user.

```js
// Circuit breaker: CLOSED → (failures ≥ threshold) → OPEN → (after cooldown) → HALF_OPEN → success → CLOSED
function circuitBreaker(fn, { threshold = 3, cooldownMs = 10_000, now = () => Date.now() } = {}) {
  let state = 'CLOSED', failures = 0, openedAt = 0;
  const breaker = async (...args) => {
    if (state === 'OPEN') {
      if (now() - openedAt < cooldownMs) throw new Error('circuit open: failing fast');
      state = 'HALF_OPEN';                                   // allow one trial request
    }
    try {
      const result = await fn(...args);
      state = 'CLOSED'; failures = 0;
      return result;
    } catch (err) {
      failures++;
      if (state === 'HALF_OPEN' || failures >= threshold) { state = 'OPEN'; openedAt = now(); }
      throw err;
    }
  };
  breaker.state = () => state;
  return breaker;
}

let t = 0;
let healthy = false;
let upstreamCalls = 0;
const callRecordingService = async () => { upstreamCalls++; if (!healthy) throw new Error('503'); return 'ok'; };
const guarded = circuitBreaker(callRecordingService, { threshold: 3, cooldownMs: 10_000, now: () => t });

test('opens after consecutive failures and then fails fast without calling upstream', async () => {
  for (let i = 0; i < 3; i++) await expect(guarded()).rejects.toThrow('503');
  expect(guarded.state()).toBe('OPEN');
  await expect(guarded()).rejects.toThrow('circuit open');
  expect(upstreamCalls).toBe(3);                            // the 4th call never reached the dependency
});
test('half-open trial: failure re-opens, success closes', async () => {
  t = 10_001;                                               // cooldown elapsed
  await expect(guarded()).rejects.toThrow('503');           // trial failed
  expect(guarded.state()).toBe('OPEN');
  t = 20_002;
  healthy = true;
  await expect(guarded()).resolves.toBe('ok');
  expect(guarded.state()).toBe('CLOSED');
});
```

### How do you shut down gracefully in Kubernetes or ECS? 🔥

**What happens when a pod is terminated:**

1. Kubernetes marks the pod **Terminating**, and *at the same time*:
   - removes it from Service endpoints (asynchronously, so it takes a moment to propagate to kube-proxy, ingress and load balancers);
   - runs the **`preStop` hook**, then sends **SIGTERM** to PID 1.
2. The app has `terminationGracePeriodSeconds` (30 s by default) before **SIGKILL**.

**The race:** traffic can still arrive for a few seconds after SIGTERM, because the endpoint removal hasn't propagated. If you close the server immediately, those requests get connection errors.

**A correct sequence:**

```node
let shuttingDown = false;
app.get('/readyz', (req, res) => res.status(shuttingDown ? 503 : 200).end());
app.get('/livez', (req, res) => res.status(200).end());

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;                                       // 1. readiness fails → no new traffic routed here
  logger.info({ signal }, 'shutting down');
  await sleep(5_000);                                        // 2. wait for LBs and endpoints to notice (or use a preStop sleep)
  server.close();                                            // 3. stop accepting connections; in-flight requests finish
  server.closeIdleConnections?.();                           //    drop idle keep-alive sockets (Node 19+ close() also does this)
  await worker?.close();                                     // 4. stop taking jobs; let current jobs finish (BullMQ)
  await Promise.allSettled([pool.end(), redis.quit()]);      // 5. close dependencies
  logger.flush?.();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
setTimeout(() => process.exit(1), 25_000).unref();          // hard stop before SIGKILL (inside shutdown in real code)
```

**Container details:**

- **Node must receive SIGTERM.** Run `node server.js` as PID 1, or use `tini`/`--init`. **`npm start` doesn't forward signals reliably.**
- Long-lived connections (WebSockets, SSE) need explicit closing with a "reconnect" message. Clients should reconnect with jitter to another pod.
- For jobs, the queue's **visibility timeout** must allow another worker to pick up any job you couldn't finish.

### Liveness vs readiness vs startup probes: what should each check? 🔥

| Probe | Question | On failure | Should check |
|---|---|---|---|
| **Liveness** | "Is the process wedged and in need of a restart?" | **The container is killed and restarted** | Only the process itself: can the event loop respond? **Not** the database |
| **Readiness** | "Should this instance receive traffic right now?" | Removed from the load balancer (not restarted) | Its critical dependencies are reachable (DB pool, required caches); not shutting down; warm-up done |
| **Startup** | "Has the app finished starting?" | Liveness and readiness are held off until it passes | Slow boots (migrations, cache warm-up) |

**The classic mistake: checking the database in the liveness probe.**

1. The database blips.
2. **Every pod fails liveness and gets restarted.**
3. They all reconnect at once, causing a thundering herd and a full outage.
4. A database problem has become an application outage.

**Also:**

- Keep probes **cheap** (no heavy queries) and serve them on the main event loop, so a blocked loop correctly fails liveness.
- Set sensible `failureThreshold`/`periodSeconds` values.
- In ECS/ALB, the target group health check plays the readiness role.

### How do you protect a Node API at the application layer?

**A checklist:**

- **Security headers:** `helmet()` (HSTS, `X-Content-Type-Options`, frame options; CSP for HTML responses).
- **CORS:** an explicit origin allowlist. Never `*` together with credentials. Restrict methods and headers. Cache preflights (`maxAge`).
- **Rate limiting:** `express-rate-limit` or `@fastify/rate-limit` **with a Redis store**, so limits are shared across instances. Stricter limits on auth and OTP endpoints. Return `429` + `Retry-After`.
- **Body limits and timeouts:** JSON size limits, `server.requestTimeout`, per-route timeouts; reject slowloris clients.
- **AuthN/AuthZ:**
  - Verify JWT **signature, `exp`, `aud` and `iss`**, and pin the algorithm (no `none`, no algorithm confusion).
  - Check **object-level authorisation** on every resource (IDOR prevention): `WHERE id = $1 AND tenant_id = $2`.
- **Input validation** (zod) and **output encoding**.
- **Parameterised queries** everywhere.
- **Dependency hygiene:** lockfiles, `npm audit`, Renovate.
- **No sensitive data in errors.** Use generic 500 messages and a correlation id.
- **Trust proxy** settings (`app.set('trust proxy', 1)`), so `req.ip` and `secure` cookies work behind a load balancer. Don't trust `X-Forwarded-For` blindly.

## Observability

### How do you do structured logging in Node? 🔥

**Use a structured, asynchronous logger: pino** (or Winston). **Not `console.log`.** Console output is unstructured and can be synchronous on some destinations.

```node
import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'meetings-api', version: process.env.GIT_SHA },
  redact: { paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', 'user.email'], censor: '[redacted]' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Per-request child logger with correlation ids (pino-http does this for you)
app.use((req, res, next) => {
  req.log = logger.child({ requestId: req.id, tenantId: req.user?.tenantId, traceId: currentTraceId() });
  next();
});

req.log.info({ meetingId, durationMs }, 'recording started');      // object first, message second
req.log.error({ err }, 'recording failed');                         // err serialiser keeps the stack, type and cause
```

**Logging rules:**

- **JSON to stdout.** Let the platform ship it (CloudWatch, Loki, ELK, Datadog). Pretty-print only in development (`pino-pretty`).
- **Levels:**
  - `error`: needs attention.
  - `warn`: unexpected but handled.
  - `info`: business events.
  - `debug`: off in production.
- **Correlation:** a request id or trace id in **every** line, propagated to downstream calls and jobs.
- **Never log secrets or PII.** Use redaction. **Log events, not payloads.**
- Watch **cost and volume**: sample noisy debug logs and avoid logging inside hot loops.

### Which metrics should a Node service expose? 🔥

**Frameworks for choosing metrics:**

- **RED** (per endpoint and dependency): **R**ate, **E**rrors, **D**uration.
- **USE** (per resource): **U**tilisation, **S**aturation, **E**rrors.
- **Four golden signals:** latency, traffic, errors, saturation.

| Metric | Type | Why |
|---|---|---|
| `http_request_duration_seconds{route,method,status}` | **Histogram** | p50/p95/p99 latency per route (use the route template `/meetings/:id`, **not the raw URL**) |
| `http_requests_total{route,status}` | Counter | Throughput and error rate |
| `eventloop_lag_p99_seconds`, `eventloop_utilization` | Gauge | Is the loop blocked or saturated? |
| `nodejs_heap_used_bytes`, GC pause durations | Gauge / histogram | Memory pressure, leaks |
| `db_pool_waiting`, `db_query_duration_seconds` | Gauge / histogram | Pool saturation and query latency |
| `queue_depth`, `queue_oldest_job_age_seconds`, `jobs_failed_total` | Gauge / counter | Background work health |
| Business metrics: `meetings_started_total`, `recordings_failed_total` | Counter | Product health and alerting |

```node
import client from 'prom-client';
client.collectDefaultMetrics();                         // event loop lag, heap, GC, handles
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds', help: 'HTTP latency',
  labelNames: ['method', 'route', 'status'], buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
app.use((req, res, next) => {
  const end = httpDuration.startTimer();
  res.on('finish', () => end({ method: req.method, route: req.route?.path ?? 'unknown', status: res.statusCode }));
  next();
});
app.get('/metrics', async (_req, res) => res.type(client.register.contentType).send(await client.register.metrics()));
```

**Cardinality kills metrics systems.** **Never put user ids, meeting ids, emails or raw URLs into labels.** Every distinct label combination is a separate time series. Put high-cardinality detail in **logs and traces**.

### How does distributed tracing with OpenTelemetry work? 🔥

**Concepts:**

- A **trace** is the whole journey of one request across services.
- A **span** is one operation within it: the HTTP handler, a DB query, an outgoing call. Spans have a parent-child structure, timing and attributes.
- **Context propagation:** the trace context travels in headers. The W3C standard is **`traceparent: 00-<32-hex trace id>-<16-hex span id>-<flags>`**.
- Inside a Node process, context follows async calls via **AsyncLocalStorage**.
- **Auto-instrumentation** (`@opentelemetry/auto-instrumentations-node`) patches http, express/fastify, pg, mysql, redis, aws-sdk, kafka and more. You get spans with **no code changes**.
- **Exporters** send spans to an OTel Collector, then to Jaeger, Tempo, X-Ray, Honeycomb or Datadog.

```node
// tracing.js: load BEFORE the app (node --import ./tracing.js server.js)
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

new NodeSDK({
  serviceName: 'meetings-api',
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()],
}).start();

// Custom span around business logic
import { trace } from '@opentelemetry/api';
const tracer = trace.getTracer('recordings');
await tracer.startActiveSpan('recording.finalize', async (span) => {
  span.setAttribute('recording.id', id);
  try { await finalize(id); } catch (e) { span.recordException(e); span.setStatus({ code: 2 }); throw e; } finally { span.end(); }
});
```

**Sampling:**

- **Head sampling:** keep 10% of traces, decided at the start.
- **Tail sampling** in the collector: keep **all errors and slow traces** plus a sample of the rest.

**Correlate everything:** put the `traceId` in logs, so you can jump from a log line to its trace.

### How do you track errors and alert sensibly?

**Error tracking (Sentry, Rollbar, Datadog):**

- Exceptions are grouped with stack traces, **source maps** (upload them in CI; don't serve them publicly), release tags, and user and tenant context.
- **Release health:** a new release that spikes errors triggers a rollback.

**Alerting philosophy:**

- **Alert on symptoms users feel (SLOs), not on every cause.**
  - **SLI:** the success rate or p99 latency of key endpoints.
  - **SLO:** e.g. 99.9% of `POST /meetings` succeed within 500 ms over 30 days.
  - **Error budget:** the 0.1% you're allowed to fail.
- **Burn-rate alerts** page when the budget is being consumed too fast (e.g. a 2% error rate for 5 minutes). Slow burns open tickets instead.
- **Every page needs a runbook and an owner.** Noisy alerts get ignored, which is how outages get missed.

## Testing & delivery

### How do you test a Node backend? 🔥

| Level | Tools | Tests |
|---|---|---|
| **Unit** | Vitest / Jest / `node:test` | Services with fake repositories and a fixed clock; pure functions; validation schemas |
| **Integration** | **Testcontainers** (a real Postgres/Redis in Docker), or docker-compose in CI | Repositories against a **real database**: SQL, migrations, constraints, transactions. Mocks can't catch a wrong SQL query |
| **HTTP / API** | **supertest** against the app (no network port), or Fastify `inject` | Routing, validation, auth, error mapping, status codes |
| **External HTTP** | **nock**, **MSW** (Node), undici `MockAgent` | Third-party APIs: success, errors, timeouts, retries |
| **Contract** | **Pact** (consumer-driven), OpenAPI validation | Frontend ↔ API and service ↔ service compatibility without full end-to-end tests |
| **E2E / smoke** | Playwright against a deployed environment | Critical user flows after deploys |
| **Load** | **k6**, autocannon, Artillery | Throughput and latency, pool sizing, finding the saturation point |

```tslib
// Integration test with Testcontainers: a real Postgres, real migrations
import { PostgreSqlContainer } from '@testcontainers/postgresql';
let container, pool, repo;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
  repo = new PgMeetingRepo(pool);
}, 60_000);
afterAll(async () => { await pool.end(); await container.stop(); });
beforeEach(() => pool.query('TRUNCATE meetings RESTART IDENTITY CASCADE'));

test('markLive only transitions scheduled meetings', async () => {
  const m = await repo.insert({ title: 'Demo', hostId: 1, status: 'scheduled' });
  await repo.markLive(m.id);
  await expect(repo.markLive(m.id)).rejects.toThrow(ConflictError);       // the conditional UPDATE worked
});
```

**Practices:**

- **Test data builders or factories** (`buildMeeting({ status: 'live' })`).
- Isolate tests with transactions or truncation.
- **Freeze time** (`vi.useFakeTimers()`, or inject a clock).
- Run integration tests in CI with service containers.
- Treat **flaky tests as bugs**.

### How do you containerise a Node app for production? 🔥

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts          # production deps only, exactly from the lockfile

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node                                        # never run as root
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:3000/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/server.js"]   # node as PID 1 → receives SIGTERM (or use tini / --init)
```

**Key points:**

- **Multi-stage builds** mean the build tools, dev dependencies and sources aren't in the final image.
- **Copy the lockfile first**, so the dependency layer is cached between builds.
- Use **`npm ci`**, not `npm install`. Add a `.dockerignore` (`node_modules`, `.git`, `.env`, `coverage`).
- **Base image choice:**
  - `-slim` (Debian, glibc) is safest for native modules.
  - **Alpine** (musl) is smaller, but sometimes breaks native addons and has DNS quirks.
  - **Distroless** is smallest, with no shell (harder to debug).
- **`NODE_ENV=production`** enables production behaviour in Express and other libraries.
- **Memory:** set `--max-old-space-size` relative to the container limit.
- **Pin the base image version** (or digest), scan images (Trivy, ECR scanning), and rebuild regularly for security patches.

### How do you tune Node service performance?

**A checklist, roughly by impact:**

1. **Measure first.** Load test with k6 or autocannon, then profile (flame graphs) and trace. Find the actual bottleneck.
2. **Database:** indexes, N+1 fixes, pooling, caching. This is usually the biggest win.
3. **Don't block the event loop:**
   - Move CPU work to workers.
   - Use streams for big payloads.
   - Avoid sync APIs.
   - Avoid giant `JSON.stringify` calls.
4. **Framework overhead:**
   - **Fastify** is notably faster than Express. Its schema-based serialisation (`fast-json-stringify`) speeds up responses.
   - Remove unneeded middleware from hot routes.
5. **HTTP:**
   - Keep-alive for outbound calls (undici pools).
   - Compression at the proxy or CDN.
   - Correct keep-alive timeouts behind load balancers.
   - HTTP caching headers.
6. **Use all cores:** run multiple instances (containers or cluster), and scale horizontally behind the load balancer.
7. **Memory and GC:** reduce allocations in hot paths; tune the heap size.
8. **Edge and CDN:** cache public GETs and serve static assets from a CDN.

### What's different about running Node on AWS Lambda? 🔥

```node
// Initialise outside the handler: reused across warm invocations
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));   // SDK v3 keeps connections alive by default

export const handler = async (event) => {
  const id = event.pathParameters?.id;
  const { Item } = await ddb.send(new GetCommand({ TableName: process.env.TABLE, Key: { pk: `DRAW#${id}`, sk: 'META' } }));
  return Item
    ? { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(Item) }
    : { statusCode: 404, body: '' };
};
```

**Cold starts:**

- **Bundle and tree-shake** with esbuild (SAM/CDK do this) to shrink the code size.
- Import only the SDK v3 clients you need.
- Avoid heavy initialisation.
- **Provisioned concurrency** for latency-critical functions. **SnapStart** is available for Java, Python and .NET, not Node, at the time of writing.
- Pick the right memory size: **memory also scales CPU**.

**Connections:**

- Reuse clients across invocations.
- For relational databases, use **RDS Proxy** or the Data API.
- Keep pool `max` small.

**Middleware:** **Middy** handles validation, error handling, CORS and secrets caching.

**Idempotency:** async invocations and SQS/EventBridge deliveries can repeat. Use **Lambda Powertools idempotency** (a DynamoDB-backed store).

**Limits:** a 15-minute timeout, 6 MB synchronous payloads, `/tmp` up to 10 GB. Move long work to Step Functions, Fargate or queues.

See [AWS & Serverless](/docs/aws-serverless).

### How do you set up TypeScript for a Node backend? 🔥

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "outDir": "dist",
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

**Points interviewers like:**

- **`strict` plus `noUncheckedIndexedAccess`** catches the `undefined` bugs (`arr[0]` is `T | undefined`).
- **`module: NodeNext`** matches Node's real ESM/CJS rules: you need `.js` extensions in relative imports, and it honours the package.json `exports` field.
- **`paths` aliases only affect type checking.** At runtime Node doesn't know `@/services`. Use **package.json `imports` (`#src/*`)**, which works in Node natively, or a bundler.
- **Build options:**
  - `tsc` for libraries (it emits `.d.ts` files).
  - **esbuild, tsup or SWC** for fast application builds.
  - Node's **type stripping** (`node src/server.ts`) for scripts and development. Still run **`tsc --noEmit` in CI**, because nothing else type-checks.
- **Types vanish at runtime,** so validate external data with zod and infer the types from the schemas.
- **Typed errors and results:** discriminated unions (`{ ok: true, data } | { ok: false, error }`) for expected failures. Exceptions are for the unexpected.
