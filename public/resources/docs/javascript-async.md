# Async JavaScript & the Event Loop

Real-time apps such as MeetHour are asynchronous through and through: signalling messages, media events, timers, network calls, workers. Interviewers test whether you can **predict execution order**, **handle errors and cancellation**, and **control concurrency**.

> Run every snippet. For ordering questions, write down your prediction first, then press ▶ Run.

## The event loop

### Explain the JavaScript event loop 🔥

JavaScript runs your code on **one thread** with **one call stack**. Concurrency comes from the **host environment** (browser or Node), which does work in the background and queues callbacks.

**Components (browser):**

1. **Call stack:** the currently executing frames. Runs to completion; nothing interrupts a running function.
2. **Web APIs / host:** timers, network, DOM events, IndexedDB and similar run outside the JS thread and **enqueue tasks** when done.
3. **Task queue(s)** (*macrotasks*): `setTimeout`/`setInterval` callbacks, I/O, UI events, `MessageChannel` messages, script execution itself. The browser picks **one task** per loop iteration (it may prioritise between task sources).
4. **Microtask queue:** promise reactions (`.then`/`catch`/`finally`, `await` continuations), `queueMicrotask`, `MutationObserver` callbacks. It's drained **completely** after each task, and after each callback when the stack becomes empty.
5. **Rendering steps:** when it's time to paint (roughly every 16.7 ms at 60 Hz, only if needed), the browser runs **`requestAnimationFrame` callbacks**, then style, layout and paint.

**One loop iteration:** run one task → drain **all** microtasks → (maybe) render: rAF callbacks → style → layout → paint → (if idle) `requestIdleCallback`.

```js
console.log('1 sync');
setTimeout(() => console.log('5 timeout (task)'), 0);
Promise.resolve().then(() => console.log('3 microtask'));
queueMicrotask(() => console.log('4 microtask'));
console.log('2 sync');

const order = [];
setTimeout(() => order.push('task'), 0);
Promise.resolve().then(() => order.push('micro'));
order.push('sync');
test('sync -> microtasks -> tasks', async () => {
  await new Promise((r) => setTimeout(r, 5));
  expect(order).toEqual(['sync', 'micro', 'task']);
});
```

**Key consequences:**

- A long synchronous function **blocks everything**: no clicks, no rendering, no timers.
- Microtasks run **before** the next task and before rendering. An infinite microtask chain **starves** the page; it freezes even though each step is "async".
- `setTimeout(fn, 0)` means "**at least** 0 ms, after the current task and all microtasks".

### What's the difference between microtasks and macrotasks? Which APIs create each? 🔥

| Microtasks (drained fully after every task) | Macrotasks / tasks (one per loop iteration) |
|---|---|
| `Promise.then/catch/finally` callbacks | `setTimeout`, `setInterval` |
| `await` continuations | DOM/UI events (click, input) |
| `queueMicrotask(fn)` | `MessageChannel`/`postMessage` |
| `MutationObserver` callbacks | Network/I/O callbacks (XHR events, WebSocket messages) |
| (Node) `process.nextTick` runs **before** promise microtasks | (Node) `setImmediate`, I/O callbacks |

```js
const log = [];
setTimeout(() => {
  log.push('timeout 1');
  Promise.resolve().then(() => log.push('micro inside timeout 1')); // runs before timeout 2
}, 0);
setTimeout(() => log.push('timeout 2'), 0);

Promise.resolve().then(() => {
  log.push('micro 1');
  setTimeout(() => log.push('timeout from micro'), 0);
  queueMicrotask(() => log.push('micro 2 (queued by micro 1)'));
});

setTimeout(() => console.log(log), 20);

test('microtasks drain between tasks', async () => {
  await new Promise((r) => setTimeout(r, 30));
  expect(log).toEqual(['micro 1', 'micro 2 (queued by micro 1)', 'timeout 1', 'micro inside timeout 1', 'timeout 2', 'timeout from micro']);
});
```

### Why isn't `setTimeout(fn, 0)` really 0 ms? What affects timer accuracy?

