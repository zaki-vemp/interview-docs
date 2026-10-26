# Node.js Internals Deep Dive

[Node.js & Express](/docs/nodejs) covers the essentials: event loop phases, streams, cluster vs workers, Express. This doc is the **"how does it actually work"** layer that senior interviews dig into:

- **V8:** JIT tiers, hidden classes, garbage collection, memory leaks.
- **libuv:** the thread pool and why `crypto` can stall your API.
- **Exact callback ordering** across `nextTick`, promises, timers and `setImmediate`.
- **Module loading:** CommonJS internals, ESM, `require(esm)`, `package.json` exports.
- **I/O primitives:** Buffers, encodings, streams, EventEmitter semantics.
- **Concurrency:** worker threads, child processes, AsyncLocalStorage.
- **Operations:** diagnostics, HTTP keep-alive pitfalls behind load balancers, security bugs specific to JavaScript, and what changed in Node 20–24.

> Node-only APIs (`process.nextTick`, `fs`, `worker_threads`) can't run in the browser playground. Those snippets are labelled **Node.js** and list their output. The language-level mechanics (a **CommonJS loader with circular dependencies**, **streaming UTF-8 decoding**, **pull-based async-iterator pipelines**, **EventEmitter semantics** and **prototype pollution**) are **runnable JavaScript with tests**.

## V8: how your JavaScript actually runs

### How does V8 execute JavaScript? Explain the JIT pipeline 🔥

V8 compiles JavaScript through **tiers**, trading compile time for execution speed as code gets "hot":

| Tier | What it does | When |
|---|---|---|
| **Parser** | Source → AST. **Lazy parsing**: inner functions are only pre-parsed until called | Load time |
| **Ignition** | AST → **bytecode**, run by an interpreter; collects **type feedback** (which shapes and types each operation sees) | First execution |
| **Sparkplug** | A fast **baseline compiler**: bytecode → unoptimised machine code with no optimisation | Code that's warm |
| **Maglev** | A **mid-tier optimising** compiler: quick to compile, uses type feedback | Hot code (V8 11.x+, in Node 22+) |
| **TurboFan** | The **top-tier optimising** compiler: inlining, escape analysis, speculative optimisation based on feedback | Very hot code |

**Speculation and deoptimisation:**

- Optimised code **assumes** what it has seen so far. For example, `add(a, b)` always received small integers.
- If the assumption breaks (a string arrives), V8 **deoptimises**: it bails out to bytecode and may re-optimise later.
- Frequent deopts ("deopt loops") hurt performance.

**Practical consequences for Node services:**

- **Keep hot functions monomorphic:** the same argument types and object shapes.
- Don't mix types in hot arrays: `[1, 2, 'three']` loses the packed SMI (small integer) element representation.
- **Diagnose** with `node --trace-opt --trace-deopt app.js`, or with CPU profiles in DevTools (look for "deoptimized" markers).
- **Benchmark after warm-up.** The first iterations measure the interpreter, not your code.

### What are hidden classes and inline caches? 🔥

JavaScript objects are dynamic, but V8 gives them **hidden classes** (also called **shapes** or **maps**) internally:

- Objects created with the **same properties in the same order** share a hidden class.
- A property's location then becomes a **fixed offset**, as in a C struct.

**Inline caches (ICs)** remember, at each property-access site, which hidden class was seen and where the property lives:

| IC state | Shapes seen at the site | Speed |
|---|---|---|
| **Monomorphic** | 1 | Fastest: a direct offset load |
| **Polymorphic** | 2–4 | A small lookup table |
| **Megamorphic** | Many | Falls back to a generic, slow lookup |

```js
// Shape-friendly vs shape-hostile code (the behaviour is the same; the performance profile differs)
class Participant {
  constructor(id, name, role) {
    this.id = id;           // initialise ALL fields in the constructor, in a fixed order
    this.name = name;
    this.role = role;
    this.mutedAt = null;    // declare optional fields up front instead of adding them later
  }
}

const fast = [new Participant(1, 'Asha', 'host'), new Participant(2, 'Ravi', 'guest')];   // one shared shape

const slow = [{ id: 1, name: 'Asha' }, { name: 'Ravi', id: 2 }];   // different property order → different shapes
slow[0].role = 'host';      // adding properties later creates new shape transitions
delete slow[1].name;        // delete usually drops the object into slow "dictionary mode"

console.log(fast.map((p) => p.name), slow.length);
```

**Rules of thumb:**

- Initialise every property in the constructor, in a consistent order.
- Prefer classes or factory functions over ad-hoc object literals for hot data.
- **Avoid `delete`** on hot objects. Set the property to `undefined` instead, or use a `Map` for truly dynamic keys.
- Don't change the type of a property (number → string).

**Keep it in proportion:** this matters for hot paths (parsers, media stats processing, tight loops). It doesn't matter for typical request handlers, where I/O dominates.

### How does V8 manage memory and garbage collection? 🔥

**Heap layout (simplified):**

| Space | Contents | GC |
|---|---|---|
| **New space** (young generation) | Newly allocated objects; two semi-spaces | **Scavenger** (minor GC): copies live objects between the semi-spaces. Fast, frequent; most objects die young |
| **Old space** | Objects that survived two scavenges | **Mark-Compact** (major GC): mark live objects, sweep, compact. Less frequent, more expensive |
| Large object space | Objects above a size threshold (never moved) | Major GC |
| Code space | JIT-compiled code | Major GC |
| **External memory** | `Buffer`/`ArrayBuffer` backing stores | Freed when their JS wrappers are collected |

**The Orinoco garbage collector reduces pauses:**

- **Parallel** scavenging on helper threads.
- **Concurrent marking** while JavaScript runs.
- **Incremental marking** in small steps.
- **Lazy and concurrent sweeping.**
- Major GC pauses are usually milliseconds, but a **large heap with many live objects still means longer pauses**.

**`process.memoryUsage()` fields:**

| Field | Meaning |
|---|---|
| `rss` | Total resident memory of the process: heap + stacks + code + native allocations + Buffers |
| `heapTotal` / `heapUsed` | The V8 heap allocated, and in use |
| `external` | Memory of C++ objects bound to JS (includes ArrayBuffers) |
| `arrayBuffers` | Buffer and ArrayBuffer memory |

**Heap limits in containers:**

