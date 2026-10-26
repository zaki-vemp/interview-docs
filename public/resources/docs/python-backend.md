# Python Backend Deep Dive: Internals, asyncio, Django & FastAPI

[Python Essentials](/docs/python) covers the language basics. This doc covers what **Python backend** interviews dig into:

- **CPython internals:** bytecode, the adaptive interpreter, the object model, descriptors, MRO, metaclasses, memory and garbage collection.
- **The GIL and free-threaded Python.**
- **asyncio in depth:** the event loop, TaskGroup, cancellation, blocking-call traps.
- **The frameworks:** WSGI vs ASGI, Django and its ORM, DRF, FastAPI and Pydantic, Flask.
- **Data and background work:** SQLAlchemy 2.0, Celery.
- **Engineering:** typing, testing, packaging, profiling and security.

Python is common for **LLM and document pipelines** (the kind of work behind RBF and SCAI), so expect "would you build this service in Python or Node?" too.

> Python isn't runnable in the browser playground. Three Python mechanisms are **implemented in runnable JavaScript with tests**: **C3 method resolution order**, **attribute lookup with data and non-data descriptors**, and **bounded-concurrency gather** (the `asyncio.Semaphore` pattern).

## CPython internals

### How does CPython execute your code, and why did Python 3.11+ get faster? 🔥

**The pipeline:**

```text
source.py → tokenizer → parser (PEG, 3.9+) → AST → compiler → bytecode (code objects)
         → cached as __pycache__/module.cpython-313.pyc → executed by the interpreter loop (ceval)
```

- **Bytecode** is a sequence of instructions for a **stack-based VM**. You can see it with the `dis` module.
- **The interpreter loop** dispatches each instruction: load names, call functions, build objects.

```python
import dis
def total(prices, tax):
    return sum(prices) * (1 + tax)
dis.dis(total)
#  LOAD_GLOBAL  sum ; LOAD_FAST prices ; CALL 1 ; LOAD_CONST 1 ; LOAD_FAST tax ; BINARY_OP + ; BINARY_OP * ; RETURN_VALUE
```

**Recent performance work:**

| Version | Change |
|---|---|
| **3.11** | **Specialising adaptive interpreter** (PEP 659): hot instructions are **rewritten in place** into type-specialised versions (`BINARY_OP_ADD_INT`, `LOAD_ATTR_INSTANCE_VALUE`) based on observed types. Plus cheaper frames and "zero-cost" exceptions. About **25% faster** on average |
| 3.12 | Comprehension inlining (PEP 709), per-interpreter GIL (for subinterpreters) |
| **3.13** | An **experimental JIT** (copy-and-patch, off by default) and an experimental **free-threaded** build |
| **3.14** | **Free-threaded builds are officially supported** (PEP 779, still not the default), an incremental cyclic GC, template strings (t-strings), and deferred evaluation of annotations |

**What this means in practice:**