- The callback runs only after the **current task and all microtasks** finish, and after any earlier queued tasks.
- The HTML spec **clamps nested timers to ≥ 4 ms** once nesting depth reaches 5 (a `setTimeout` calling `setTimeout` repeatedly).
- **Background tabs** are throttled: typically at most one timer wake-up per second, and Chrome's "intensive throttling" can reduce it to once per minute for long-hidden pages.
- A busy main thread delays every timer. The delay is a **minimum**, not a guarantee.

**Consequences in real apps:**

- Don't drive animations with `setTimeout`. Use `requestAnimationFrame`.
- For audio-level meters or stats loops in a conferencing app that must keep running in background tabs, run the timer in a **Web Worker**. Worker timers aren't throttled the same way; Jitsi uses a "timer worker" for its video effects. Alternatively, drive work from media callbacks.
- To yield to the browser between chunks of work, `setTimeout(0)` works. `scheduler.postTask`/`scheduler.yield()` (Chromium) or `MessageChannel` gives faster yielding without the 4 ms clamp.

### Where do `requestAnimationFrame` and `requestIdleCallback` fit in?

- **`requestAnimationFrame(cb)`** runs **right before the next paint**, once per frame, synchronised to the display's refresh rate. It's **paused in background tabs**. Use it for visual updates and animations, and for batching DOM writes. `cb` receives a high-resolution timestamp.
- **`requestIdleCallback(cb, { timeout })`** runs when the browser is **idle** after a frame. `cb` receives a `deadline` with `timeRemaining()`. Use it for low-priority work (analytics, prefetching, cache warming). It isn't supported in older Safari; React's scheduler doesn't rely on it.
- **Order inside a frame:** task → microtasks → rAF callbacks → style/layout/paint → idle callbacks.

### What happens if you run a CPU-heavy loop in the browser? How do you fix it? 🔥

The main thread is blocked: no input handling, no rendering. The page "freezes", and **INP** (Interaction to Next Paint) gets worse. `async`/`await` **doesn't help**, because async isn't parallel. The CPU work still runs on the same thread.

**Fixes:**

1. **Web Worker:** move the computation off the main thread and communicate with `postMessage`. Transfer large `ArrayBuffer`s instead of copying them.
2. **Chunk the work** and yield between chunks (`setTimeout`, `scheduler.yield()`, `requestIdleCallback`).
3. **Make it cheaper:** a better algorithm, memoisation, WebAssembly for heavy number crunching.
4. In React: **`useTransition`/`useDeferredValue`** keep the UI responsive while expensive *rendering* happens (but not for raw CPU work in event handlers).

```js
// Chunked processing that yields to the event loop between batches
async function processInChunks(items, fn, chunkSize = 1000) {
  const results = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    for (const item of items.slice(i, i + chunkSize)) results.push(fn(item));
    await new Promise((r) => setTimeout(r, 0)); // let rendering & input happen
  }
  return results;
}

const data = Array.from({ length: 5000 }, (_, i) => i);
let tickedMeanwhile = 0;
const interval = setInterval(() => tickedMeanwhile++, 0);
const squares = await processInChunks(data, (n) => n * n);
clearInterval(interval);
console.log(squares.length, 'other tasks got to run', tickedMeanwhile, 'times');
```

## Promises in depth

### What is a Promise? Explain its states and guarantees 🔥

A **Promise** is an object representing the **eventual result** of an asynchronous operation.

- **States:** `pending` → either `fulfilled` (with a value) or `rejected` (with a reason). Once settled, it's **immutable**: later `resolve`/`reject` calls are ignored.
- **Callbacks are always async:** `.then` callbacks run as **microtasks**, even if the promise is already settled. This avoids the "sometimes sync, sometimes async" bugs common with callbacks.
- **`.then` returns a new promise**, which enables chaining:
  - returning a value fulfils the next promise with it
  - returning a promise or **thenable** makes the next promise **adopt** its state
  - throwing rejects the next promise
- **The executor runs synchronously**, immediately inside `new Promise(executor)`.