- The V8 old-space limit is derived from system memory. Set it **explicitly** with `--max-old-space-size=<MB>`, for example ~75% of the container limit, leaving room for Buffers and native memory.
- Otherwise the process may be **OOM-killed by the kernel or cgroup** before V8's own limit triggers a GC.
- When the heap hits its limit you get: `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`.

**Useful flags:**

- `--trace-gc` prints GC events.
- `--heapsnapshot-near-heap-limit=2` writes heap snapshots right before an OOM crash.
- `--max-semi-space-size` tunes the young generation for high allocation rates.

### What causes memory leaks in Node, and how do you find them? 🔥

**Common causes:**

| Leak | Example | Fix |
|---|---|---|
| **Unbounded caches and maps** | `const cache = {}` keyed by request params; a Map of sessions never cleaned | **LRU with a max size and TTL** (`lru-cache`), or Redis |
| **Event listeners never removed** | `emitter.on('data', …)` per request on a long-lived emitter or socket | `off()` or `once`, `AbortSignal` with `events.on`; watch for `MaxListenersExceededWarning` |
| **Timers and intervals** | `setInterval` per connection, never cleared | Clear on close or disconnect |
| **Closures retaining big objects** | A callback captures a large `req` or `buffer` and is stored somewhere long-lived | Capture only what you need |
| **Promises that never settle** | Awaiting forever keeps the whole chain's scope alive | Timeouts and `AbortSignal` |
| **Global accumulators** | Arrays of metrics or logs growing forever | Flush and cap them |
| **Native or Buffer leaks** | `rss` grows while `heapUsed` stays flat | Look at `external`/`arrayBuffers`, native modules, `Buffer` retention |

**Finding leaks:**

1. **Confirm it:** `heapUsed` (or `rss`) keeps rising across many GC cycles under steady load. A sawtooth pattern is normal; a rising baseline isn't.
2. **Take heap snapshots:**
   - `node --inspect`, then Chrome DevTools → Memory.
   - Or programmatically: `v8.writeHeapSnapshot()`, or `--heapsnapshot-signal=SIGUSR2`.
3. **Compare** snapshot A (after warm-up) with snapshot B (after N requests). Sort by **"Objects allocated between snapshots"** or by *delta*, then follow the **retainers** chain to the GC root holding them.
4. **Allocation timelines / sampling** (DevTools "Allocation instrumentation", `clinic heapprofiler`) show which code allocates the leaking objects.
5. Load-test with `autocannon` to reproduce.

**Weak references help with metadata caches:**

- **`WeakMap`/`WeakSet`** keys don't prevent GC. Use them to attach metadata to objects you don't own.
- **`WeakRef` and `FinalizationRegistry`** exist, but finalisation timing isn't guaranteed. Never use them for program logic.

## libuv & the event loop

### What does libuv do, and what runs on the thread pool? 🔥

**libuv** is Node's C library for async I/O. It provides the **event loop** and abstracts the OS mechanisms:

| Work | How libuv does it | Thread pool? |
|---|---|---|
| **TCP/UDP sockets, HTTP, pipes** | OS readiness notification: **epoll** (Linux), **kqueue** (macOS), **IOCP** (Windows) | **No.** One thread handles thousands of sockets |
| **File system** (`fs.readFile`, `fs.stat`…) | Blocking syscalls run on worker threads (portable file async I/O isn't available everywhere) | **Yes** |
| **`dns.lookup`** (used by `http.get('host')` by default) | `getaddrinfo`, which is blocking | **Yes** |
| `dns.resolve*` | c-ares, asynchronous network DNS | No |
| **crypto async:** `pbkdf2`, `scrypt`, `randomBytes`, `generateKeyPair`, `hkdf` | CPU work on worker threads | **Yes** |
| **zlib async** (`gzip`, `brotliCompress`) | CPU work | **Yes** |
| Timers, `setImmediate` | Loop data structures (a min-heap of timers) | No |

**The thread pool:**

- The **default size is 4**.
- Set it with **`UV_THREADPOOL_SIZE`** (max 1024), in the environment **before the process starts**. Setting it inside JS only works if it happens before the pool is first used.
- The **pool is shared** by fs, DNS lookups, crypto and zlib.

### How can the thread pool become a bottleneck? 🔥

With **4 threads**, a 5th concurrent `pbkdf2` call **waits** until one finishes:

```node
const crypto = require('node:crypto');
const start = Date.now();
for (let i = 1; i <= 6; i++) {
  crypto.pbkdf2('password', 'salt', 300_000, 64, 'sha512', () => {
    console.log(`hash ${i} done after ${Date.now() - start} ms`);
  });
}
// Typical output with the default pool (4 threads) on a 4+ core machine:
// hash 1..4 done after ~180 ms (in parallel)
// hash 5..6 done after ~360 ms (they waited for a free thread)
```

**Real incidents this causes:**

- **Password hashing during a login spike** fills the pool. Then **every `fs` call and `dns.lookup` queues behind it**, so unrelated endpoints, file serving and even outgoing HTTP requests (DNS!) slow down.
- **Slow DNS:** `dns.lookup` holds a thread for the whole lookup. Many outgoing requests to new hosts can starve the pool.
- **Heavy `zlib` compression** of large responses.

**Fixes:**

- Increase `UV_THREADPOOL_SIZE` (for example to the core count, or higher for I/O-bound fs work).
- **Move CPU-heavy work to worker threads** or a separate service. Use `argon2`/`bcrypt` libraries that run off the main thread, and rate-limit login attempts.
- Cache DNS results, or use `dns.resolve`/keep-alive agents so connections are reused.
- Let the reverse proxy or CDN (Nginx, CloudFront) do compression instead of Node.

### Predict the order: `nextTick`, promises, `setTimeout`, `setImmediate` and I/O 🔥

**The rules (CommonJS module, Node 11+):**

1. **Synchronous code** runs to completion.
2. Then, after **each macrotask callback**, Node drains:
   1. the **`process.nextTick` queue** completely;
   2. then the **promise microtask queue** completely (`.then`, `await` continuations, `queueMicrotask`).
3. **Event loop phases:**
   1. **timers** (expired `setTimeout`/`setInterval`)
   2. pending callbacks
   3. **poll** (I/O callbacks)
   4. **check** (`setImmediate`)
   5. close callbacks

```node
console.log('1 sync');
setTimeout(() => console.log('6 timeout'), 0);
setImmediate(() => console.log('7 immediate'));
Promise.resolve().then(() => console.log('4 promise'));
queueMicrotask(() => console.log('5 microtask'));
process.nextTick(() => console.log('3 nextTick'));
console.log('2 sync');
// 1 sync, 2 sync, 3 nextTick, 4 promise, 5 microtask, then 6 timeout / 7 immediate
// ⚠ timeout vs immediate order is NOT guaranteed in the main module (depends on loop start timing)
```

```node
const fs = require('node:fs');
fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
// Inside an I/O callback: ALWAYS "immediate" then "timeout"
// (after poll comes check, so setImmediate runs before the loop wraps around to timers)
```

```node
setTimeout(() => {
  console.log('t1');
  Promise.resolve().then(() => console.log('p1'));
  process.nextTick(() => console.log('n1'));
}, 0);
setTimeout(() => console.log('t2'), 0);
// Node 11+: t1, n1, p1, t2 (both queues drain between the two timer callbacks, like browsers)
// Node ≤ 10: t1, t2, n1, p1 (microtasks ran only after the whole timers phase)
```

### `process.nextTick` vs `queueMicrotask` vs `setImmediate`: when do you use each?

| API | Runs | Use for | Danger |
|---|---|---|---|
| `process.nextTick(fn)` | **Before** promise microtasks, right after the current operation | Making a callback API **consistently async** (emit an event after the constructor returns, so the caller can attach listeners) | **Recursive nextTick starves the event loop.** I/O never runs |
| `queueMicrotask(fn)` | With promise microtasks | Standard (works in browsers too) microtask scheduling | Recursive microtasks also starve I/O |
| `setImmediate(fn)` | In the **check** phase, after I/O polling | **Yielding to I/O** between chunks of CPU work ("process 1,000 items, then setImmediate the rest") | — |
| `setTimeout(fn, 0)` | The timers phase (≥ 1 ms) | Delays | Clamped, less precise |

```node
// Classic nextTick use: let the caller attach listeners before the event fires
class Connection extends EventEmitter {
  constructor() {
    super();
    process.nextTick(() => this.emit('ready'));   // emitting synchronously here would fire before .on('ready') is attached
  }
}
new Connection().on('ready', () => console.log('ready!'));
```

**Rule:** prefer `queueMicrotask` or promises in new code. Use `setImmediate` to break up CPU-bound loops so I/O can interleave.

### How do timers work internally, and what do `unref()` and `timers/promises` do?

**Timer behaviour:**

- Timers live in lists **grouped by duration**, with a min-heap of expiry times. Adding thousands of timers with the same timeout is cheap.
- `setTimeout(fn, 0)` is really **≥ 1 ms**. Callbacks run in the timers phase **no earlier** than the delay, and later if the loop is busy.
- **`setInterval` drifts** under load: callbacks are skipped or delayed, never "caught up". For precise schedules, compute the next delay from wall time.

**`unref()` and `ref()`:**

- `timer.unref()` means "don't keep the process alive just for this timer".
- Use it for background refresh intervals in CLIs and tests, so the process can exit.
- `ref()` undoes it.
- **Sockets and servers have `unref()` too.**

**Promise-based timers:**

```node
const { setTimeout: sleep } = require('node:timers/promises');
await sleep(500);                                             // promise-based delay

// Cancellable waits and timeouts with AbortSignal
const res = await fetch(url, { signal: AbortSignal.timeout(3000) });   // aborts after 3 s
const ac = new AbortController();
const wait = sleep(10_000, null, { signal: ac.signal });      // rejects with AbortError when ac.abort() is called
```

## Modules

### How does `require()` work internally? Explain resolution, caching and circular dependencies 🔥

**1. Resolution** (`require(x)` from `/app/src/a.js`):

1. **Core modules** first (`fs`, `node:fs`).
2. **Relative or absolute paths:** try `x`, `x.js`, `x.json`, `x.node`, then `x/package.json` "main", then `x/index.js`.
3. **Bare specifiers** (`express`): walk **up** the directory tree looking in each `node_modules` (`/app/src/node_modules`, `/app/node_modules`, `/node_modules`). The package's **`exports`** field, if present, **restricts** what can be imported.

**2. Loading.** A `.js` file's code is wrapped in a function:

```node
(function (exports, require, module, __filename, __dirname) {
  // your module code
});
```

That's why these "globals" exist per module, and why top-level `var` doesn't leak to the global scope.

**3. Caching:**

- `require.cache[resolvedPath]` stores the `module` object.
- **A module executes once.** Every later `require` returns the same `module.exports` object, which makes modules **singletons**: a database pool, a config object.

**4. Circular dependencies:**

- The module is **cached before it finishes executing**.
- If A requires B and B requires A, **B gets A's *partially filled* exports**: whatever A had exported before its `require('B')` line.

The runnable loader below implements exactly these rules over an in-memory file system:

```js
// A tiny CommonJS loader: wrapper function + cache-before-execute (so cycles see partial exports)
function createLoader(files) {
  const cache = {};
  const executions = {};
  function require(path) {
    if (cache[path]) return cache[path].exports;                 // cache hit (maybe partial!)
    if (!(path in files)) throw new Error(`Cannot find module '${path}'`);
    const module = { exports: {}, loaded: false };
    cache[path] = module;                                        // cached BEFORE running the body
    executions[path] = (executions[path] ?? 0) + 1;
    const wrapper = new Function('exports', 'require', 'module', '__filename', files[path]);
    wrapper(module.exports, require, module, path);
    module.loaded = true;
    return module.exports;
  }
  return { require, cache, executions };
}

const files = {
  a: `exports.done = false;
      const b = require('b');
      exports.bSawADone = b.sawADone;
      exports.done = true;`,
  b: `const a = require('a');            // cycle: gets a's PARTIAL exports
      exports.sawADone = a.done;
      exports.done = true;`,
  counter: `let n = 0; exports.next = () => ++n;`,
  broken: `exports = { value: 42 };        // reassigns the local variable only`,
  fixed: `module.exports = { value: 42 };`,
};

