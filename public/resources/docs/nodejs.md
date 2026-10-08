# Node.js & Express

You built **Node.js back ends** (LoadOTR), work with **Docker-based microservices** at MeetHour, and run serverless Node on **AWS Lambda**. For full-stack roles, expect questions on the **event loop and libuv, streams and backpressure, scaling (cluster vs worker threads), Express middleware and error handling, security and graceful shutdown**.

> Node-specific code (needs `fs`, `http`, `process`…) is labelled **Node.js** and isn't runnable in the browser playground. The runnable blocks reproduce the core ideas (middleware composition, caching, concurrency) in plain JavaScript.

## Runtime internals

### What is Node.js and how does it achieve concurrency on a single thread? 🔥

Node.js is a JavaScript runtime built on **V8** (the JS engine) and **libuv** (a C library providing the **event loop**, async I/O and a **thread pool**).

- **Your JavaScript runs on one main thread.** Concurrency comes from **non-blocking I/O**. When you read a file or make a network request, Node hands the work to the OS or libuv and continues running other JS. When the I/O completes, a callback is queued and run on the main thread.
- **Network I/O** uses the OS's async mechanisms (**epoll** on Linux, **kqueue** on macOS, **IOCP** on Windows), so no threads are needed.
- **The libuv thread pool** (default **4 threads**, `UV_THREADPOOL_SIZE` up to 1024) handles operations that have no async OS API:
  - most **`fs`** operations
  - **`dns.lookup`**
  - **`crypto`** functions such as `pbkdf2`, `scrypt` and `randomBytes`
  - **`zlib`**
- **Great for:** I/O-bound, high-concurrency services (APIs, real-time servers, BFFs, proxies, signalling servers).
- **Poor for:** CPU-heavy work on the main thread (image or video processing, big computations), unless you use worker threads or native modules.

### Explain the Node.js event loop phases 🔥

Each loop iteration ("tick") goes through **phases**, each with its own FIFO queue:

1. **timers:** callbacks from `setTimeout`/`setInterval` whose time has elapsed.
2. **pending callbacks:** some system-level I/O callbacks deferred from the previous iteration (e.g. TCP errors).
3. **idle, prepare:** internal.
4. **poll:** **retrieve new I/O events and run their callbacks**. If nothing is pending, the loop **waits here** for I/O, bounded by the nearest timer.
5. **check:** **`setImmediate`** callbacks.
6. **close callbacks:** e.g. `socket.on('close')`.

**Between every individual callback** (Node ≥ 11), Node drains:

1. the **`process.nextTick` queue** first
2. then the **promise microtask queue**

```node
const fs = require('fs');

setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
console.log('sync');
// sync → nextTick → promise → (timeout, immediate in either order from the main module!)

fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout in I/O'), 0);
  setImmediate(() => console.log('immediate in I/O'));
  // inside an I/O callback: ALWAYS immediate first (check phase comes right after poll)
});
```

**Classic questions:**

- *`setTimeout(fn, 0)` vs `setImmediate` from the main module?* The order is **non-deterministic**: it depends on whether 1 ms has elapsed when the loop starts. **Inside an I/O callback**, `setImmediate` always runs first.
- *`process.nextTick` vs `queueMicrotask`/promises?* `nextTick` runs **before** promise microtasks. A recursive `nextTick` can **starve** the event loop (I/O never runs). Prefer `queueMicrotask`/`setImmediate` for deferral.

### What blocks the event loop and how do you detect and fix it? 🔥

**Blocking causes:**

- synchronous APIs in request paths (`fs.readFileSync`, `crypto.pbkdf2Sync`, `zlib.gzipSync`)
- **`JSON.parse`/`JSON.stringify` of huge payloads**
- **CPU-heavy loops** (sorting large arrays, image processing, PDF parsing)
- **ReDoS**: regexes with catastrophic backtracking on attacker input (e.g. `/(a+)+$/`)
- giant synchronous template rendering

**Symptoms:** **all** requests slow down together, health checks time out, and latency is spiky.

**Detection:**

- **event-loop lag/utilisation metrics** (`perf_hooks.monitorEventLoopDelay`, `performance.eventLoopUtilization()`)
- APM tools
- `clinic doctor` / `clinic flame`, `0x`, `node --prof`, `--cpu-prof`
- Chrome DevTools via `--inspect`

**Fixes:**