```js
console.log('A');
const p = new Promise((resolve, reject) => {
  console.log('B — executor runs synchronously');
  resolve('first');
  resolve('second');        // ignored: already settled
  reject(new Error('x'));   // ignored
});
p.then((v) => console.log('D', v));
console.log('C');

const chained = Promise.resolve(1)
  .then((x) => x + 1)                         // value -> next promise fulfils with 2
  .then((x) => new Promise((r) => setTimeout(() => r(x * 10), 10))) // adopts the inner promise
  .then((x) => { throw new Error(`boom at ${x}`); })
  .catch((e) => e.message)                    // recovers: the chain continues fulfilled
  .then((msg) => `recovered: ${msg}`);

test('promise chaining', async () => {
  await expect(chained).resolves.toBe('recovered: boom at 20');
});
```

### How does error handling work in promise chains? `catch` vs the second argument of `then`?

- A rejection **skips** subsequent `.then` fulfilment handlers until it reaches a `.catch` (or a `then(_, onRejected)`).
- `.catch(fn)` is `.then(undefined, fn)`.
- `p.then(onOk, onErr)` **doesn't** catch errors thrown inside `onOk` itself. `p.then(onOk).catch(onErr)` does.
- **`finally(fn)`** runs on both outcomes. It receives **no argument**, and **passes the original value or reason through**, unless `fn` throws or returns a rejected promise.
- After a `catch` handles the error, the chain is **fulfilled** again. Re-throw if you want callers to see the failure.

```js
const results = [];
await Promise.reject(new Error('fail'))
  .then(() => results.push('skipped'))
  .catch((e) => results.push(`caught ${e.message}`))
  .then(() => results.push('continues after catch'));

await Promise.resolve('ok')
  .then((v) => { throw new Error(`thrown in onOk (${v})`); }, () => results.push('NOT called: same then'))
  .catch((e) => results.push(`outer catch: ${e.message}`));

const value = await Promise.resolve(42).finally(() => 'ignored return value');
results.push(`finally passes through ${value}`);

console.log(results);
test('error flow', () => {
  expect(results).toEqual([
    'caught fail',
    'continues after catch',
    'outer catch: thrown in onOk (ok)',
    'finally passes through 42',
  ]);
});
```

### Compare `Promise.all`, `allSettled`, `race` and `any` 🔥

| Combinator | Fulfils when | Rejects when | Use case |
|---|---|---|---|
| `Promise.all` | **all** fulfil (array of values, in input order) | **first** rejection (fail-fast; the others keep running) | Parallel requests that are all required |
| `Promise.allSettled` | all settle (never rejects) → `[{status, value/reason}]` | never | Batch operations where you report each result |
| `Promise.race` | the **first to settle**, whether fulfilled or rejected | the first to settle rejects | Timeouts, "fastest wins" |
| `Promise.any` | the **first to fulfil** | **all** reject → `AggregateError` | Redundant mirrors/CDNs, fallback sources |

```js
const delay = (ms, v, fail = false) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error(v)) : res(v)), ms));

console.log(await Promise.all([delay(30, 'a'), delay(10, 'b'), 'plain value']));
console.log(await Promise.allSettled([delay(10, 'ok'), delay(5, 'bad', true)]));
console.log(await Promise.race([delay(20, 'slow'), delay(5, 'fast')]));
console.log(await Promise.any([delay(5, 'x', true), delay(15, 'second succeeds')]));

try {
  await Promise.any([delay(5, 'e1', true), delay(5, 'e2', true)]);
} catch (e) {
  console.log(e.constructor.name, e.errors.map((x) => x.message));
}

test('all fails fast on the first rejection', async () => {
  await expect(Promise.all([delay(50, 'slow'), delay(5, 'nope', true)])).rejects.toThrow('nope');
  expect(await Promise.all([])).toEqual([]);           // empty input fulfils immediately
});
```

**Gotcha:** `Promise.all` **doesn't cancel** the other operations when one fails. They keep running. Combine it with `AbortController` if they should stop.