test('circular require sees partially populated exports', () => {
  const { require } = createLoader(files);
  const a = require('a');
  expect(a.bSawADone).toBe(false);   // when b ran, a had only executed its first line
  expect(a.done).toBe(true);
});
test('modules execute once and are shared (singletons)', () => {
  const { require, executions } = createLoader(files);
  require('counter').next();
  expect(require('counter').next()).toBe(2);
  expect(executions.counter).toBe(1);
});
test('exports = {...} does not export; module.exports = {...} does', () => {
  const { require } = createLoader(files);
  expect(require('broken')).toEqual({});
  expect(require('fixed')).toEqual({ value: 42 });
});
```

**Fixing cycles:**

- Restructure: extract the shared code into a third module.
- Defer the `require` inside a function.
- Or export functions (looked up at call time) rather than values captured at load time.

**Interview tip:** "Circular imports are a design smell. They usually mean two modules should be one, or both depend on a missing abstraction."

### How do ES modules work in Node, and how do they interoperate with CommonJS? 🔥

**ESM loads in phases:**

1. **Parse and link:** the whole import graph is resolved and linked **before any code runs**. Imports are **static**, which enables tree-shaking and early errors.
2. **Evaluate:** modules execute in dependency order.
3. **Live bindings:** importers see the exporter's **current value**. A CJS `require` copies the value of `exports.x` at that moment.

**ESM vs CJS:**

| | **CommonJS** | **ES Modules** |
|---|---|---|
| Syntax | `require`, `module.exports` | `import`/`export` |
| Loading | Synchronous, at runtime, dynamic | **Asynchronous**, static graph (plus dynamic `import()`) |
| Top-level `await` | ❌ | ✅ |
| `__dirname`, `__filename` | ✅ | ❌. Use **`import.meta.dirname` / `import.meta.filename`** (Node 20.11+), or `fileURLToPath(import.meta.url)` |
| File extensions in imports | Optional | **Required** for relative imports (`./util.js`) |
| `this` at top level | `module.exports` | `undefined` |
| How Node decides | `.cjs`, or `.js` without `"type": "module"` | `.mjs`, or `.js` with **`"type": "module"`** in package.json |

**Interop rules:**

- **ESM importing CJS works:** `import pkg from 'cjs-lib'` gives `module.exports` as the default. Named imports work when Node's static analysis (cjs-module-lexer) can detect them.
- **CJS requiring ESM:**
  - Historically impossible; you had to use `await import()`.
  - **Since Node 22.12 (and 20.19), `require(esm)` works by default** for ES modules **without top-level await**. This removed much of the "ESM-only package" pain.
- **The dual-package hazard:** a package shipping both CJS and ESM builds can be **loaded twice** (once each way). You get two copies of singletons, and `instanceof` checks fail across copies.

**Conditional exports** in package.json:

```json
{
  "name": "@meethour/sdk",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./react": "./dist/react.js",
    "./package.json": "./package.json"
  },
  "imports": { "#internal/*": "./src/internal/*.js" },
  "engines": { "node": ">=20" },
  "sideEffects": false
}
```

- **`exports`** defines the public entry points. Deep imports like `@meethour/sdk/dist/secret.js` are **blocked**.
- **`imports`** (`#internal/*`) gives private, package-internal aliases.
- **`types`** must come first in each condition for TypeScript.

### What should you know about package.json, semver and lockfiles? 🔥

| Field | Purpose |
|---|---|
| `dependencies` / `devDependencies` | Runtime vs build and test dependencies (`npm ci --omit=dev` in production images) |
| **`peerDependencies`** | "The host app provides this" (React for a component library). Avoids duplicate Reacts |
| `optionalDependencies` | Installation may fail without failing the install (platform-specific binaries) |
| `engines` | Supported Node versions (enforced with `engine-strict`, or by CI) |
| `bin` | CLI executables |
| `scripts` | `pre`/`post` hooks. **`postinstall` scripts are a supply-chain risk** (`npm ci --ignore-scripts` where possible) |
| `overrides` (npm) / `resolutions` (Yarn) / `pnpm.overrides` | Force a transitive dependency version (patching a CVE) |

**Semver `MAJOR.MINOR.PATCH`:**

- `^1.4.2` allows `>=1.4.2 <2.0.0`.
- `~1.4.2` allows `>=1.4.2 <1.5.0`.
- **`^0.x` is stricter:** `^0.4.2` allows `<0.5.0`, because 0.x minors are treated as breaking.