- Python is still much slower than the JVM or V8 for **pure-Python CPU loops**.
- Performance comes from:
  - **C-backed libraries** (NumPy, Pandas, Pydantic's Rust core, orjson).
  - **I/O concurrency** (asyncio).
  - **Moving hot loops out of Python** (vectorisation, Cython, Rust via PyO3).

### Explain Python's object model: identity, type, value, and how attribute lookup works 🔥

**The basics:**

- **Everything is an object**: ints, functions, classes, modules.
- Each object has an **identity** (`id()`, its address in CPython), a **type** (`type()`), and a **value**.
- At the C level, every object is a `PyObject` with a **reference count** and a **type pointer**.
- **Small integers (−5 to 256) are cached** and some strings are **interned**. That's why `a is b` can be `True` for small ints and identifier-like strings, and why you **must use `==` for value comparison**.

**Attribute lookup** (`obj.name`, via `type(obj).__getattribute__`), in order:

1. Search the **class and its MRO** for `name`. If it's a **data descriptor** (defines `__set__` or `__delete__`, like `property`), **call its `__get__`**. **It wins over the instance dict.**
2. Otherwise, if `name` is in the **instance `__dict__`**, return it.
3. Otherwise, if the class attribute is a **non-data descriptor** (only `__get__`, like **functions**, which is how methods get bound), call its `__get__`.
4. Otherwise, return the plain class attribute.
5. Otherwise call **`__getattr__`**, if defined. It's the **fallback, called only when normal lookup fails**.
6. Otherwise raise `AttributeError`.

This JavaScript model of the algorithm makes the precedence rules testable:

```js
// Python attribute lookup: data descriptors > instance __dict__ > non-data descriptors > class attrs > __getattr__
const isDescriptor = (v) => v && typeof v === 'object' && typeof v.__get__ === 'function';
const isDataDescriptor = (v) => isDescriptor(v) && (typeof v.__set__ === 'function' || typeof v.__delete__ === 'function');
const lookupClass = (cls, name) => cls.__mro__.map((c) => c.dict).find((d) => name in d)?.[name];

function getattr(obj, name) {
  const cls = obj.__class__;
  const classAttr = lookupClass(cls, name);
  if (isDataDescriptor(classAttr)) return classAttr.__get__(obj, cls);          // 1. data descriptor (e.g. @property)
  if (name in obj.__dict__) return obj.__dict__[name];                           // 2. instance dict
  if (isDescriptor(classAttr)) return classAttr.__get__(obj, cls);              // 3. non-data descriptor (e.g. methods)
  if (classAttr !== undefined) return classAttr;                                 // 4. plain class attribute
  const fallback = lookupClass(cls, '__getattr__');
  if (fallback) return fallback(obj, name);                                      // 5. __getattr__ only on failure
  throw new Error(`AttributeError: '${cls.name}' object has no attribute '${name}'`);
}

// class Meeting:
//     kind = "meeting"                          # plain class attribute
//     @property
//     def title(self): return self._title.upper()   # data descriptor
//     def describe(self): return f"{self.kind}: {self.title}"   # function = non-data descriptor
const Meeting = { name: 'Meeting', dict: {
  kind: 'meeting',
  title: { __get__: (o) => o.__dict__._title.toUpperCase(), __set__: () => { throw new Error('read-only'); } },
  describe: { __get__: (o) => () => `${getattr(o, 'kind')}: ${getattr(o, 'title')}` },   // a "bound method"
} };
Meeting.__mro__ = [Meeting];

const m = { __class__: Meeting, __dict__: { _title: 'standup', title: 'SHADOW?', describe: 'shadowed!' } };

test('a data descriptor (property) beats the instance dict', () => {
  expect(getattr(m, 'title')).toBe('STANDUP');
});
test('the instance dict beats a non-data descriptor (a method can be shadowed)', () => {
  expect(getattr(m, 'describe')).toBe('shadowed!');
  const clean = { __class__: Meeting, __dict__: { _title: 'retro' } };
  expect(getattr(clean, 'describe')()).toBe('meeting: RETRO');
});
test('__getattr__ is only the fallback', () => {
  const Lazy = { name: 'Lazy', dict: { __getattr__: (o, n) => `computed:${n}`, real: 1 } };
  Lazy.__mro__ = [Lazy];
  const o = { __class__: Lazy, __dict__: {} };
  expect(getattr(o, 'real')).toBe(1);
  expect(getattr(o, 'anything')).toBe('computed:anything');
});
```

**`__slots__`:**

- `__slots__ = ('id', 'name')` replaces the per-instance `__dict__` with fixed slots, implemented as data descriptors on the class.
- **Less memory** (significant for millions of objects) and slightly faster access.
- But there are **no dynamic attributes**, and multiple-inheritance constraints. Dataclasses support `@dataclass(slots=True)`.

### What are descriptors, and how do `property`, methods, `classmethod` and ORM fields use them? 🔥

**A descriptor** is any object that defines `__get__`, and optionally `__set__`, `__delete__` and `__set_name__`. When it's stored as a **class attribute**, attribute access on instances goes through it.

| Built-in | Descriptor type | What `__get__` returns |
|---|---|---|
| **Functions** | Non-data | A **bound method** (`instance.method` binds `self`) |
| `property` | **Data** | Calls the getter; `__set__` calls the setter (or raises) |
| `classmethod` | Non-data | The function bound to the **class** |
| `staticmethod` | Non-data | The plain function |
| `functools.cached_property` | **Non-data** | Computes once and stores the result **in the instance `__dict__`**, which then shadows the descriptor. Cheap after the first access |

```python
class Bounded:
    """Reusable validated field: the same mechanism Django model fields and Pydantic-like libraries use."""
    def __init__(self, lo: int, hi: int):
        self.lo, self.hi = lo, hi
    def __set_name__(self, owner, name):           # called at class creation (3.6+): learns its attribute name
        self.private = f"_{name}"
    def __get__(self, obj, objtype=None):
        if obj is None:
            return self                            # accessed on the class itself
        return getattr(obj, self.private)
    def __set__(self, obj, value):
        if not (self.lo <= value <= self.hi):
            raise ValueError(f"{self.private[1:]} must be in [{self.lo}, {self.hi}]")
        setattr(obj, self.private, value)

class MeetingSettings:
    max_participants = Bounded(2, 1000)
    duration_min = Bounded(5, 1440)
    def __init__(self, max_participants, duration_min):
        self.max_participants = max_participants   # goes through Bounded.__set__
        self.duration_min = duration_min

MeetingSettings(50, 60)       # ok
MeetingSettings(5000, 60)     # ValueError: max_participants must be in [2, 1000]
```

**Where you meet descriptors in frameworks:**

- **Django** model fields and related managers: `meeting.participants` is a descriptor returning a manager.
- SQLAlchemy `InstrumentedAttribute`s.
- `dataclasses` fields with defaults.
- Pydantic's internals.

### How does the MRO (C3 linearisation) work, and how does `super()` cooperate? 🔥

**The rule:** with multiple inheritance, Python computes a **Method Resolution Order** using **C3 linearisation**. It's a merge of the parents' MROs that preserves:

1. **Local precedence order:** the order the bases are listed in.
2. **Monotonicity:** a class's MRO is consistent with its parents' MROs.

If no consistent order exists, class creation fails with `TypeError`.

**`super()` follows the MRO of the instance's type, not just the "parent class".**

- In `class D(B, C)`, calling `super().save()` inside `B` goes to **`C`**, not to `A`.
- This enables **cooperative multiple inheritance**: each class calls `super()` once, passing `**kwargs` along. Django's class-based-view **mixins** rely on it.

```js
// C3 linearisation, exactly as CPython computes __mro__
function mro(cls, bases) {
  const parents = bases[cls] ?? [];
  const seqs = [...parents.map((p) => mro(p, bases)), [...parents]];   // parents' MROs + the list of parents
  const result = [cls];
  while (seqs.some((s) => s.length)) {
    const heads = seqs.filter((s) => s.length).map((s) => s[0]);
    const next = heads.find((h) => seqs.every((s) => !s.slice(1).includes(h)));   // a head that's in no tail
    if (!next) throw new TypeError('Cannot create a consistent method resolution order (MRO)');
    result.push(next);
    for (const s of seqs) if (s[0] === next) s.shift();
  }
  return result;
}

test('diamond: D(B, C), both from A', () => {
  const bases = { object: [], A: ['object'], B: ['A'], C: ['A'], D: ['B', 'C'] };
  expect(mro('D', bases)).toEqual(['D', 'B', 'C', 'A', 'object']);   // super() in B → C, not A
});
test('the classic example from the Python 2.3 MRO paper', () => {
  const O = 'object';
  const bases = { [O]: [], A: [O], B: [O], C: [O], D: [O], E: [O],
    K1: ['A', 'B', 'C'], K2: ['D', 'B', 'E'], K3: ['D', 'A'], Z: ['K1', 'K2', 'K3'] };
  expect(mro('Z', bases)).toEqual(['Z', 'K1', 'K2', 'K3', 'D', 'A', 'B', 'C', 'E', 'object']);
});
test('inconsistent hierarchies are rejected', () => {
  const bases = { object: [], X: ['object'], Y: ['object'], A: ['X', 'Y'], B: ['Y', 'X'], C: ['A', 'B'] };
  expect(() => mro('C', bases)).toThrow('consistent method resolution order');
});
```

**Mixins in practice:**

- Put them **left** of the base class: `class MeetingView(LoginRequiredMixin, PermissionRequiredMixin, DetailView)`.
- Mixins call `super().dispatch(...)`, so each one runs in MRO order.

### What are metaclasses, and what simpler tools usually replace them?

**Classes are objects too.** Their type is a **metaclass** (`type` by default). A `class` statement runs:

```text
metaclass(name, bases, namespace)
```

after executing the class body into `namespace`. A custom metaclass can **modify or validate classes at creation time**.

**Where metaclasses are used:**

- **Django** `ModelBase` collects the fields, builds `_meta`, and registers the model.
- SQLAlchemy's declarative base.
- `enum.EnumMeta`.
- `abc.ABCMeta` (abstract methods).

**You rarely need one. Prefer:**

| Need | Simpler tool |
|---|---|
| Register or validate subclasses | **`__init_subclass__`** (3.6+) |
| Know the attribute's name in a descriptor | `__set_name__` |
| Add methods or behaviour | Class decorators, mixins |
| Generic aliases like `MyType[int]` | `__class_getitem__` |
| Data classes | `@dataclass`, attrs, Pydantic |

```python
class Plugin:
    registry: dict[str, type["Plugin"]] = {}
    def __init_subclass__(cls, *, name: str, **kwargs):
        super().__init_subclass__(**kwargs)
        Plugin.registry[name] = cls                 # auto-registration without a metaclass

class S3Storage(Plugin, name="s3"): ...
class GcsStorage(Plugin, name="gcs"): ...
Plugin.registry["s3"]                               # <class 'S3Storage'>
```

### How does Python manage memory, and how do you find leaks? 🔥

**CPython memory management:**

1. **Reference counting:** each object counts its references. At **0** it's **freed immediately**. That gives deterministic cleanup, which is why `with`/close patterns feel natural.
2. **A cyclic garbage collector:** refcounting can't free **cycles** (A ↔ B), so a generational collector periodically finds unreachable cycles. **3.14 made it incremental** to reduce pause times.
3. **pymalloc:** a small-object allocator with arenas and pools. Freed memory is often **kept for reuse rather than returned to the OS**, so RSS may not drop even after objects are freed.

**Common leaks in long-running services:**

| Cause | Example | Fix |
|---|---|---|
| Unbounded caches | Module-level dicts; **`@lru_cache` without `maxsize`** | `maxsize`, TTL caches (`cachetools.TTLCache`), Redis |
| **`lru_cache` on methods** | Caches `self` in its keys, so **instances never die** | Cache on a module-level function, or use `cached_property` per instance |
| Global registries and listeners | Signals connected per request, observers never removed | `weakref` (`WeakSet`, `WeakValueDictionary`), weak signal receivers |
| Cycles with `__del__` / unclosed resources | Sockets, files, DB connections | Context managers |
| Big objects held by long-lived closures or traceback frames | Stored exceptions keep frame locals alive | Drop references; don't store `sys.exc_info()` |

**Tools:**

- **`tracemalloc`** (stdlib): snapshot comparisons by allocation site.
- **memray** (Bloomberg): native and Python allocations, flame graphs.
- **objgraph** (`show_growth`, `show_backrefs`).
- `gc.get_referrers`.
- **py-spy dump** for live stack inspection.

```python
import tracemalloc
tracemalloc.start(25)
snap1 = tracemalloc.take_snapshot()
# … handle 10,000 requests …
snap2 = tracemalloc.take_snapshot()
for stat in snap2.compare_to(snap1, "traceback")[:5]:
    print(stat)          # the top allocation sites by growth, with tracebacks
```

### The GIL in depth: what does free-threaded Python change? 🔥

**The GIL (Global Interpreter Lock):**

- Only **one thread executes Python bytecode at a time** in a CPython process.
- It exists mainly because **reference counting** and many internals aren't thread-safe without it. One big lock is fast for single-threaded code and keeps C extensions simple.

**Consequences:**

- **CPU-bound pure-Python code doesn't speed up with threads.** Use processes or move work to C.
- **I/O-bound code does benefit from threads:** the GIL is **released during blocking I/O** (sockets, files, `time.sleep`).
- **C extensions release the GIL** for heavy work (NumPy, hashlib, zlib, image libraries), so threads *can* run in parallel inside them.
- **The GIL doesn't make your code thread-safe.**
  - It can switch threads between bytecodes, so `counter += 1` (load, add, store) **can still race**.
  - Use `threading.Lock` or thread-safe queues.

**What's changing:**

| Feature | Status | What it means |
|---|---|---|
| **Free-threaded build** (PEP 703, `python3.13t` / `3.14t`) | Experimental in 3.13; **officially supported in 3.14** (not the default build) | **No GIL**: true parallel threads. Single-thread overhead is a few to ~10%. **C extensions must be compatible** (the ecosystem is catching up) |
| **Subinterpreters** (PEP 734: `concurrent.interpreters`, `InterpreterPoolExecutor` in 3.14) | New | Isolated interpreters in one process, each with its own GIL: parallelism with lower overhead than processes |
| `multiprocessing` / `ProcessPoolExecutor` | Mature | The classic route to CPU parallelism: separate processes, pickled data |

**Choosing a concurrency model:**

| Workload | Use |
|---|---|
| Many concurrent network calls (APIs, DB, LLM calls) | **asyncio** (or threads for sync libraries) |
| Blocking libraries and moderate concurrency | `ThreadPoolExecutor` / `asyncio.to_thread` |
| CPU-heavy Python code | `ProcessPoolExecutor`, Celery workers, or vectorised NumPy; later free-threading |
| CPU-heavy in C libraries | Threads are fine (the GIL is released) |

## asyncio deep dive

### How does the asyncio event loop actually work? 🔥

**The building blocks:**

- **`async def` creates a coroutine function.** Calling it returns a **coroutine object**, and **nothing runs yet**. A coroutine runs only when **awaited**, or wrapped in a **Task**.
- **`await x` suspends** the current coroutine until `x` (a coroutine, Task or Future) completes, **yielding control to the event loop**.
- **Tasks** wrap coroutines and **schedule them on the loop**. `asyncio.create_task(coro())` starts running it concurrently "in the background".
- **Futures** are low-level placeholders for results, set by callbacks or I/O.
- **The event loop:**
  - Keeps a **ready queue** of callbacks.
  - Uses a **selector** (epoll/kqueue/IOCP) to wait for socket readiness.
  - Runs ready callbacks **one at a time on one thread**.
  - Timers live in a heap.

**Compared with Node.js:**

- The same single-threaded, cooperative model.
- But **coroutines don't start until awaited or wrapped in a task**. A JS promise-returning function starts executing immediately.
- There's no separate microtask queue; task steps are scheduled with `loop.call_soon`.

**`uvloop`** is a libuv-based drop-in loop, 2–4× faster for networking. Uvicorn uses it when it's installed.

```python
import asyncio, time

async def fetch(name: str, delay: float) -> str:
    await asyncio.sleep(delay)            # suspends: the loop runs other tasks meanwhile
    return f"{name} done"

async def main():
    t0 = time.perf_counter()
    coro = fetch("a", 1)                  # NOT running yet (just a coroutine object)
    task_b = asyncio.create_task(fetch("b", 1))   # scheduled: starts at the next loop iteration
    print(await coro, await task_b)       # ~1 s total, not 2: b ran while a was sleeping
    print(f"{time.perf_counter() - t0:.1f}s")

asyncio.run(main())                       # creates the loop, runs main, closes the loop
```

### `gather` vs `TaskGroup` vs `as_completed` vs `wait`: how do errors and cancellation behave? 🔥

| API | Returns | On error | Use for |
|---|---|---|---|
| **`asyncio.gather(*aws)`** | Results **in order** | **The first exception propagates to the caller, but the other tasks keep running.** With `return_exceptions=True`, exceptions are returned as values | Simple fan-out; best-effort batches with `return_exceptions=True` |
| **`asyncio.TaskGroup()`** (3.11+) | Tasks you create inside it | **The first failure cancels all the other tasks**, then raises an **`ExceptionGroup`** of the failures (handled with `except*`) | **Structured concurrency**, all-or-nothing (like Kotlin's `coroutineScope`) |
| `asyncio.as_completed(aws)` | An iterator of awaitables in **completion order** | Each await raises its own error | Processing results as they arrive (show the fastest results first) |
| `asyncio.wait(aws, return_when=…)` | `(done, pending)` sets | Doesn't raise; inspect the tasks | Advanced control: `FIRST_COMPLETED`, hedging, racing |

```python
async def meeting_dashboard(meeting_id: str):
    try:
        async with asyncio.timeout(3):                           # 3.11+: cancels everything inside on timeout
            async with asyncio.TaskGroup() as tg:
                participants = tg.create_task(api.participants(meeting_id))
                recordings = tg.create_task(api.recordings(meeting_id))
                chat = tg.create_task(api.chat_stats(meeting_id))
        return Dashboard(participants.result(), recordings.result(), chat.result())
    except* httpx.HTTPStatusError as eg:                         # handle one exception type from the group
        log.warning("upstream errors: %s", [str(e) for e in eg.exceptions])
        raise
    except TimeoutError:
        return Dashboard.partial(meeting_id)
```

**Cancellation:**

- `task.cancel()` raises **`CancelledError`** inside the task at its next `await`.
- **It's a `BaseException`** (since 3.8), so `except Exception` doesn't catch it. **Don't swallow it.** If you catch it for cleanup, **re-raise it**.
- **`asyncio.shield(aw)`** protects an inner operation from the outer cancellation. Use it sparingly, for example to finish a DB commit.
- **Timeouts:** `asyncio.timeout()` (3.11) or `wait_for()`.

### Limit concurrency: fetch 1,000 URLs with at most 10 in flight 🔥

**Never `gather` 1,000 requests at once.** You exhaust sockets and file descriptors, trigger rate limits, and the remote API (or LLM provider) throttles you. Bound the concurrency with a **`Semaphore`**, or a fixed pool of worker tasks pulling from a queue.

```python
async def fetch_all(urls: list[str], limit: int = 10) -> list[Result]:
    sem = asyncio.Semaphore(limit)
    async with httpx.AsyncClient(timeout=10) as client:      # ONE client: connection pooling and keep-alive
        async def one(url: str) -> Result:
            async with sem:                                   # at most `limit` concurrently
                r = await client.get(url)
                r.raise_for_status()
                return Result(url, r.json())
        return await asyncio.gather(*(one(u) for u in urls), return_exceptions=True)
```

The same pattern in JavaScript, with a test proving that the limit is respected and the results stay in input order:

```js
// asyncio.Semaphore-style bounded gather: N workers pull from a shared index
async function gatherLimited(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0, inFlight = 0, maxInFlight = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try { results[i] = await tasks[i](); }
      catch (err) { results[i] = err; }                  // like return_exceptions=True
      finally { inFlight--; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return { results, maxInFlight };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tasks = Array.from({ length: 20 }, (_, i) => async () => {
  await sleep((i * 7) % 5);                               // uneven durations
  if (i === 13) throw new Error('HTTP 503 for url 13');
  return `page-${i}`;
});

test('never more than `limit` requests in flight; results keep input order', async () => {
  const { results, maxInFlight } = await gatherLimited(tasks, 4);
  expect(maxInFlight).toBe(4);
  expect(results[0]).toBe('page-0');
  expect(results[19]).toBe('page-19');
  expect(results[13]).toBeInstanceOf(Error);             // failures are returned, not thrown
  expect(results.filter((r) => typeof r === 'string')).toHaveLength(19);
});
```

### What happens if you call blocking code inside `async def`, and how do you fix it? 🔥

**One blocking call freezes the whole event loop.** Every other request on that worker waits: `requests.get`, `time.sleep`, `psycopg2`, heavy JSON or CPU work, reading big files with `open`.

| Blocking thing | Async alternative |
|---|---|
| `requests` | **`httpx.AsyncClient`**, `aiohttp` |
| `psycopg2`, the sync SQLAlchemy engine | **`asyncpg`**, **psycopg 3 async**, SQLAlchemy `AsyncEngine`/`AsyncSession` |
| `redis` (sync) | `redis.asyncio` |
| `time.sleep` | `await asyncio.sleep` |
| boto3 (sync) | `aioboto3`, or `asyncio.to_thread(s3.put_object, …)` |
| CPU-heavy work | `await loop.run_in_executor(process_pool, fn, *args)` |
| An unavoidable sync library call | **`await asyncio.to_thread(fn, *args)`** (3.9+): runs in the default thread pool |

**Detecting it:**

- Enable **asyncio debug mode** (`PYTHONASYNCIODEBUG=1`, or `asyncio.run(main(), debug=True)`). It logs **"Executing <Task …> took 0.250 seconds"** for slow callbacks.
- Profile with **py-spy**.
- Watch for p99 latency spikes across *unrelated* endpoints.

**FastAPI special case:** a plain `def` endpoint (not `async def`) runs in a **threadpool** automatically. So blocking code is safe in `def` endpoints, and **dangerous in `async def` endpoints**.

### What are the important asyncio patterns and gotchas? 🔥

```python
# 1. Producer/consumer with a bounded queue (backpressure) and N workers
async def pipeline(jobs: list[Job]):
    q: asyncio.Queue[Job] = asyncio.Queue(maxsize=100)
    async def worker(n: int):
        while True:
            job = await q.get()
            try:
                await process(job)
            finally:
                q.task_done()
    workers = [asyncio.create_task(worker(i)) for i in range(5)]
    for job in jobs:
        await q.put(job)            # suspends when the queue is full
    await q.join()                  # wait until every job is processed
    for w in workers:
        w.cancel()
    await asyncio.gather(*workers, return_exceptions=True)

# 2. Fire-and-forget tasks MUST be referenced, or they can be garbage-collected mid-flight
background_tasks: set[asyncio.Task] = set()
def spawn(coro):
    task = asyncio.create_task(coro)
    background_tasks.add(task)                          # the loop only keeps a WEAK reference to tasks
    task.add_done_callback(background_tasks.discard)
    return task

# 3. Async context managers and generators
from contextlib import asynccontextmanager
@asynccontextmanager
async def db_transaction(pool):
    async with pool.acquire() as conn:
        tx = conn.transaction()
        await tx.start()
        try:
            yield conn
            await tx.commit()
        except BaseException:                           # includes CancelledError: always roll back
            await tx.rollback()
            raise
```

**Gotchas:**

- **Forgetting `await`** gives `RuntimeWarning: coroutine '…' was never awaited`, and the work never happens.
- **Mixing event loops:**
  - Calling `asyncio.run()` inside a running loop fails.
  - Sharing a client created in one loop with another loop breaks (an issue in tests).
- **Unhandled exceptions in tasks** that nobody awaits are only logged ("Task exception was never retrieved") when the task is garbage-collected. Await your tasks, or attach callbacks.
- **Cancellation cleanup** that awaits must handle repeated cancellation. Use `try/finally`, and `asyncio.shield` for critical commits.

## Web frameworks

### WSGI vs ASGI, and how do you run Python web apps in production? 🔥

| | **WSGI** (PEP 3333) | **ASGI** |
|---|---|---|
| Model | **Synchronous**: one request per worker thread or process at a time | **Asynchronous**: many concurrent requests per worker; also **WebSockets**, SSE, lifespan events |
| Frameworks | Django (classic), Flask | **FastAPI**, Starlette, **Django (ASGI mode)**, Quart, Litestar |
| Servers | **Gunicorn**, uWSGI, mod_wsgi | **Uvicorn**, Hypercorn, Daphne, Granian |

**Production setups:**

```bash
# Django/Flask (sync): Gunicorn with workers, plus threads for I/O overlap
gunicorn app.wsgi:application --workers 5 --threads 4 --timeout 30 --max-requests 2000 --max-requests-jitter 200

# FastAPI (async): Gunicorn managing Uvicorn workers (process supervision + async I/O)
gunicorn app.main:app -k uvicorn.workers.UvicornWorker --workers 4 --bind 0.0.0.0:8000 --graceful-timeout 25
# or simply: uvicorn app.main:app --workers 4   (in Kubernetes, often 1 worker per container + horizontal scaling)
```

**Tuning:**

- **Workers** (processes) ≈ **`2 × cores + 1`** for sync apps (Gunicorn's guidance). Async apps need fewer: about one per core.
- `--threads` gives sync apps I/O concurrency within a process.
- **`--max-requests` with jitter** recycles workers periodically, which is a mitigation for slow memory leaks in long-lived processes.
- Put **Nginx or a load balancer** in front for TLS, static files, buffering slow clients, and request size limits.
- **Memory:** each worker is a full process. `--preload` shares the app code copy-on-write, but forked DB connections must be created **after** the fork.

### Explain Django's architecture and request lifecycle 🔥

**MTV:** **M**odels (ORM), **T**emplates, **V**iews. The "controller" role is the URLconf plus views.

**The request lifecycle:**

```text
WSGI/ASGI handler
 → middleware (in settings.MIDDLEWARE order, request phase): SecurityMiddleware, SessionMiddleware,
   CommonMiddleware, CsrfViewMiddleware, AuthenticationMiddleware, MessageMiddleware, XFrameOptionsMiddleware
 → URL resolver (urls.py) → view function or class-based view (dispatch → get/post)
 → ORM queries, templates/serialisers
 → HttpResponse
 → middleware (REVERSE order, response phase)
 → server
```

```python
# Modern middleware is a callable wrapping the next layer (an onion, like Express/Koa)
class RequestTimingMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response          # called once at startup
    def __call__(self, request):
        start = time.perf_counter()
        response = self.get_response(request)     # everything inside (views, inner middleware)
        response["Server-Timing"] = f"app;dur={(time.perf_counter() - start) * 1000:.1f}"
        return response
```

**What Django gives you:**

- ORM and migrations.
- The **admin**.
- Auth: users, permissions, sessions.
- Forms and validation.
- Security defaults: CSRF, XSS escaping, clickjacking headers, SQL injection protection.
- Caching, i18n, signals.

**Choose Django** for data-heavy products with admin needs and teams that want batteries included. **Choose FastAPI** for API-first, async-heavy, typed microservices (LLM gateways, ML serving).

**Signals** (`post_save`, `pre_delete`) decouple side effects, but they **hide control flow**, run **synchronously**, and fire **before the transaction commits**. Prefer explicit service calls, plus `transaction.on_commit` for side effects.

### Django ORM in depth: QuerySet laziness, N+1, and efficient queries 🔥

**QuerySets are lazy:**

- Building and chaining them runs **no SQL**.
- SQL runs on **evaluation**: iteration, `list()`, `len()`, slicing with a step, `bool()`, `repr()`, `.get()`, `.first()`, `exists()`, `count()`.
- An evaluated QuerySet **caches its results**. Re-iterating it doesn't hit the database, but a **new** QuerySet (`qs.filter(...)`) does.

```python
# ✗ N+1: one query for meetings + one per meeting for the host + one per meeting for participants
for m in Meeting.objects.filter(org=org):
    print(m.host.name, m.participants.count())

# ✓ select_related: SQL JOIN for FK/one-to-one (single-valued)
# ✓ prefetch_related: a separate IN query for many-valued relations (reverse FK, M2M), joined in Python
from django.db.models import Count, Prefetch, F, Q, OuterRef, Subquery

meetings = (
    Meeting.objects.filter(org=org, starts_at__gte=today)
    .select_related("host")                                              # JOIN users
    .prefetch_related(Prefetch("recordings", queryset=Recording.objects.filter(status="ready").only("id", "url")))
    .annotate(participant_count=Count("participants", distinct=True))   # aggregate in SQL
    .only("id", "title", "starts_at", "host__name")                    # fetch only the needed columns
    .order_by("starts_at")
)

# Atomic increment, race-free (no read-modify-write in Python)
Meeting.objects.filter(pk=pk).update(join_count=F("join_count") + 1)

# OR conditions, plus a correlated subquery
latest = Recording.objects.filter(meeting=OuterRef("pk")).order_by("-created_at").values("url")[:1]
qs = Meeting.objects.filter(Q(status="live") | Q(starts_at__lt=now)).annotate(latest_recording=Subquery(latest))

# Bulk operations: one query instead of N
Participant.objects.bulk_create(objs, batch_size=1000, ignore_conflicts=True)
Meeting.objects.bulk_update(changed, ["status"], batch_size=500)

# Huge result sets: stream with a server-side cursor instead of caching everything in memory
for row in Meeting.objects.filter(org=org).values_list("id", "title").iterator(chunk_size=2000):
    write_csv(row)
```

**Pitfalls:**

- **`save()` writes every field and races** (last write wins). Use `update_fields=[…]`, `F()` expressions, or `select_for_update()`.
- **`get_or_create` / `update_or_create` race** under concurrency. **Back them with a unique constraint.** Django then catches the `IntegrityError` and re-fetches.
- `len(qs)` loads every row; `qs.count()` runs `COUNT(*)`. `if qs:` loads everything; `qs.exists()` uses `LIMIT 1`.
- **`.values()`/`.values_list()`** skip model instantiation, which is much faster for reports.
- **Detect N+1** with **django-debug-toolbar**, `nplusone`, `assertNumQueries` in tests, or `connection.queries` in development.

### How do transactions and concurrency work in Django?

```python
from django.db import transaction, IntegrityError

@transaction.atomic                                  # or ATOMIC_REQUESTS=True (one transaction per request, simple but coarse)
def allocate_seat(event_id: int, user_id: int) -> Seat:
    seat = (Seat.objects
            .select_for_update(skip_locked=True)        # FOR UPDATE SKIP LOCKED: concurrent buyers get different seats
            .filter(event_id=event_id, status="free")
            .order_by("row", "number")
            .first())
    if seat is None:
        raise SoldOut()
    seat.status, seat.holder_id = "held", user_id
    seat.save(update_fields=["status", "holder_id"])
    transaction.on_commit(lambda: send_hold_email.delay(seat.id))   # the Celery task is enqueued only if the commit succeeds
    return seat
```

**Rules:**

- **`select_for_update()` must run inside `atomic()`**, otherwise it raises `TransactionManagementError`.
- **Nested `atomic()` blocks create savepoints.** Catching an `IntegrityError` *inside* an inner atomic block lets the outer transaction continue. Catching it without the inner block leaves the transaction broken.
- **Enforce invariants with database constraints** in `Meta.constraints`: `UniqueConstraint(fields=[…], condition=Q(deleted_at=None))` and `CheckConstraint`. Model validation alone doesn't prevent races.
- **`on_commit`** is essential for Celery tasks, emails and cache invalidation. A worker that starts before the commit can't see the row.

### How do you build APIs with Django REST Framework? 🔥

```python
class ParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = Participant
        fields = ["id", "user", "role", "joined_at"]

class MeetingSerializer(serializers.ModelSerializer):
    host_name = serializers.CharField(source="host.name", read_only=True)
    participants = ParticipantSerializer(many=True, read_only=True)

    class Meta:
        model = Meeting
        fields = ["id", "title", "starts_at", "duration_min", "host_name", "participants"]
        read_only_fields = ["id"]

    def validate(self, attrs):                                   # cross-field validation
        if attrs["starts_at"] <= timezone.now():
            raise serializers.ValidationError({"starts_at": "must be in the future"})
        return attrs

class IsHostOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):         # object-level authorisation (IDOR protection)
        return request.method in permissions.SAFE_METHODS or obj.host_id == request.user.id

class MeetingViewSet(viewsets.ModelViewSet):
    serializer_class = MeetingSerializer
    permission_classes = [permissions.IsAuthenticated, IsHostOrReadOnly]
    filterset_fields = ["status"]
    pagination_class = CursorPagination                          # stable keyset pagination
    throttle_scope = "meetings"

    def get_queryset(self):                                      # tenant scoping + N+1 prevention in ONE place
        return (Meeting.objects.filter(org=self.request.user.org)
                .select_related("host").prefetch_related("participants"))

    def perform_create(self, serializer):
        serializer.save(host=self.request.user, org=self.request.user.org)

router = DefaultRouter()
router.register("meetings", MeetingViewSet, basename="meeting")
```

**Points to mention:**

- **Authentication:** `SessionAuthentication` (web, with CSRF), `TokenAuthentication`, or **JWT via `djangorestframework-simplejwt`**.
- **Permissions:** global plus per-view, and **object-level** (`has_object_permission`).
- **Throttling** (rate limits), **pagination** (page number, limit/offset, **cursor**), filtering (`django-filter`).
- **Performance:**
  - Serialisers are slow for large lists.
  - **Always `select_related`/`prefetch_related` in `get_queryset`.**
  - Use `.values()` with plain dicts for big read endpoints, or Django Ninja/FastAPI for performance-critical APIs.
- **OpenAPI:** `drf-spectacular`.

### What is Django's async support, and when would you use Channels?

**Async views:** `async def view(request)` runs natively under ASGI.

**The async ORM API** (4.1+):

- `await Meeting.objects.aget(pk=1)`.
- `async for m in Meeting.objects.filter(...)`.
- `acreate`, `acount`, `aexists`, `adelete`.
- Some parts (transactions) are still sync-only, so wrap those with `sync_to_async`.

**Bridging:** `asgiref.sync.sync_to_async` (runs sync code in a thread, `thread_sensitive=True` by default) and `async_to_sync`.

**When async Django helps:**

- Views that **fan out to slow external APIs** (LLM calls, webhooks).
- Long-polling or streaming responses.
- **WebSockets via Django Channels:** consumers, channel layers backed by Redis for broadcasting to groups (chat rooms, live notifications).

**Reality check:** most Django apps run fine sync under Gunicorn with threads. Go async for specific I/O-bound endpoints. **Mixing in sync ORM calls in async views without `sync_to_async` raises `SynchronousOnlyOperation`.**

### FastAPI in depth: dependency injection, `async` vs `def`, and lifespan 🔥

```python
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

engine = create_async_engine(settings.database_url, pool_size=10, max_overflow=5, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

@asynccontextmanager
async def lifespan(app: FastAPI):                 # startup/shutdown (replaces on_event)
    app.state.http = httpx.AsyncClient(timeout=10)
    yield
    await app.state.http.aclose()
    await engine.dispose()

app = FastAPI(lifespan=lifespan)

async def get_db():                               # "yield" dependency: setup, then teardown after the response
    async with SessionLocal() as session:
        yield session

async def current_user(token: Annotated[str, Depends(oauth2_scheme)], db: Annotated[AsyncSession, Depends(get_db)]) -> User:
    user = await verify_jwt_and_load(token, db)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    return user

class ScheduleMeeting(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    starts_at: datetime
    duration_min: int = Field(ge=5, le=1440)

    @field_validator("starts_at")
    @classmethod
    def must_be_future(cls, v: datetime) -> datetime:
        if v <= datetime.now(timezone.utc):
            raise ValueError("must be in the future")
        return v

class MeetingOut(BaseModel):
    id: int
    title: str
    starts_at: datetime
    model_config = {"from_attributes": True}      # read from ORM objects

@app.post("/meetings", response_model=MeetingOut, status_code=201)
async def schedule(body: ScheduleMeeting, bg: BackgroundTasks,
                   user: Annotated[User, Depends(current_user)], db: Annotated[AsyncSession, Depends(get_db)]):
    meeting = Meeting(**body.model_dump(), host_id=user.id)
    db.add(meeting)
    await db.commit()
    bg.add_task(send_invites, meeting.id)         # runs AFTER the response is sent (same process: not durable!)
    return meeting                                # validated and filtered through MeetingOut
```

**Key points:**

- **Dependency injection with `Depends`:**
  - Dependencies are composable and **cached per request**.
  - **`yield` dependencies** handle setup and teardown (DB sessions, transactions).
  - Override them in tests with `app.dependency_overrides[get_db] = fake_db`.
- **`async def` vs `def` endpoints:**
  - **`def` runs in a threadpool** (anyio, about 40 threads by default), which is safe for blocking libraries.
  - **`async def` runs on the event loop**: only await async I/O inside it.
  - **Blocking calls inside `async def` stall every request on that worker.**
- **Request validation:** invalid input automatically returns **422** with detailed errors.
- **`response_model`** **filters the output** (no leaking `password_hash`) and documents it.
- **OpenAPI** docs at `/docs`, generated from the type hints.
- **`BackgroundTasks`** are in-process and lost on a crash. Use Celery, arq or a queue for important work.
- **Middleware:** CORS, GZip, custom (pure ASGI middleware for performance).

### What changed in Pydantic v2, and how do you use it well? 🔥

**What changed:**

- **pydantic-core is written in Rust**, making validation **5–50× faster** than v1. That's why FastAPI apps sped up with v2.
- The API changed:

| v1 | v2 |
|---|---|
| `.dict()` | `.model_dump()` |
| `.json()` | `.model_dump_json()` |
| `parse_obj` | `model_validate` |
| `@validator` | `@field_validator` |
| `@root_validator` | `@model_validator` |
| `class Config` | `model_config` |

**Modes:**

- **Lax** (the default) coerces: `"5"` becomes `5`.
- **Strict** (`strict=True`, or per field) rejects wrong types. That's useful for internal contracts.

**Discriminated unions** give fast, unambiguous parsing of polymorphic payloads:

```python
from typing import Literal, Annotated, Union
from pydantic import BaseModel, Field, TypeAdapter

class Joined(BaseModel):
    type: Literal["participant.joined"]
    user_id: str
class RecordingReady(BaseModel):
    type: Literal["recording.ready"]
    url: str

Event = Annotated[Union[Joined, RecordingReady], Field(discriminator="type")]
events = TypeAdapter(list[Event]).validate_json(raw_bytes)      # validate JSON bytes directly (fast path)
```

**`pydantic-settings`** loads typed configuration from env vars and `.env` files, with validation at startup: the Python equivalent of the Node config loader in [Node.js in Production](/docs/nodejs-production).

**Performance tips:**

- Use `model_validate_json` on raw bytes, not `json.loads` followed by validation.
- Use `TypeAdapter` for non-model types.
- Avoid huge nested models in hot paths.

### When would you use Flask, and what are app and request contexts?

**Flask** is a micro-framework: routing, Werkzeug request/response, Jinja2 templates. You add **extensions** for everything else (SQLAlchemy, Login, Migrate, CORS).

**Contexts:**

- `request`, `session`, `g` (per-request storage) and `current_app` are **context-local proxies**. They're thread- or greenlet-safe globals, implemented with `contextvars`.
- **The application context** carries `current_app` and `g`.
- **The request context** carries `request` and `session`.
- Using them outside a request (CLI commands, background threads, tests) raises *"Working outside of application context"*. Push one explicitly with `with app.app_context():`.

**Application factory pattern:** a `create_app(config)` function builds the app, registers **blueprints** (modular route groups), and initialises extensions. That enables multiple configurations, testing, and avoids circular imports.

**Choosing:**

| | Flask | FastAPI | Django |
|---|---|---|---|
| Style | Minimal, flexible | Typed, async-first, automatic validation and docs | Batteries included |
| Best for | Small services, legacy apps, custom stacks | **APIs and microservices**, ML/LLM serving, async I/O | Full products with an admin, auth and ORM |

## Data & background work

### How does SQLAlchemy 2.0 work: Core vs ORM, the session, loading strategies? 🔥

**Two layers:**

- **Core:** SQL expression language, connections and transactions. It's **SQL-centric**.
- **ORM:** mapped classes on top of Core.

**The `Session` works like Hibernate's persistence context:**

- An **identity map**: one object per primary key per session.
- A **unit of work**: changes are tracked and flushed together.
- Lazy loading.
- **One session per request or unit of work. Never share a session across threads.**

```python
from sqlalchemy import select, func, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, selectinload, joinedload

class Base(DeclarativeBase): pass

class Meeting(Base):
    __tablename__ = "meetings"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str]
    host_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    host: Mapped["User"] = relationship(lazy="raise")                  # forbid accidental lazy loads (N+1 guard)
    recordings: Mapped[list["Recording"]] = relationship(back_populates="meeting", cascade="all, delete-orphan")

async def upcoming(session: AsyncSession, org_id: int) -> list[Meeting]:
    stmt = (select(Meeting)
            .where(Meeting.org_id == org_id)
            .options(joinedload(Meeting.host), selectinload(Meeting.recordings))   # JOIN for 1:1, IN query for 1:N
            .order_by(Meeting.starts_at)
            .limit(50))
    return list((await session.scalars(stmt)).unique())

# Transaction scope: commit on success, rollback on exception
async with SessionLocal() as session, session.begin():
    session.add(Meeting(title="Retro", host_id=7))
```

| Loading strategy | SQL | Use for |
|---|---|---|
| `lazy="select"` (default) | A query on first access (**N+1 risk**) | Rarely accessed relations |
| **`selectinload`** | A second query, `WHERE id IN (…)` | **Collections** (the best default) |
| **`joinedload`** | A JOIN in the same query | Many-to-one, one-to-one |
| `lazy="raise"` | Error on lazy access | Enforcing explicit loading, **required with async** (lazy loading can't await) |

**Alembic migrations:**

- `alembic revision --autogenerate` diffs the models against the database.
- **Always review the generated migrations.** Renames are detected as drop + add, and some type changes and server defaults are missed.
- Write data migrations separately.

### How does Celery work, and how do you make tasks reliable? 🔥

**Architecture:**

```text
Producer (Django/FastAPI) ──task message──▶ Broker (Redis / RabbitMQ / SQS) ──▶ Workers (processes/threads/gevent)
                                                                              └──▶ Result backend (optional: Redis/DB)
Celery Beat ── periodic schedule ──▶ Broker
```

```python
@app.task(bind=True, autoretry_for=(httpx.TransportError, UpstreamError), retry_backoff=True, retry_backoff_max=600,
          retry_jitter=True, max_retries=8, acks_late=True, soft_time_limit=300, time_limit=330)
def redact_document(self, document_id: int) -> None:
    doc = Document.objects.get(pk=document_id)
    if doc.status == "redacted":                   # idempotent: safe if the task runs twice
        return
    result = llm_redact(doc.storage_key)           # may raise a retryable error
    Document.objects.filter(pk=document_id, status__in=["pending", "processing"]).update(
        status="redacted", redacted_key=result.key)

# Enqueue only after the DB commit
transaction.on_commit(lambda: redact_document.delay(doc.id))
```

**Reliability checklist:**

- **Idempotent tasks.** Delivery is at-least-once, and with `acks_late` a crashed worker's task is redelivered.
- **`acks_late=True`** acknowledges after completion instead of on receipt. With the **Redis/SQS broker, `visibility_timeout`** must be **longer than the longest task**, or the task is redelivered while it's still running.
- **Retries with exponential backoff and jitter.** Only retry transient errors.
- **Time limits:** the soft limit raises `SoftTimeLimitExceeded` so the task can clean up; the hard limit kills it.
- **Pass ids, not objects:** messages are serialised (JSON), and data may change by the time the task runs.
- **Workflows:** `chain` (sequential), `group` (parallel), `chord` (parallel, then a callback).
- **Monitoring:** Flower, queue-length metrics, alerts on failure rate.
- **Routing:** separate queues and workers for slow tasks (PDF and LLM processing) and fast ones (emails), so slow work doesn't starve fast work.
- **Periodic tasks:** Celery **Beat**, run as **a single instance**.

**Alternatives:**

- **RQ** (simple, Redis).
- **Dramatiq.**
- **arq** (asyncio, Redis).
- **Huey.**
- **Temporal** (durable workflows, for long multi-step processes such as document pipelines with human review).
- **SQS + Lambda** for serverless.

### How do you cache in Python backends, and what are the pitfalls?

| Tool | Scope | Notes |
|---|---|---|
| `functools.lru_cache(maxsize=…)` / `functools.cache` | In process, per worker | **`cache` is unbounded.** It holds references forever, and caching on methods leaks `self`. Not shared between Gunicorn workers |
| `functools.cached_property` | Per instance | Computed once per object |
| `cachetools.TTLCache` | In process, with TTL | Thread-safety needs a lock |
| **Django cache framework** (Redis backend) | Shared | `cache.get_or_set`, `@cache_page`, template fragments, versioned keys |
| **Redis directly** (`redis.asyncio`) | Shared | Rate limiting, locks, sessions (see [Redis & Caching](/docs/redis-caching)) |

**Remember:**

- **Each Gunicorn or Uvicorn worker process has its own memory.** In-process caches are duplicated and inconsistent across workers. Use Redis for anything shared.
- **Invalidate on write** with `on_commit`.

## Quality & operations

### How do you use type hints effectively in Python (compared with TypeScript)? 🔥

**Type hints are not enforced at runtime.** They're for **static checkers** (mypy, pyright), editors, and frameworks that **read them at runtime** (FastAPI, Pydantic, dataclasses).

| Feature | Python | TypeScript analogue |
|---|---|---|
| **`Protocol`** | **Structural typing**: any object with matching methods fits | Interfaces (structural) |
| `TypedDict` | Typed dict shapes (JSON payloads) | Object types |
| Generics (3.12 syntax) | `def first[T](xs: list[T]) -> T:`, `class Box[T]: …` | `function first<T>(xs: T[]): T` |
| `type` aliases (3.12) | `type UserId = str` | `type UserId = string` |
| `Literal`, unions | `Literal["host", "guest"]`, `int \| None` | `'host' \| 'guest'`, `number \| null` |
| `@overload` | Several signatures | Overloads |
| `ParamSpec`, `Concatenate` | Typing decorators that preserve signatures | `Parameters<F>` |
| `Annotated[T, meta]` | Attach metadata (FastAPI `Depends`, Pydantic constraints) | — |
| `NewType` | A distinct nominal type for ids | Branded types |
| `TypeGuard` / `TypeIs` (3.13) | User-defined narrowing | `x is T` predicates |

```python
from typing import Protocol

class Storage(Protocol):                      # any class with these methods qualifies: no inheritance needed
    async def put(self, key: str, data: bytes) -> str: ...
    async def url(self, key: str, expires_s: int = 900) -> str: ...

class RecordingService:
    def __init__(self, storage: Storage) -> None:     # S3Storage, GcsStorage, or a FakeStorage in tests
        self.storage = storage
```

**Practices:**

- `mypy --strict` or pyright in CI.
- Type the **boundaries** first: public functions, models.
- Use **Pydantic or `TypedDict` for external data**.
- **3.14's deferred annotations** remove most forward-reference quoting.

### How do you test Python backends with pytest? 🔥

```python
import pytest
from httpx import AsyncClient, ASGITransport

@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"

@pytest.fixture
async def client(db_session):                                   # fixtures compose; yield = teardown
    app.dependency_overrides[get_db] = lambda: db_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()

@pytest.mark.anyio
@pytest.mark.parametrize("duration,status", [(4, 422), (5, 201), (1441, 422)])
async def test_schedule_validates_duration(client, auth_headers, duration, status):
    r = await client.post("/meetings", json={"title": "Demo", "starts_at": future_iso(), "duration_min": duration},
                          headers=auth_headers)
    assert r.status_code == status

def test_retry_on_timeout(monkeypatch):
    calls = []
    def fake_post(*a, **kw):
        calls.append(1)
        if len(calls) < 3:
            raise httpx.ReadTimeout("slow")
        return FakeResponse(200)
    monkeypatch.setattr("app.clients.llm.httpx.post", fake_post)   # patch WHERE IT IS LOOKED UP, not where it is defined
    assert call_llm_with_retry("hi").status_code == 200
    assert len(calls) == 3
```

**The toolkit:**

- **Fixtures** with scopes (function/module/session) and `yield` teardown, plus **`conftest.py`** sharing.
- **`parametrize`.**
- **`monkeypatch`** and `unittest.mock.patch`. **Patch the name where it's used**: `app.service.requests`, not `requests`.
- **Factories:** `factory_boy` and Faker for test data.
- **Django:** `pytest-django` (`@pytest.mark.django_db`), `assertNumQueries` to catch N+1.
- **Real dependencies:** **testcontainers-python** (Postgres, Redis), `respx`/`responses` to mock HTTP.
- **Property-based testing:** **Hypothesis** generates edge cases (great for parsers and validators).
- **Coverage:** `pytest-cov`. Parallel runs: `pytest-xdist`.

### How do you manage packaging, dependencies and Docker images in Python? 🔥

**Environments:**

- **Always use virtual environments**: `python -m venv .venv`, or tool-managed.
- Never `pip install` into the system Python.

**`pyproject.toml`** (PEP 621) is the standard project metadata: dependencies, build backend, tool configuration (ruff, mypy, pytest).

**Dependency tools:**

| Tool | Notes |
|---|---|
| pip + `requirements.txt` | Simple. Pin with `pip-compile` (pip-tools) for **lockfile-like reproducibility** |
| **Poetry** | Dependency resolution, a lock file, virtualenvs, publishing |
| **uv** (Astral) | **Extremely fast** (Rust) resolver and installer, `uv lock`, `uv sync`, Python version management. Rapidly becoming the default |
| PDM, Hatch | PEP-compliant alternatives |

**Lock files** pin the exact versions of **transitive dependencies**. Commit them, and install with `--frozen` or `--locked` in CI and Docker.

```dockerfile
FROM python:3.13-slim AS build
ENV PIP_NO_CACHE_DIR=1 UV_COMPILE_BYTECODE=1
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project      # dependency layer (cached)
COPY . .
RUN uv sync --frozen --no-dev

FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PATH="/app/.venv/bin:$PATH"
WORKDIR /app
COPY --from=build /app /app
RUN useradd -r -u 10001 appuser
USER appuser
CMD ["gunicorn", "app.main:app", "-k", "uvicorn.workers.UvicornWorker", "-w", "2", "-b", "0.0.0.0:8000"]
```

**Image details:**

- **`PYTHONUNBUFFERED=1`** means logs appear immediately in the container logs.
- **Slim (Debian) over Alpine** for Python: musl breaks many wheels (manylinux), forcing slow source builds.
- **Wheels:** prefer binary wheels. Build native dependencies in the build stage.

### How do you profile and speed up Python code? 🔥

| Tool | Use |
|---|---|
| **`cProfile`** + snakeviz / `pstats` | Deterministic function-level profiling in development |
| **py-spy** | **Sampling profiler that attaches to a running process** (no code changes, production-safe): `py-spy top --pid`, `py-spy record -o flame.svg` |
| **Scalene** | CPU + memory + GPU, line-level, separates Python time from native time |
| line_profiler | Line-by-line timing of hot functions |
| **memray**, tracemalloc | Memory |
| `timeit` | Micro-benchmarks |

**Optimisation ladder:**

1. **I/O first:**
   - Batch database queries (N+1!).
   - Add indexes.
   - Cache.
   - **Use async or threads for concurrent network calls.**
2. **Algorithms and data structures:** `set`/`dict` lookups instead of list scans; avoid quadratic loops.
3. **Built-ins and C-backed libraries:** `sum`, `sorted`, comprehensions, `collections.Counter`, **orjson** for JSON, **NumPy/Pandas/Polars** vectorisation.
4. **Parallelism** for CPU work: `ProcessPoolExecutor`, Celery workers, free-threaded Python where the stack supports it.
5. **Compile the hot paths:** **Cython**, **Rust via PyO3/maturin**, Numba for numeric code. **PyPy** for long-running pure-Python workloads.

### Which security issues are specific to Python web apps? 🔥

| Risk | Vulnerable example | Fix |
|---|---|---|
| **SQL injection** | `cursor.execute(f"SELECT * FROM users WHERE email = '{email}'")`, `Model.objects.raw(f"…")`, `.extra()` | Parameters: `cursor.execute("… WHERE email = %s", [email])`, ORM filters, `text()` with bound parameters in SQLAlchemy |
| **Unsafe deserialisation** | **`pickle.loads(untrusted)`** (arbitrary code execution); `yaml.load(data)` | **Never unpickle untrusted data**; `yaml.safe_load`; JSON |
| **Server-side template injection** | `Template(user_input).render()` (Jinja2) | Never build templates from user input; autoescaping; sandboxed environments |
| **Command injection** | `os.system(f"ffmpeg -i {name}")`, `subprocess.run(cmd, shell=True)` | `subprocess.run(["ffmpeg", "-i", path], check=True)` (list form, no shell) |
| **Path traversal** | `open(os.path.join(BASE, filename))` with `../` | `Path(BASE, name).resolve()` and check `is_relative_to(BASE)` |
| **SSRF** | `requests.get(user_url)` reaching the cloud metadata endpoint | Allowlists; block private IPs after resolving DNS |
| **Weak randomness** | `random.choice` for tokens | **`secrets.token_urlsafe()`**, `secrets.compare_digest` |
| **Debug in production** | `DEBUG=True` leaks settings and stack traces; Werkzeug's debugger console is **remote code execution** | `DEBUG=False`, `ALLOWED_HOSTS`, `SECURE_*` settings (HSTS, SSL redirect, secure cookies), `python manage.py check --deploy` |
| **Dependencies** | Vulnerable or typosquatted packages | **`pip-audit`**, Dependabot, pinned hashes (`--require-hashes`), trusted indexes |

Django's defaults (CSRF middleware, template autoescaping, ORM parameterisation, password hashing with PBKDF2 or Argon2) prevent most of these **if you don't bypass them**.

### Python or Node.js for a new backend service: how do you decide? 🔥

| Factor | Python | Node.js |
|---|---|---|
| **AI/ML and data** | **The clear winner**: PyTorch, Transformers, LangChain/LlamaIndex, Pandas, NumPy, every LLM SDK first-class | Good LLM SDKs (Anthropic, OpenAI, Vercel AI SDK); weaker for ML or data science |
| I/O concurrency | asyncio (FastAPI) is good; the ecosystem is mixed sync/async | **Async by default** everywhere; a mature event-loop ecosystem |
| CPU-bound work | GIL limits (processes, C extensions, free-threading coming) | Single-threaded too (worker threads) |
| Full-stack synergy | Separate language from a React frontend | **Shared TypeScript types**, zod schemas and tooling with React/Next.js |
| Web frameworks | Django (batteries), FastAPI (typed APIs) | Express/Fastify/NestJS, Next.js server |
| Real-time | Channels, websockets libraries | **Socket.IO, ws**: very strong |
| Team and hiring | Data and ML teams, Django shops | Web and JS teams |

**A balanced answer for your profile:**

- "My strongest backend stack is **Node/TypeScript**, because of the shared types with React and the real-time strengths I used around MeetHour."
- "For **LLM-heavy document pipelines** (like RBF's redaction or SCAI's extraction), I'd happily use **Python**, where the AI and PDF tooling (PyMuPDF, pdfplumber, LangChain) is richest."
- "Often the right architecture is **both**: a Node or Next.js BFF for the product, and Python workers for ML and document processing, connected by a queue."

*[Adjust to what RBF/SCAI were actually built with.]*