### What is the "explicit promise construction" anti-pattern?

Wrapping something that is **already a promise** in `new Promise`:

```js
// ❌ Anti-pattern: loses errors thrown synchronously in .then, adds noise
function getUserBad(id) {
  return new Promise((resolve, reject) => {
    fetchUser(id).then((u) => resolve(u.name)).catch(reject);
  });
}
// ✅ Just return the chain
const getUser = (id) => fetchUser(id).then((u) => u.name);

function fetchUser(id) { return Promise.resolve({ id, name: `user${id}` }); }
console.log(await getUserBad(1), await getUser(2));
```

Use `new Promise` only to **wrap callback-based or event-based APIs** (promisification).

### How do you convert a callback API into promises (promisify)? 🔥

Node-style callbacks have the signature `(err, result) => …`.

```js
function promisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, result) => (err ? reject(err) : resolve(result)));
    });
  };
}

// a callback-style API
function readConfig(name, cb) {
  setTimeout(() => (name ? cb(null, { name, debug: true }) : cb(new Error('name required'))), 5);
}

const readConfigAsync = promisify(readConfig);
console.log(await readConfigAsync('app'));

// Event-based API -> promise (resolve on the first event)
function once(emitter, event) {
  return new Promise((resolve) => emitter.addEventListener(event, resolve, { once: true }));
}
const target = new EventTarget();
setTimeout(() => target.dispatchEvent(new Event('ready')), 5);
const ev = await once(target, 'ready');
console.log('event fired:', ev.type);

test('promisify', async () => {
  await expect(readConfigAsync('')).rejects.toThrow('name required');
});
```

(Node ships `util.promisify` and `events.once`.)

### What is an unhandled promise rejection and how do you deal with it?

A promise is rejected and **no rejection handler** is attached by the time the microtask queue drains.

- **Browsers** fire a `unhandledrejection` event on `window` (log it to your error tracker) and print "Uncaught (in promise)".
- **Node ≥ 15** **crashes the process** by default (`--unhandled-rejections=throw`).

Common causes:

- fire-and-forget async calls (`saveDraft();` without `await` or `.catch`)
- async functions passed to `forEach` or used as event handlers
- `Promise.all` where you only handle some branches

```js
window.addEventListener?.('unhandledrejection', (e) => {
  console.warn('report to Sentry:', e.reason?.message);
});

async function saveDraft() { throw new Error('network down'); }
saveDraft().catch((e) => console.log('handled:', e.message)); // always handle fire-and-forget calls
```

## async / await

### How does async/await work under the hood? 🔥

- An `async function` **always returns a promise**. A returned value fulfils it; a thrown error rejects it.
- `await x`:
  1. converts `x` to a promise (`Promise.resolve(x)`)
  2. **suspends** the function and **returns control to the caller**
  3. schedules the rest of the function as a **microtask** once the promise settles
  4. resumes with the value, or **throws** the rejection reason at the `await` (so `try/catch` works)
- Conceptually it's a **generator plus an auto-runner**: each `await` is a `yield` of a promise, and the runner calls `next(value)` or `throw(err)` when it settles.
- Code **before the first `await` runs synchronously**.

```js
const order = [];
async function work() {
  order.push('2: inside async fn, before await (sync)');
  await null;                                  // even awaiting a non-promise yields
  order.push('4: after await (microtask)');
  return 'done';
}
order.push('1: before call');
const pr = work();
order.push('3: after call — function is suspended');
console.log(pr instanceof Promise);
await pr;
console.log(order);

// Generator-based async runner — the idea behind async/await
function run(genFn) {
  return new Promise((resolve, reject) => {
    const gen = genFn();
    const step = (method, arg) => {
      let r;
      try { r = gen[method](arg); } catch (e) { return reject(e); }
      if (r.done) return resolve(r.value);
      Promise.resolve(r.value).then((v) => step('next', v), (e) => step('throw', e));
    };
    step('next');
  });
}
const viaGenerator = await run(function* () {
  const a = yield Promise.resolve(20);
  const b = yield new Promise((r) => setTimeout(() => r(22), 5));
  return a + b;
});
console.log('generator runner result:', viaGenerator);

test('execution order', () => {
  expect(order.map((s) => s[0])).toEqual(['1', '2', '3', '4']);
  expect(viaGenerator).toBe(42);
});
```