- **Async APIs** everywhere in request paths.
- **`worker_threads`** for CPU-bound work, or a separate service or queue (SQS + worker processes).
- **Chunk work** and yield with `setImmediate`.
- **Streaming JSON** for huge data. Limit body sizes.
- **Safe regexes** (RE2, `safe-regex` checks), and length limits on input.

### Streams and backpressure: explain them with an example 🔥

**Streams** process data **incrementally in chunks** instead of loading everything into memory.

| Type | Examples |
|---|---|
| **Readable** | `fs.createReadStream`, HTTP request (server side), `process.stdin` |
| **Writable** | `fs.createWriteStream`, HTTP response, `process.stdout` |
| **Duplex** | TCP socket |
| **Transform** | `zlib.createGzip()`, encryption, CSV parsing |

**Backpressure:** when a writable can't keep up (a slow client or disk), its internal buffer fills past **`highWaterMark`**, and **`writable.write()` returns `false`**. A correct producer **pauses** until the **`'drain'`** event. **`stream.pipeline()`** (or `.pipe()`) handles backpressure **and errors and cleanup** automatically. Ignoring backpressure means unbounded memory growth and eventually out-of-memory crashes.

```node
const { pipeline } = require('node:stream/promises');
const fs = require('node:fs');
const zlib = require('node:zlib');
const http = require('node:http');

// Stream a large recording to the client, gzip on the fly, constant memory usage
http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Encoding': 'gzip' });
  try {
    await pipeline(fs.createReadStream('/recordings/meeting-123.mp4'), zlib.createGzip(), res);
  } catch (err) {
    console.error('stream failed', err);                     // client aborted, disk error…
    res.destroy(err);
  }
}).listen(3000);

// Manual backpressure (what pipeline does for you)
function writeMany(writable, lines) {
  let i = 0;
  (function writeChunk() {
    let ok = true;
    while (i < lines.length && ok) ok = writable.write(lines[i++] + '\n');
    if (i < lines.length) writable.once('drain', writeChunk);    // wait for the buffer to empty
    else writable.end();
  })();
}

// Async iteration over a readable (inside an async function or an ES module)
for await (const chunk of fs.createReadStream('big.csv', { encoding: 'utf8', highWaterMark: 64 * 1024 })) {
  processChunk(chunk);
}
```

### Cluster vs worker_threads vs child_process: when do you use each? 🔥

| | `cluster` | `worker_threads` | `child_process` |
|---|---|---|---|
| What | Multiple **processes** of the same server sharing a port (the primary distributes connections) | **Threads** inside one process, each with its own V8 isolate and event loop | Spawn **separate programs** (`spawn`, `exec`, `fork`) |
| Memory | Separate heaps | Separate heaps; can **share memory** via `SharedArrayBuffer` and **transfer** `ArrayBuffer`s | Separate |
| Communication | IPC messages | `postMessage` / `MessageChannel`, shared memory | stdio streams, IPC (`fork`) |
| Use for | **Using all CPU cores** for an HTTP server | **CPU-intensive tasks** in a server (image resize, PDF parsing, hashing) without blocking the event loop | Running external tools: **ffmpeg**, ImageMagick, git, Python scripts |

**In containers and Kubernetes,** prefer **one Node process per container** and scale **horizontally** with replicas. Clustering inside a container complicates resource limits. PM2 is popular on bare VMs.

```node
// worker pool for CPU-heavy work (e.g. generating waveform data for a recording)
const { Worker } = require('node:worker_threads');
function runInWorker(file, data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(file, { workerData: data });
    w.once('message', resolve);
    w.once('error', reject);
    w.once('exit', (code) => code !== 0 && reject(new Error(`worker exited ${code}`)));
  });
}
// In production use a pool (piscina) instead of one worker per task.
```

### CommonJS vs ES Modules in Node: what changed recently?

- **CJS:** `require`/`module.exports`, synchronous, `__dirname`. **ESM:** `import`/`export`, static, async loading, top-level await, `import.meta.url`, plus **`import.meta.dirname`/`filename`** (Node 20.11+).
- **Selecting the system:** `"type": "module"` in `package.json` (`.js` files become ESM), or the `.mjs`/`.cjs` extensions.
- **Interop:**
  - ESM can import CJS (as a default export, plus statically detectable named exports)
  - **`require(esm)`** works in modern Node (22.12+/20.19+) for ESM graphs without top-level await, which ended much of the dual-package pain