**Lockfiles** (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`):

- They pin the **exact resolved tree**, giving reproducible installs.
- **Commit them.**
- In CI, use **`npm ci`**: a clean install exactly from the lockfile, failing if it's out of sync.

**npm vs pnpm vs Yarn:**

- **pnpm** uses a content-addressable store plus symlinks: fast, disk-efficient, and **strict** (no access to undeclared dependencies, which avoids "phantom dependencies").
- **Yarn Berry** has Plug'n'Play.
- **npm** has workspaces for monorepos.

## Buffers, streams & events

### Buffers and encodings: what goes wrong with multi-byte characters? 🔥

**Buffer basics:**

- **`Buffer`** is Node's byte array, a subclass of **`Uint8Array`**. Its memory lives **outside the V8 heap**.
- `Buffer.alloc(n)` is zero-filled and safe.
- **`Buffer.allocUnsafe(n)`** is uninitialised: faster, but **may contain old memory** (secrets!). Only use it if you overwrite every byte.
- Small allocations come from an internal **8 KB pool**. **`buf.slice()`/`subarray()` share memory** with the original, so mutations show through. Use `Buffer.from(buf)` to copy.
- `str.length` counts UTF-16 code units. **`Buffer.byteLength(str, 'utf8')`** gives the bytes, which matters for `Content-Length` and size limits.

**The chunk-boundary bug:**

- Network and file data arrive in **chunks**, and a **UTF-8 character can be split across two chunks**.
- Hindi (Devanagari) characters are 3 bytes; emoji are 4.
- Decoding each chunk separately produces **`�` (U+FFFD)** garbage.
- **Fixes:**
  - `stream.setEncoding('utf8')`.
  - `string_decoder`.
  - `TextDecoder` with `{ stream: true }`.
  - Collect the Buffers and decode once at the end.

```js
const text = 'नमस्ते 👋 Zaki';
const bytes = new TextEncoder().encode(text);
// Simulate network chunks that split multi-byte characters
const chunks = [bytes.slice(0, 4), bytes.slice(4, 20), bytes.slice(20)];

const naive = chunks.map((c) => new TextDecoder().decode(c)).join('');
const decoder = new TextDecoder();
const streamed = chunks.map((c) => decoder.decode(c, { stream: true })).join('') + decoder.decode();

console.log({ chars: text.length, bytes: bytes.length, naive, streamed });

test('decoding chunks independently corrupts split characters', () => {
  expect(naive).toContain('�');
  expect(naive).not.toBe(text);
});
test('a streaming decoder carries partial bytes over to the next chunk', () => {
  expect(streamed).toBe(text);
});
test('string length is not byte length', () => {
  expect(bytes.length).toBeGreaterThan(text.length);   // use Buffer.byteLength for Content-Length
});
```

**Base64 and hex:**

- `buf.toString('base64')` / `Buffer.from(s, 'base64')`.
- **`base64url`** for URLs and JWTs.
- Base64 inflates data by about 33%. Don't base64 big files into JSON; use multipart uploads or presigned S3 URLs.

### Explain streams in depth: modes, `highWaterMark`, Transform, `pipeline` and async iteration 🔥

**Readable streams have two modes:**

- **Paused (pull):** you call `read()`. Async iteration uses this.
- **Flowing (push):** a `'data'` listener or `pipe()` switches to flowing mode.

**`highWaterMark`:**

- The internal buffer threshold: **64 KiB** by default for byte streams since Node 22 (it was 16 KiB before), and **16 objects** in `objectMode`.
- It's a **backpressure signal**, not a hard limit. When a writable's buffer exceeds it, `write()` returns `false`.

**`pipeline` vs `pipe`:**

- `a.pipe(b)` **doesn't forward errors or destroy the other streams** on failure. You leak file descriptors and sockets.
- **`stream/promises.pipeline`** handles backpressure, **propagates errors, and destroys every stream**.

```node
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const fs = require('node:fs');
const zlib = require('node:zlib');

// Transform: CSV lines → JSON lines, in object mode, handling lines split across chunks
function csvToJsonLines() {
  let leftover = '';
  let headers = null;
  return new Transform({
    readableObjectMode: false,
    transform(chunk, _enc, callback) {
      const lines = (leftover + chunk.toString('utf8')).split('\n');
      leftover = lines.pop();                                    // the last partial line waits for the next chunk
      for (const line of lines) {
        if (!line.trim()) continue;
        const cells = line.split(',');
        if (!headers) { headers = cells; continue; }
        this.push(JSON.stringify(Object.fromEntries(headers.map((h, i) => [h, cells[i]]))) + '\n');
      }
      callback();
    },
    flush(callback) {                                            // emit the final line at end of input
      if (leftover.trim() && headers) {
        const cells = leftover.split(',');
        this.push(JSON.stringify(Object.fromEntries(headers.map((h, i) => [h, cells[i]]))) + '\n');
      }
      callback();
    },
  });
}

await pipeline(
  fs.createReadStream('participants.csv'),
  csvToJsonLines(),
  zlib.createGzip(),
  fs.createWriteStream('participants.jsonl.gz'),
);   // constant memory, even for a 10 GB file; any error rejects and destroys every stream
```

**Modern style: async iterables as streams.**

- Readables are **async iterable**: `for await (const chunk of readable)`.
- `Readable.from(asyncGenerator)` turns a generator into a stream, and `pipeline` accepts **async generator functions** as transform steps.
- Async iteration is **pull-based**: the producer only runs when the consumer asks for more, which is natural backpressure.
- **Breaking out of the loop destroys the source.**

```js
// Pull-based pipeline with async generators: nothing is produced until the consumer asks
let produced = 0;
let sourceClosed = false;

async function* readRows() {                       // imagine rows streaming from a DB cursor
  try {
    for (let i = 1; i <= 1_000_000; i++) { produced++; yield { id: i, minutes: i * 2 }; }
  } finally {
    sourceClosed = true;                           // runs when the consumer stops early (cursor/file closed)
  }
}
async function* filter(source, pred) { for await (const x of source) if (pred(x)) yield x; }
async function* map(source, fn) { for await (const x of source) yield fn(x); }
async function take(source, n) {
  const out = [];
  for await (const x of source) { out.push(x); if (out.length === n) break; }   // break → return() up the chain
  return out;
}

test('only as much is produced as the consumer pulls', async () => {
  const result = await take(map(filter(readRows(), (r) => r.minutes % 6 === 0), (r) => r.id), 3);
  expect(result).toEqual([3, 6, 9]);
  expect(produced).toBe(9);                        // not 1,000,000: backpressure by construction
  expect(sourceClosed).toBe(true);                 // early exit cleaned up the source
});
```

**Web Streams** (`ReadableStream`, `TransformStream`) are also built into Node, and `fetch()` bodies use them. Convert with `Readable.fromWeb()` / `Readable.toWeb()`.

### What are the exact semantics of EventEmitter? 🔥

**Key rules:**

- **`emit()` is synchronous.** Listeners run **in registration order** on the same call stack. The event isn't async.
- **The `'error'` event is special.** Emitting `'error'` with **no listener throws**, and the process crashes if nothing catches it. Always attach `'error'` handlers to streams, sockets and child processes.
- **Listeners are snapshotted at emit time:**
  - A listener **added during an emit** doesn't run in that emit.
  - A listener **removed during an emit** still runs in that emit.
- **`MaxListenersExceededWarning`:** more than 10 listeners for one event usually means **a leak** (adding a listener per request). Raise the limit with `setMaxListeners` only if that's intentional.
- **Async helpers:**
  - `events.once(emitter, 'ready')` returns a promise.
  - `events.on(emitter, 'data')` returns an async iterator.
  - Both accept an `AbortSignal`.

```js
// Minimal emitter with Node's semantics: sync emit, 'error' throws, snapshot of listeners, once()
class Emitter {
  #map = new Map();
  on(evt, fn) { (this.#map.get(evt) ?? this.#map.set(evt, []).get(evt)).push(fn); return this; }
  off(evt, fn) {
    const list = this.#map.get(evt) ?? [];
    const i = list.findIndex((l) => l === fn || l.listener === fn);
    if (i >= 0) list.splice(i, 1);
    return this;
  }
  once(evt, fn) {
    const wrapper = (...args) => { this.off(evt, wrapper); fn.apply(this, args); };
    wrapper.listener = fn;
    return this.on(evt, wrapper);
  }
  emit(evt, ...args) {
    const list = this.#map.get(evt);
    if (evt === 'error' && !list?.length) throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error: ${args[0]}`);
    if (!list?.length) return false;
    for (const fn of [...list]) fn.apply(this, args);       // snapshot
    return true;
  }
}

test('emit is synchronous', () => {
  const log = [];
  const e = new Emitter().on('joined', (n) => log.push(`listener ${n}`));
  log.push('before'); e.emit('joined', 'asha'); log.push('after');
  expect(log).toEqual(['before', 'listener asha', 'after']);
});
test("an 'error' with no listener throws", () => {
  expect(() => new Emitter().emit('error', new Error('socket hang up'))).toThrow('socket hang up');
});
test('once runs once; listeners added during emit wait for the next emit', () => {
  const e = new Emitter();
  const calls = [];
  e.once('tick', () => calls.push('once'));
  e.on('tick', () => { calls.push('a'); e.on('tick', () => calls.push('late')); });
  e.emit('tick'); e.emit('tick');
  expect(calls).toEqual(['once', 'a', 'a', 'late']);
});
```

## Concurrency: threads and processes

### How do worker threads work, and when should you use them? 🔥

**`worker_threads`** run JavaScript on **separate threads**. Each has its own V8 isolate, event loop and heap, all in the same process.

**Use them for CPU-bound work:**

- Image or PDF processing.
- Parsing huge JSON or CSV.
- Hashing and compression at scale.
- ML inference in JS/WASM.
- Report generation.

**Don't use them for I/O.** The event loop already handles I/O concurrently.

**Communication:**

- **`postMessage`** uses the structured clone algorithm, which copies data.
- **Transfer lists** move an `ArrayBuffer` **without copying**. The sender loses access to it.
- **`SharedArrayBuffer`** plus **`Atomics`** give true shared memory with atomic operations and `Atomics.wait`/`notify`.
- **`MessageChannel`** creates direct channels between workers.

```node
// main.js: a small pool via Piscina (the de-facto worker pool library)
const Piscina = require('piscina');
const pool = new Piscina({ filename: require.resolve('./thumbnail-worker.js'), maxThreads: 4 });

app.post('/thumbnails', async (req, res) => {
  const png = await pool.run({ pdfPath: req.body.path, page: 1 });   // CPU work off the event loop
  res.type('png').send(Buffer.from(png));
});

// thumbnail-worker.js
module.exports = async ({ pdfPath, page }) => renderPageToPng(pdfPath, page);   // runs on a worker thread
```

**Costs and limits:**

- Starting a worker takes **milliseconds and several MB**, so **pool** them rather than starting one per request.
- **Data copying costs**: transfer or share big binary data.
- You can set `resourceLimits` per worker (heap size).

**Worker threads vs cluster vs child processes:**

- **Threads** suit CPU tasks inside one service.
- **Cluster**, or better, **multiple containers**, uses multiple cores for request handling.
- **Child processes** run *other programs* (ffmpeg, Python).

### `spawn` vs `exec` vs `execFile` vs `fork`: which and why? 🔥

| API | Shell? | Output | Use for |
|---|---|---|---|
| **`spawn(cmd, args)`** | No (unless `shell: true`) | **Streams** (stdout/stderr) | Long-running processes or big output: **ffmpeg** recording or transcoding, tailing logs |
| `exec(cmdString)` | **Yes** | **Buffered** (`maxBuffer`, 1 MB default) | Quick shell one-liners with small output. **Dangerous with user input** |
| **`execFile(file, args)`** | No | Buffered | Run a binary with arguments **safely** (no shell interpretation) |
| `fork(modulePath)` | No | Streams + an **IPC channel** (`process.send`) | Child **Node** processes that talk to the parent |

```node
const { spawn, execFile } = require('node:child_process');

// ✗ Command injection: filename = "a.mp4; rm -rf /"
exec(`ffprobe ${req.query.file}`);

// ✓ No shell: arguments are passed as an array, never interpreted
execFile('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', safePath], (err, stdout) => { … });

// ✓ Streaming a long-running encoder; handle exit codes and errors
const ff = spawn('ffmpeg', ['-i', input, '-c:v', 'libx264', '-preset', 'veryfast', output]);
ff.stderr.on('data', (d) => parseProgress(d));
ff.on('error', (err) => logger.error({ err }, 'failed to start ffmpeg'));   // ENOENT etc.
ff.on('close', (code, signal) => (code === 0 ? done() : fail(code, signal)));
```

**Production details:**

- **Always handle `'error'`** (the binary is missing) **and** a **non-zero exit code**.
- **Kill process trees:** start the child with `detached: true` and kill the group with `process.kill(-child.pid)`. Otherwise grandchildren survive.
- **Set timeouts** (the `timeout` option or an `AbortSignal`), so stuck children don't pile up.
- **Zombie processes** in containers need an init process (`tini`, `docker run --init`).

### Cluster, PM2 or containers: how do you use all CPU cores?

- **`cluster`:** a primary process forks N workers that **share the listening port**. On Linux the primary distributes connections round-robin.
- **PM2:** a process manager with cluster mode, restarts, log management and zero-downtime reloads. Common on VMs.
- **Containers (Kubernetes, ECS):** the modern default is **one Node process per container**, scaling **horizontally** with replicas and a load balancer. The orchestrator handles restarts, health checks and rolling deploys, so in-process clustering is unnecessary.

**Stateful connections:**

- **Socket.IO** long-polling needs **sticky sessions**, so a client keeps hitting the same worker (or use WebSocket-only transport).
- Use a **Redis adapter** to broadcast across instances.

## Async context, errors & diagnostics

### What is AsyncLocalStorage, and how do you use it for request context? 🔥

**`AsyncLocalStorage`** stores a value that **follows the async call chain**, across `await`, callbacks, timers and promises. It's the Node equivalent of thread-local storage.

**Use cases:**

- **Request IDs and trace IDs in every log line** without passing `req` everywhere.
- Tenant or user context.
- Per-request database transactions.

```node
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const als = new AsyncLocalStorage();

app.use((req, res, next) => {
  const ctx = { requestId: req.get('x-request-id') ?? randomUUID(), tenantId: req.user?.tenantId };
  als.run(ctx, next);                                        // everything downstream sees ctx
});

const log = (msg, extra = {}) => logger.info({ ...als.getStore(), ...extra }, msg);

async function generateReport(meetingId) {
  log('report started', { meetingId });                      // automatically tagged with requestId + tenantId
  await db.query('…');
  log('report finished');
}
```

**Notes:**

- Libraries like **pino** (mixins), **OpenTelemetry** context propagation, and NestJS's CLS modules are built on this.
- Performance is good. **Node 24 switched to `AsyncContextFrame`** by default, which makes it cheaper still.
- Context can be **lost** with some callback-queue libraries that pool callbacks. Wrap those with `AsyncResource.bind`.

### How do errors work in Node? `unhandledRejection`, `uncaughtException` and operational vs programmer errors 🔥

**Two kinds of errors:**

- **Operational errors** are expected runtime conditions: ECONNREFUSED, timeouts, validation failures, 404s. **Handle them**: retry, return a 4xx/5xx, degrade.
- **Programmer errors** are bugs: TypeError, reading a property of undefined. **Don't try to continue.** Log, crash and restart.

**Process-level handlers:**

| Event | Behaviour | Recommended |
|---|---|---|
| **`unhandledRejection`** | **Since Node 15, an unhandled rejection crashes the process** (`--unhandled-rejections=throw` is the default) | Log with context and **exit**. Fix the missing `catch`/`await` |
| **`uncaughtException`** | Thrown synchronously and nothing caught it | **Log, flush, then exit(1).** State may be corrupt; the orchestrator restarts you |

```node
process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'unhandled rejection');
  shutdown(1);
});
process.on('uncaughtException', (err, origin) => {
  logger.fatal({ err, origin }, 'uncaught exception');
  shutdown(1);                        // graceful: stop accepting traffic, close the server/DB, exit within N seconds
});
```

**Modern error features:**

- **`new Error('Failed to start recording', { cause: err })`** chains errors without losing the original stack.
- **`AggregateError`** comes from `Promise.any` and is useful for batch failures.
- `util.promisify` converts error-first callbacks (`(err, result) => …`) to promises.

**Async pitfalls:**

- `try/catch` doesn't catch errors thrown inside a **callback** that runs later (`setTimeout(() => { throw … })`).
- A **floating promise** (an async call without `await` or `.catch`) becomes an unhandled rejection. Lint with `@typescript-eslint/no-floating-promises`.
- Express 4 doesn't catch rejected promises from async handlers. **Express 5 does.**

### How do you diagnose CPU and latency problems in a Node service? 🔥

| Tool | What you learn |
|---|---|
| **Event loop delay:** `perf_hooks.monitorEventLoopDelay()` | p99 loop lag. A high value means something blocks the loop. Export it as a metric |
| **Event loop utilisation:** `performance.eventLoopUtilization()` | The fraction of time the loop is busy. Near 1 means CPU saturated, so scale or optimise |
| **CPU profiles:** `node --cpu-prof`, or `--inspect` + Chrome DevTools | **Flame graphs** of where CPU time goes |
| **clinic.js** (`doctor`, `flame`, `bubbleprof`, `heapprofiler`) | Automated diagnosis: is it the event loop, GC, I/O or memory? |
| **0x** | Flame graphs from the command line |
| **`--prof`** + `--prof-process` | The V8 tick profiler |
| **Diagnostic report:** `process.report.writeReport()` / `--report-on-fatalerror` | A JSON snapshot of the stack, heap, libuv handles, resource usage and environment, ideal for crashes in production |
| **`--trace-gc`**, `PerformanceObserver` for GC entries | GC pressure |
| **Tracing:** OpenTelemetry auto-instrumentation | Which downstream call (DB, HTTP) causes the latency |

```node
const { monitorEventLoopDelay } = require('node:perf_hooks');
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  metrics.gauge('eventloop.p99_ms', h.percentile(99) / 1e6);    // nanoseconds → ms
  h.reset();
}, 10_000).unref();
```

**Classic findings:**

- **Synchronous JSON.parse or stringify** of multi-MB payloads.
- **A RegExp with catastrophic backtracking.**
- **Sync fs calls** in request paths.
- **Huge array operations** in handlers.
- **Logging too much synchronously.** Use pino, which is asynchronous.
- **GC thrash** from allocating big temporary objects.

### Why do Node services behind a load balancer return random 502s? (keep-alive timeouts) 🔥

**The classic production bug:**

1. AWS ALB keeps idle **keep-alive connections** to targets for **60 s** by default.
2. Node's `server.keepAliveTimeout` is **5 s** by default.
3. Node closes an idle connection at 5 s. At the same moment, the ALB sends a new request on that connection.
4. The request lands on a socket being closed, and the ALB returns **502 Bad Gateway**.
5. It looks random and happens under low or moderate traffic.

**Fix:** the server's idle timeout must be **longer than the load balancer's**:

```node
const server = app.listen(3000);
server.keepAliveTimeout = 65_000;   // > ALB idle timeout (60 s)
server.headersTimeout = 66_000;     // must be > keepAliveTimeout (older Node versions enforce this ordering)
server.requestTimeout = 120_000;    // whole-request limit (default 300 s since Node 18)
```

**Outgoing HTTP from Node:**

- **Reuse connections.** `http.globalAgent` has had **keep-alive on by default since Node 19**.
- `fetch` (undici) pools connections automatically.
- Set **`maxSockets`** and timeouts deliberately.
- Creating a new TLS connection per request costs about 1–3 round trips.

**Undici `fetch` gotchas:**

- **Always consume or cancel the response body** (`await res.text()` or `res.body.cancel()`). Otherwise the connection isn't returned to the pool.
- Set timeouts with `AbortSignal.timeout(ms)`.

## Security & the modern runtime

### What is prototype pollution, and how do you prevent it? 🔥

**Prototype pollution:** an attacker injects `__proto__` (or `constructor.prototype`) keys through JSON. A **naive deep merge** or a path setter then writes onto **`Object.prototype`**, so **every object** suddenly has attacker-controlled properties.

**Consequences:**

- Privilege escalation (`user.isAdmin` is now true everywhere).
- Denial of service.
- Even RCE through template engines or `child_process` options.

```js
// Vulnerable deep merge (a pattern found in many old libraries)
function unsafeMerge(target, source) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object') {
      if (!target[key]) target[key] = {};
      unsafeMerge(target[key], source[key]);          // key "__proto__" walks into Object.prototype!
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
function safeMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (FORBIDDEN.has(key)) continue;                  // 1. block dangerous keys
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!Object.hasOwn(target, key)) target[key] = Object.create(null);   // 2. prototype-less objects
      safeMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

const payload = JSON.parse('{"theme": "dark", "__proto__": {"isAdmin": true}}');   // JSON.parse creates an own "__proto__" key

test('unsafe merge pollutes every object in the process', () => {
  try {
    unsafeMerge({}, payload);
    expect({}.isAdmin).toBe(true);                    // a brand-new, unrelated object is now "admin"
  } finally {
    delete Object.prototype.isAdmin;                  // clean up the global damage
  }
});
test('safe merge ignores __proto__ and keeps Object.prototype clean', () => {
  const settings = safeMerge({}, payload);
  expect(settings.theme).toBe('dark');
  expect({}.isAdmin).toBeUndefined();
});
```

**Prevention:**

- **Validate input with schemas** (Zod, Ajv with `additionalProperties: false`).
- Block `__proto__`, `constructor` and `prototype` keys.
- Use **`Map`** or **`Object.create(null)`** for user-keyed dictionaries.
- **`Object.freeze(Object.prototype)`** at startup, in hardened services.
- `node --disable-proto=delete` removes the `__proto__` accessor.
- Keep dependencies updated (lodash `merge`/`set` had CVEs of exactly this kind).

**Other Node-specific attack surfaces:**

| Risk | Example | Defence |
|---|---|---|
| **ReDoS** | `/^(a+)+$/` against `'aaaaaaaaaaaaaaaaaaaaaaaa!'` backtracks exponentially and **blocks the event loop** | Avoid nested quantifiers, limit input length, use `re2`, lint with `eslint-plugin-regexp` / safe-regex |
| **Path traversal** | `GET /files?name=../../etc/passwd` | `const p = path.resolve(BASE, name); if (!p.startsWith(BASE + path.sep)) reject` |
| **Command injection** | `exec(\`convert ${userFile}\`)` | `execFile`/`spawn` with an args array; no shell |
| **SSRF** | `fetch(req.body.webhookUrl)` reaching `169.254.169.254` (cloud metadata) | Allowlist hosts, block private IP ranges after DNS resolution, use IMDSv2 |
| **Supply chain** | A malicious `postinstall`, typosquatting, compromised maintainers | Lockfiles, `npm ci --ignore-scripts`, `npm audit`, Dependabot/Renovate, provenance (`npm audit signatures`), minimal dependencies |
| **Secrets in env or logs** | Logging `process.env` or full request bodies | Redaction (pino `redact`), a secret manager |

### What changed in Node.js 20–24 that you should know? 🔥

| Feature | Since | Why it matters |
|---|---|---|
| **Built-in test runner** `node:test` + `node --test` | Stable in 20 | Zero-dependency tests: mocking, coverage (`--experimental-test-coverage`), watch mode |
| **`--watch`** | 18.11 (stable in 22) | Restart on file changes, with no nodemon |
| **`--env-file=.env`** | 20.6 | Load env files natively, with no dotenv |
| **`fetch`, `Request`, `Response`, `FormData`** (undici) | Global since 18; stable in 21 | The same API as browsers |
| **`WebSocket` client** | Global in 22 | Native WS client |
| **`require(esm)`** | 22.12 / 20.19 | CJS can `require` ES modules (without top-level await) |
| **TypeScript type stripping** | Flag in 22.6; **on by default in 23.6+ and 22.18+** | `node app.ts` runs **erasable** TS syntax (no `enum`/`namespace` without `--experimental-transform-types`). No type checking: still run `tsc --noEmit` in CI |
| **Permission model** | `--permission` (stable in 22.13+/23.5+) | Restrict fs, child processes and workers for untrusted scripts |
| **`node:sqlite`** | 22.5 (experimental) | Built-in SQLite |
| **`fs.glob`**, `import.meta.dirname` | 22 / 20.11 | Quality-of-life additions |
| **`AsyncContextFrame`** | Default in 24 | Faster AsyncLocalStorage |
| **`URLPattern`** global | 24 | Route matching without libraries |
| **Single executable applications** | 18.16/19.7+ | Ship a CLI as one binary |
| **V8 upgrades** | Every major | Maglev tier, faster JSON, `Array.fromAsync`, `Promise.withResolvers`, `Set` methods, `Iterator` helpers, `RegExp.escape` |

**Release cadence:**

- **Even-numbered majors become LTS** (in October), with about 30 months of support.
- **Odd-numbered majors are short-lived "Current" releases.**
- Use the **Active LTS** line in production, and check nodejs.org for which line that is today.

### Node vs Deno vs Bun: what are the differences?

| | **Node.js** | **Deno** | **Bun** |
|---|---|---|---|
| Engine | V8 (C++, libuv) | V8 (Rust, Tokio) | **JavaScriptCore** (Zig) |
| TypeScript | Type stripping (recent versions) | Native | Native |
| Security | Opt-in permission model | **Secure by default** (explicit `--allow-net`, `--allow-read`) | Like Node |
| Package management | npm/pnpm/Yarn | npm compatibility (Deno 2), JSR registry | **Very fast built-in installer**, Node-compatible |
| Tooling | Separate tools (test runner now built in) | Built in: fmt, lint, test, bundle, compile | Built in: test runner, bundler |
| Ecosystem maturity | **The most mature**; the production default | Growing; strong Web-standard APIs | Very fast startup; compatibility still has edge cases |

**Interview answer:** "Node is the production default thanks to its ecosystem and stability. Bun is attractive for tooling speed (installs, tests). Deno for security-sensitive scripting and web-standard APIs. Much of what made them different (TS, fetch, test runner, watch) is now built into Node."

### What are native addons, and when would you need one?

**Native addons** are C/C++ (or Rust) modules loaded with `require('./addon.node')`. Use cases:

- Bindings to native libraries (image codecs, `bcrypt`, `sharp`/libvips, database drivers).
- CPU-heavy hot paths.

**Tooling:**

- **Node-API (N-API)** is the **ABI-stable** C API: addons don't need recompiling for each Node version.
- `node-addon-api` is its C++ wrapper.
- `napi-rs` is for Rust.
- **`node-gyp`** builds them, which needs Python and a compiler toolchain. Libraries ship **prebuilt binaries** per platform (`prebuildify`, optional platform packages like `@esbuild/linux-x64`) to avoid compiling on install.

**Alternatives:**

- **WebAssembly:** portable, sandboxed, no build step for users.
- **A separate service** in another language.
- A **child process**.

**Electron note:** native modules must be rebuilt against **Electron's** Node ABI (`electron-rebuild`, or `@electron/rebuild`). This is a common packaging issue in desktop apps.