### Sequential vs parallel `await`: what's the difference? 🔥

```js
const fetchFake = (name, ms) => new Promise((r) => setTimeout(() => r(name), ms));

let t = performance.now();
const a = await fetchFake('user', 100);          // waits 100ms
const b = await fetchFake('orders', 100);        // THEN waits another 100ms
console.log('sequential:', Math.round(performance.now() - t), 'ms', a, b);

t = performance.now();
const [c, d] = await Promise.all([fetchFake('user', 100), fetchFake('orders', 100)]); // both start now
console.log('parallel:', Math.round(performance.now() - t), 'ms', c, d);

t = performance.now();
const userP = fetchFake('user', 100);            // start both...
const ordersP = fetchFake('orders', 100);
const [e, f] = [await userP, await ordersP];     // ...then await (beware: an early rejection of ordersP is unhandled until awaited)
console.log('start-then-await:', Math.round(performance.now() - t), 'ms', e, f);
```

**Rule:** if the operations are **independent**, start them together with `Promise.all`. Use sequential `await` only when one depends on the other's result.

### Why doesn't `await` work inside `forEach`? 🔥

`forEach` **ignores the promises** returned by an async callback. It doesn't wait, and errors become unhandled rejections. The code after the `forEach` runs before any of the work completes.

```js
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = [3, 1, 2];

const viaForEach = [];
ids.forEach(async (id) => { await sleep(id * 10); viaForEach.push(id); });
console.log('after forEach:', [...viaForEach]);         // [] — nothing awaited

const sequential = [];
for (const id of ids) { await sleep(id * 10); sequential.push(id); } // in order, one at a time

const parallel = await Promise.all(ids.map(async (id) => { await sleep(id * 10); return id; })); // concurrent, results in input order

await sleep(40);
console.log({ viaForEach, sequential, parallel });

test('for..of is sequential; Promise.all keeps input order', () => {
  expect(sequential).toEqual([3, 1, 2]);
  expect(parallel).toEqual([3, 1, 2]);
  expect(viaForEach).toEqual([1, 2, 3]);                // completion order
});
```

Use `for…of` (sequential), `Promise.all(arr.map(...))` (parallel), or a **concurrency limiter** (bounded parallelism, see below). `for await…of` is for **async iterables**.

### Is there a difference between `return promise` and `return await promise`?

Usually not, with one important exception: **inside `try/catch` (or `finally`)**. With `return promise`, the function returns before the promise settles, so a rejection **bypasses your `catch`**. With `return await`, the rejection is thrown inside the `try`, so your `catch` handles it. `return await` also gives better async stack traces.

```js
const failing = () => Promise.reject(new Error('db error'));

async function withoutAwait() {
  try { return failing(); } catch { return 'fallback'; }      // catch never runs
}
async function withAwait() {
  try { return await failing(); } catch { return 'fallback'; } // catch runs
}

console.log(await withAwait());
try { await withoutAwait(); } catch (e) { console.log('escaped the try/catch:', e.message); }
```

### What are async iterators and `for await…of`? Give a real use 🔥

An **async iterable** has `[Symbol.asyncIterator]()`, which returns an object whose `next()` returns a **promise** of `{ value, done }`. **Async generators** (`async function*`) make them easy to write. Real uses:

- **paginated APIs**: yield items page by page, fetching lazily
- **streaming responses**: `response.body` is a `ReadableStream`, async-iterable in modern runtimes; also used to stream LLM tokens
- **event streams**: WebSocket messages, file chunks