- **Packages:** the `"exports"` field with conditional exports (`import`/`require`/`types`).
- **Other modern Node features:**
  - built-in **`fetch`**, the `node:test` runner, `--watch`, `--env-file`
  - **TypeScript type stripping** (enabled by default in newer releases, erasable syntax only)
  - a WebSocket client, a permission model, `node:sqlite`

## Express & API design

### How does Express middleware work? Show the pipeline 🔥

Express is a minimal framework where **everything is middleware**: functions `(req, res, next)` executed **in the order they're registered**, for matching paths and methods.

- A middleware can:
  - **modify `req`/`res`** (parse the body, attach `req.user`)
  - **end the response** (`res.json(...)`)
  - **pass control** with `next()`
  - **signal an error** with `next(err)`
- **Error-handling middleware** has **four arguments** `(err, req, res, next)` and is registered **last**. Express skips normal middleware and jumps to it when `next(err)` is called or a sync error is thrown.
- **Async errors:**
  - **Express 4** doesn't catch rejected promises: wrap handlers or use `express-async-errors`
  - **Express 5** (stable since 2024) **forwards rejected promises** to error middleware automatically
- **Order matters:** security headers → CORS → body parsers → auth → routes → 404 handler → error handler.

Here's a **runnable** model of the middleware pipeline, the same `compose` idea that powers Express and Koa:

```js
// Minimal Express-like app: use(), route matching, next(), async errors, error middleware
function createApp() {
  const stack = [];
  const app = {
    use(path, fn) { if (typeof path === 'function') [path, fn] = ['/', path]; stack.push({ path, fn }); return app; },
    get(path, fn) { stack.push({ path, method: 'GET', fn, exact: true }); return app; },
    async handle(req) {
      const res = { status: 200, headers: {}, body: undefined, ended: false,
        set(k, v) { this.headers[k] = v; return this; }, code(s) { this.status = s; return this; },
        json(b) { this.body = b; this.ended = true; return this; } };
      let i = 0;
      const next = async (err) => {
        while (i < stack.length) {
          const layer = stack[i++];
          const pathOk = layer.exact ? req.path === layer.path : req.path.startsWith(layer.path);
          if (!pathOk || (layer.method && layer.method !== req.method)) continue;
          const isErrorHandler = layer.fn.length === 4;
          if (Boolean(err) !== isErrorHandler) continue;             // errors skip to 4-arg handlers
          try {
            return await (err ? layer.fn(err, req, res, next) : layer.fn(req, res, next)); // async errors caught (Express 5 style)
          } catch (e) {
            return next(e);
          }
        }
        if (err) res.code(500).json({ error: 'Internal Server Error' });
        else if (!res.ended) res.code(404).json({ error: 'Not Found' });
      };
      await next();
      return res;
    },
  };
  return app;
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

const app = createApp()
  .use((req, res, next) => { res.set('X-Request-Id', 'req-1'); return next(); })            // logging/request id
  .use('/api', (req, res, next) => {                                                        // auth for /api only
    if (req.headers.authorization !== 'Bearer good') throw new HttpError(401, 'Unauthorized');
    req.user = { id: 'u1', role: 'dispatcher' };
    return next();
  })
  .get('/api/loads', async (req, res) => res.json([{ id: 'L1', status: 'in-transit', owner: req.user.id }]))
  .get('/api/boom', async () => { throw new Error('db down'); })
  .use((err, req, res, next) => res.code(err.status ?? 500).json({ error: err.status ? err.message : 'Internal Server Error' }));

const results = await Promise.all([
  app.handle({ method: 'GET', path: '/api/loads', headers: { authorization: 'Bearer good' } }),
  app.handle({ method: 'GET', path: '/api/loads', headers: {} }),
  app.handle({ method: 'GET', path: '/api/boom', headers: { authorization: 'Bearer good' } }),
  app.handle({ method: 'GET', path: '/nope', headers: {} }),
]);
console.table(results.map((r) => ({ status: r.status, body: JSON.stringify(r.body), requestId: r.headers['X-Request-Id'] })));

test('middleware order, auth, async errors and 404', () => {
  expect(results.map((r) => r.status)).toEqual([200, 401, 500, 404]);
  expect(results[0].body[0].owner).toBe('u1');
  expect(results[2].body.error).toBe('Internal Server Error');     // don't leak internal messages
});
```

### How do you structure a production Node.js API (e.g. LoadOTR)? 🔥