```js
// Paginated API as an async generator
async function* paginate(fetchPage) {
  let cursor = null;
  do {
    const { items, next } = await fetchPage(cursor);
    yield* items;
    cursor = next;
  } while (cursor);
}

const pages = { null: { items: [1, 2], next: 'p2' }, p2: { items: [3, 4], next: 'p3' }, p3: { items: [5], next: null } };
let requests = 0;
const fakeApi = async (cursor) => { requests++; await new Promise((r) => setTimeout(r, 5)); return pages[cursor]; };

const firstThree = [];
for await (const item of paginate(fakeApi)) {
  firstThree.push(item);
  if (firstThree.length === 3) break;              // stops early: page 3 is never fetched
}
console.log(firstThree, 'requests made:', requests);

test('lazy pagination', () => {
  expect(firstThree).toEqual([1, 2, 3]);
  expect(requests).toBe(2);
});
```

```node
// Streaming a fetch response (e.g. LLM tokens) in the browser or Node 18+
const res = await fetch('/api/stream');
const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  appendToUI(value);
}
```

## Cancellation, timeouts, retries & concurrency

### How do you cancel async operations? Explain AbortController 🔥

`AbortController` creates an **`AbortSignal`**. Pass the signal to cancellable APIs: `fetch(url, { signal })`, `addEventListener(..., { signal })`, streams, many libraries. Calling `controller.abort(reason)`:

- rejects `fetch` with an `AbortError` `DOMException` (or with your reason)
- fires `signal`'s `abort` event and sets `signal.aborted = true`

Helpers:

- `AbortSignal.timeout(ms)`: a signal that aborts automatically (`TimeoutError`)
- `AbortSignal.any([s1, s2])`: aborts when any of the inputs aborts
- `signal.throwIfAborted()`

**React use:** abort the previous request when the input changes, or in the effect cleanup, to avoid race conditions and "set state on unmounted component" problems.

```js
// Make your own async function cancellable
function sleep(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(signal.reason);
    }, { once: true });
  });
}

const controller = new AbortController();
setTimeout(() => controller.abort(new Error('user navigated away')), 20);
try {
  await sleep(1000, { signal: controller.signal });
} catch (e) {
  console.log('cancelled:', e.message);
}

try {
  await sleep(1000, { signal: AbortSignal.timeout(15) });
} catch (e) {
  console.log('timeout:', e.name);
}

test('abort rejects with the reason', async () => {
  const c = new AbortController();
  const p = sleep(1000, { signal: c.signal });
  c.abort(new Error('stop'));
  await expect(p).rejects.toThrow('stop');
});
```

```jsx
// React: cancel stale requests when the query changes
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
    .then((r) => r.json())
    .then(setResults)
    .catch((e) => { if (e.name !== 'AbortError') setError(e); });
  return () => controller.abort();
}, [query]);
```

### Implement a timeout for any promise 🔥

```js
function withTimeout(promise, ms, message = `Timed out after ${ms}ms`) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); // don't leak the timer
}

const slow = new Promise((r) => setTimeout(() => r('slow result'), 100));
const fast = new Promise((r) => setTimeout(() => r('fast result'), 10));

console.log(await withTimeout(fast, 50));
try { await withTimeout(slow, 30); } catch (e) { console.log(e.message); }

test('withTimeout', async () => {
  await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow('Timed out after 10ms');
  await expect(withTimeout(Promise.resolve(1), 10)).resolves.toBe(1);
});
```

**Note:** a timeout doesn't stop the underlying work. To actually cancel a `fetch`, use `AbortSignal.timeout(ms)`.

### Implement retry with exponential backoff and jitter 🔥

Retrying immediately overloads a struggling server. **Exponential backoff** waits `base * 2^attempt` between attempts. **Jitter** (randomness) prevents many clients retrying at the same moment (the "thundering herd"). Only retry **transient** errors (network failures, 429, 503), never 400 or 401.

```js
async function retry(fn, { retries = 3, baseMs = 100, maxMs = 2000, shouldRetry = () => true, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const exp = Math.min(maxMs, baseMs * 2 ** attempt);
      const delay = Math.random() * exp;            // "full jitter"
      onRetry?.(err, attempt + 1, Math.round(delay));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

let calls = 0;
const flaky = async () => {
  calls++;
  if (calls < 3) throw Object.assign(new Error('503 Service Unavailable'), { status: 503 });
  return 'success on attempt ' + calls;
};

const result = await retry(flaky, {
  baseMs: 10,
  shouldRetry: (e) => [429, 502, 503, 504].includes(e.status),
  onRetry: (e, n, ms) => console.log(`retry #${n} in ${ms}ms after: ${e.message}`),
});
console.log(result);

test('does not retry non-transient errors', async () => {
  let n = 0;
  const bad = async () => { n++; throw Object.assign(new Error('400 Bad Request'), { status: 400 }); };
  await expect(retry(bad, { baseMs: 1, shouldRetry: (e) => e.status >= 500 })).rejects.toThrow('400');
  expect(n).toBe(1);
});
```

### How do you limit concurrency (e.g. upload 100 files, at most 4 at a time)? 🔥

`Promise.all` on 100 requests fires them **all at once**, which overloads the browser (about 6 connections per host on HTTP/1.1) and the server. A **promise pool** keeps at most N in flight:

```js
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  let active = 0;
  let maxActive = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;                       // claim an index (safe: JS is single-threaded)
      active++; maxActive = Math.max(maxActive, active);
      try {
        results[i] = await worker(items[i], i);
      } finally {
        active--;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return { results, maxActive };
}

const files = Array.from({ length: 10 }, (_, i) => `file-${i}.pdf`);
const upload = (name) => new Promise((r) => setTimeout(() => r(`${name} ✓`), 5 + Math.random() * 20));

const { results, maxActive } = await mapWithConcurrency(files, 3, upload);
console.log(results, 'max in flight:', maxActive);

test('never exceeds the limit and keeps order', () => {
  expect(maxActive).toBeLessThanOrEqual(3);
  expect(results[7]).toBe('file-7.pdf ✓');
});
```

### What is a race condition in frontend code and how do you prevent it? 🔥

**Example:** the user types "re" and then "react" in a search box. The request for "re" is slower and **returns after** "react", overwriting the correct results with stale ones.

**Solutions:**

1. **Abort** the previous request (`AbortController`).
2. **Ignore stale responses** with a request ID or an `ignore` flag in the effect cleanup.
3. Use a data-fetching library (**SWR, React Query, RTK Query**). They key the cache by query, so stale responses can't overwrite a newer key.
4. On the server or in state updates: compare versions or timestamps (optimistic concurrency).

```js
function createLatestOnly() {
  let latest = 0;
  return async (promiseFactory) => {
    const id = ++latest;
    const result = await promiseFactory();
    return id === latest ? { stale: false, result } : { stale: true };
  };
}

const latestOnly = createLatestOnly();
const search = (q, ms) => new Promise((r) => setTimeout(() => r(`results(${q})`), ms));
const [first, second] = await Promise.all([latestOnly(() => search('re', 50)), latestOnly(() => search('react', 10))]);
console.log(first, second);

test('stale response is ignored', () => {
  expect(first.stale).toBe(true);
  expect(second.result).toBe('results(react)');
});
```

### Callbacks vs Promises vs async/await vs Observables: when would you use each?

| | Values | Lazy? | Cancellable | Good for |
|---|---|---|---|---|
| **Callback** | many | — | manually | Low-level APIs, event handlers |
| **Promise** | **one** | No (eager: starts when created) | No (use AbortController) | One-shot async results (HTTP request) |
| **async/await** | one | — | via AbortSignal | Readable sequential async logic |
| **Async iterator** | many (pull) | Yes | `return()` / `break` | Streams, pagination |
| **Observable (RxJS)** | **many over time** (push) | **Yes** (nothing happens until subscribed) | **Yes** (`unsubscribe`) | Event streams, websockets, complex composition (debounce, switchMap, retry), Angular |

**Callback hell** (deeply nested callbacks with error handling at every level) motivated promises. async/await then made promise code read like synchronous code.

### How do Web Workers help, and how do you communicate with them?

A **Web Worker** runs a script on a **separate thread**, with its own global scope (`self`) and **no DOM access**. Communication is message passing:

- `worker.postMessage(data)` and `onmessage`
- data is copied with the **structured clone** algorithm, or **transferred** (zero-copy) for `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas` and `VideoFrame` via the transfer list
- `SharedArrayBuffer` plus `Atomics` give truly shared memory (requires cross-origin isolation headers)

**Uses:**

- parsing large files and CSV/JSON
- image and video processing (virtual backgrounds with OffscreenCanvas)
- crypto, compression
- search indexing
- running user code safely: **the playground in this app runs every snippet in a fresh Worker**, which is why infinite loops can be killed with `worker.terminate()`

```node
// main.js
const worker = new Worker(new URL('./heavy.worker.js', import.meta.url), { type: 'module' });
worker.postMessage({ cmd: 'sum', buffer }, [buffer]);   // transfer, not copy
worker.onmessage = (e) => console.log('result', e.data);