```text
src/
  app.ts            # express app: middleware, routes, error handler (no listen → easy to test)
  server.ts         # http server, graceful shutdown
  config/           # env parsing + validation (zod), fail fast on bad config
  routes/           # HTTP layer: routing, request validation, mapping to services
  controllers/      # (optional) thin adapters req/res ↔ service calls
  services/         # business logic (assign load to vendor, compute payouts) — framework-agnostic, unit tested
  repositories/     # data access (SQL via Prisma/Knex/pg), transactions
  middleware/       # auth (JWT), RBAC, rate limit, request id, error handler
  lib/              # logger (pino), http clients, queue producers
  jobs/             # background workers (BullMQ/SQS consumers)
tests/              # unit (services), integration (supertest + test DB)
```

**Principles:**

- Layers with **clear dependencies**: routes → services → repositories. Business logic doesn't know about Express.
- **Validate at the boundary** (zod or joi schemas for body, query and params). Return **consistent errors** (RFC 9457 problem details).
- **Config from the environment**, validated at startup. Secrets come from a secret manager.
- **Structured logging** with request IDs; metrics; tracing (OpenTelemetry).
- **Idempotency keys** for POSTs that clients may retry (creating loads or payments).
- **Database:** connection pooling, migrations, transactions for multi-step updates.

### How do you handle errors and shut down gracefully? 🔥

**Error categories:**

- **Operational errors** (expected: network failures, validation errors, 404s): handle them, log them, return proper status codes.
- **Programmer errors** (bugs: undefined access, wrong types): **crash and restart** is the safest response. The process state may be corrupt; the orchestrator restarts it.

**Process-level events:**

- **`unhandledRejection`:** since Node 15 the default is **throw → crash**. Log it, then exit.
- **`uncaughtException`:** log and **exit**. Don't keep serving traffic.

**Graceful shutdown** (critical in Docker/Kubernetes, where `SIGTERM` arrives before `SIGKILL` after a grace period):

1. Stop accepting new connections (`server.close()`), and **fail readiness checks** so the load balancer stops routing to this instance.
2. Let in-flight requests finish, with a timeout.
3. Close WebSockets with a "reconnect" code; drain queue consumers.
4. Close DB pools and Redis connections; flush logs.
5. Exit with code 0. Force-exit after a deadline.

```node
const server = app.listen(PORT);
let shuttingDown = false;

app.get('/health/ready', (req, res) => res.status(shuttingDown ? 503 : 200).end());

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 25_000).unref();   // < k8s terminationGracePeriodSeconds
  server.close(async () => {
    await Promise.allSettled([db.end(), redis.quit(), queue.close()]);
    clearTimeout(force);
    process.exit(0);
  });
  // Node 18.2+: close idle keep-alive sockets so server.close() can finish
  server.closeIdleConnections?.();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', (reason) => { logger.fatal({ reason }, 'unhandled rejection'); shutdown('unhandledRejection'); });
```

**Docker detail:** run Node as **PID 1 correctly**. Use `CMD ["node", "server.js"]` (exec form) or `--init`/tini, so signals reach Node. `npm start` as PID 1 may not forward SIGTERM.

### How do you secure a Node.js/Express API? 🔥

1. **Input validation** on every route (zod/joi). Reject unknown fields, which also blocks **prototype pollution** payloads. Limit body size (`express.json({ limit: '100kb' })`).
2. **Injection:**
   - **parameterised queries** or an ORM (never string-concatenated SQL)
   - avoid `eval`/`Function`/`vm` with user input
   - beware **NoSQL injection** (`{ "$gt": "" }` in Mongo queries); sanitise operators
   - **command injection**: `execFile`/`spawn` with argument arrays, never `exec` with user strings
3. **AuthN/AuthZ:** verify JWTs properly (algorithm pinned, `iss`/`aud`/`exp`). Check authorisation **per resource** (owner/role/tenant), which prevents **IDOR**: `/loads/123` must check that the user may access load 123.
4. **Security headers** with **helmet**. **CORS** with explicit origins. **Rate limiting** (`express-rate-limit` + Redis store) and brute-force protection on login.
5. **ReDoS:** safe regexes, input length limits. **Path traversal:** `path.resolve` and check the result stays under the base directory. **SSRF:** validate outbound URLs (block internal IP ranges, metadata endpoints such as `169.254.169.254`).
6. **Secrets:** environment variables or a secret manager. Never log secrets or tokens; scrub PII in logs.
7. **Dependencies:** lockfiles, `npm audit`/Snyk/Dependabot, minimal dependencies, and pinning given recent npm supply-chain attacks.
8. **Run as a non-root user** in containers, with a read-only filesystem where possible. Keep Node on an **LTS** release.