// heavy.worker.js
self.onmessage = ({ data }) => {
  const arr = new Float64Array(data.buffer);
  self.postMessage(arr.reduce((a, b) => a + b, 0));
};
```

Other kinds: **SharedWorker** (shared between tabs of the same origin) and **Service Worker** (a network proxy for offline support and push, covered in Browser Internals).

## Ordering puzzles

### Predict the output: promises, timers and async functions 🔥

```js
console.log('1');

setTimeout(() => console.log('2'), 0);

async function asyncFn() {
  console.log('3');
  await Promise.resolve();
  console.log('4');
}

asyncFn();

new Promise((resolve) => {
  console.log('5');
  resolve();
}).then(() => console.log('6'));

queueMicrotask(() => console.log('7'));

console.log('8');
```

**Answer:** `1 3 5 8 4 6 7 2`

1. Synchronous code: `1`, then `asyncFn` runs synchronously until its first `await` → `3`. The promise executor runs synchronously → `5`. Then `8`.
2. Microtasks run in FIFO order of queueing: the `asyncFn` continuation was queued first → `4`, then the `.then` → `6`, then `queueMicrotask` → `7`.
3. Then the timer task → `2`.

### Predict the output: nested microtasks and timers

```js
setTimeout(() => console.log('timeout 1'), 0);

Promise.resolve()
  .then(() => {
    console.log('then 1');
    setTimeout(() => console.log('timeout 2'), 0);
  })
  .then(() => console.log('then 2'));

Promise.resolve().then(() => console.log('then A')).then(() => console.log('then B'));

console.log('sync');
```

**Answer:** `sync, then 1, then A, then 2, then B, timeout 1, timeout 2`

The two promise chains **interleave**: each `.then` in a chain is queued only when the previous one finishes. So the microtask queue goes `then 1`, `then A` → `then 2`, `then B`. Timers run in the order they were *scheduled*: `timeout 1` was queued during the script, `timeout 2` during a microtask.

### Predict the output: `async` return values and `await` ticks (advanced)

```js
const log = [];
async function a1() {
  log.push('a1 start');
  await a2();
  log.push('a1 end');
}
async function a2() {
  log.push('a2');
}
log.push('script start');
setTimeout(() => log.push('setTimeout'), 0);
a1();
new Promise((resolve) => {
  log.push('promise1');
  resolve();
}).then(() => log.push('promise2'));
log.push('script end');

setTimeout(() => console.log(log.join(' → ')), 5);

test('classic interview ordering', async () => {
  await new Promise((r) => setTimeout(r, 10));
  expect(log).toEqual(['script start', 'a1 start', 'a2', 'promise1', 'script end', 'a1 end', 'promise2', 'setTimeout']);
});
```

**Why `a1 end` comes before `promise2`:** `a2()` returns an already-fulfilled native promise. Since ES2019's "await optimisation" (V8 7.2+), `await` on a native promise takes **one** microtask tick, so the `a1` continuation is queued before the `.then` callback. Older engines needed three ticks, and some old blog posts show the opposite order. Mentioning this shows real depth.