### How do you scale and optimise a Node.js service? 🔥

- **Stateless servers:** sessions in Redis or JWT, files in S3. Then **scale horizontally** behind a load balancer (multiple containers or pods, or cluster mode across cores).
- **Caching:**
  - in-process LRU for hot, small data (per instance, so watch consistency)
  - **Redis** for shared caching (cache-aside pattern, TTLs, stampede protection)
  - HTTP caching and CDNs for public responses
- **Database:**
  - **connection pooling** (`pg.Pool` sized correctly; PgBouncer with many instances or Lambdas)
  - indexes, avoiding N+1 queries, read replicas
- **Async offloading:** queue slow tasks (emails, transcoding, PDF processing) with **BullMQ/SQS** and process them in workers. Respond fast with a job ID.
- **HTTP:** keep-alive agents for outbound calls (undici), compression (better done at a proxy or CDN), HTTP/2 at the edge.
- **Profiling:** flame graphs (clinic/0x), heap snapshots for **memory leaks** (common causes: unbounded caches, listeners never removed, closures holding big objects, global arrays). `--max-old-space-size` sized to the container memory.
- **Observability:** p50/p95/p99 latency, event-loop delay, heap usage, GC pauses, error rates, saturation.

```js
// Cache-aside with request coalescing: concurrent misses for the same key share one DB call
function createCache({ ttlMs, load }) {
  const store = new Map();          // key -> { value, expires }
  const inflight = new Map();       // key -> Promise (stampede protection)
  let loads = 0;
  return {
    get loads() { return loads; },
    async get(key) {
      const hit = store.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;
      if (inflight.has(key)) return inflight.get(key);
      const p = (async () => {
        try {
          loads++;
          const value = await load(key);
          store.set(key, { value, expires: Date.now() + ttlMs });
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    },
  };
}

const vendorCache = createCache({ ttlMs: 1000, load: async (id) => { await new Promise((r) => setTimeout(r, 20)); return { id, name: `Vendor ${id}` }; } });
const burst = await Promise.all(Array.from({ length: 50 }, () => vendorCache.get('v42')));   // 50 concurrent requests
await vendorCache.get('v42');                                                                 // served from cache
console.log(burst[0], 'DB loads:', vendorCache.loads);

test('50 concurrent misses trigger a single load', () => {
  expect(vendorCache.loads).toBe(1);
  expect(new Set(burst).size).toBe(1);
});
```

### Express vs Fastify vs NestJS vs Hono: how do you choose?

| | Express | Fastify | NestJS | Hono |
|---|---|---|---|---|
| Style | Minimal, unopinionated middleware | Fast, **schema-based** (JSON Schema validation and serialisation), plugin system, built-in logging (pino) | **Opinionated framework**: modules, DI, decorators, controllers and providers (Angular-like); runs on Express or Fastify | Tiny, **Web Standards** (Request/Response) based; runs on Node, Bun, Deno, **edge and Lambda** |
| Performance | Fine | **High** | Depends on the adapter | High, small |
| Best for | Simple services, huge ecosystem, legacy | High-throughput JSON APIs | Large teams wanting structure (enterprise, microservices with gRPC/Kafka transports) | Edge or serverless APIs, multi-runtime |

### REST API design best practices 🔥

- **Resources and nouns:** `GET /loads`, `GET /loads/:id`, `POST /loads`, `PATCH /loads/:id`, `DELETE /loads/:id`. Use sub-resources for relations (`/loads/:id/stops`).
- **Status codes:**
  - `200` OK, `201` Created (with `Location`), `204` No Content
  - `400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict (version mismatch)
  - `422` semantic validation, `429` rate limited (with `Retry-After`)
  - `500`/`503`
- **Idempotency:** GET, PUT and DELETE are idempotent. Make **POST idempotent** with an `Idempotency-Key` header for retries.
- **Pagination:** cursor (`?limit=50&after=…`, returning `nextCursor`) for large or real-time data; offset for simple admin lists. **Filtering and sorting:** `?status=in-transit&sort=-updatedAt`.
- **Versioning:** a URL prefix (`/v1`) or headers. Add fields backward-compatibly; never break existing clients silently.
- **Concurrency:** `ETag` + `If-Match` for optimistic locking on updates.
- **Errors:** a consistent JSON problem format (`type`, `title`, `status`, `detail`, field errors). Never leak stack traces.
- **Documentation:** **OpenAPI** spec, generated clients and types, contract tests.
