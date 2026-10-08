# Python Essentials

Python appears in your skills list. For frontend/full-stack roles it's usually asked at a **working-knowledge level**: the data model, mutability, comprehensions, generators, decorators, context managers, the **GIL and concurrency**, `asyncio`, and quick coding snippets. It's also common in **AWS Lambda** scripts and automation, which is a natural context to mention.

> Python isn't runnable in the playground. Each answer includes the **JavaScript equivalent** where it helps you reason from your strongest language.

## Core language

### What are Python's core data types, and which are mutable? 🔥

| Type | Example | Mutable? | Hashable (usable as a dict key / set member)? | JS analogue |
|---|---|---|---|---|
| `int`, `float`, `complex`, `bool` | `42`, `3.14` | No | Yes | number/bigint (Python ints are **arbitrary precision**) |
| `str` | `"hi"` | No | Yes | string |
| `tuple` | `(1, "a")` | No (if its items are immutable) | Yes | `Object.freeze([..])` |
| `frozenset` | `frozenset({1, 2})` | No | Yes | — |
| `bytes` | `b"\x00"` | No | Yes | `Uint8Array` (mutable in JS) |
| `list` | `[1, 2]` | **Yes** | No | Array |
| `dict` | `{"a": 1}` | **Yes** (insertion-ordered since 3.7) | No | `Map` / object |
| `set` | `{1, 2}` | **Yes** | No | `Set` |
| `None` | `None` | — | Yes | `null`/`undefined` |

**Variables are names bound to objects.** Assignment never copies. Function arguments are passed by **object reference** ("pass by assignment"): mutating a passed list affects the caller, but rebinding the parameter doesn't. That's the same model as JavaScript.

### What is the mutable default argument pitfall? 🔥

Default argument values are evaluated **once, when the function is defined**, not on every call. A mutable default (`[]`, `{}`) is **shared across calls**.

```python
def add_participant(name, room=[]):        # ❌ the same list every call
    room.append(name)
    return room

add_participant("Asha")   # ['Asha']
add_participant("Ravi")   # ['Asha', 'Ravi']  <- surprise!

def add_participant(name, room=None):      # ✅ idiomatic fix
    if room is None:
        room = []
    room.append(name)
    return room
```

### `is` vs `==`, and why you should write `is None`

- **`==`** compares **values** (calls `__eq__`). **`is`** compares **identity** (the same object, like JS `===` on objects).
- Use **`is` only for singletons:** `x is None`, `x is True` (rare). CPython caches small ints (-5..256) and interns some strings, so `a is b` may be true *by accident* for small values. Never rely on that.
- `x is None` is clearer, faster, and can't be fooled by a custom `__eq__`.

### Explain list, dict and set comprehensions and generator expressions 🔥

```python
participants = [{"name": "Asha", "muted": False}, {"name": "Ravi", "muted": True}, {"name": "Zara", "muted": False}]

names = [p["name"] for p in participants]                          # list comprehension
unmuted = [p["name"].upper() for p in participants if not p["muted"]]
by_name = {p["name"]: p for p in participants}                     # dict comprehension
initials = {p["name"][0] for p in participants}                    # set comprehension
total_len = sum(len(p["name"]) for p in participants)              # generator expression: lazy, no list built
matrix_t = [[row[i] for row in [[1, 2], [3, 4]]] for i in range(2)]  # nested: transpose -> [[1, 3], [2, 4]]
```

- Comprehensions are **faster and more readable** than equivalent `for` + `append` loops. They're the Python equivalent of `map` + `filter`.
- **Generator expressions** (with parentheses) are **lazy**: they produce items on demand with O(1) memory, which suits big data or streaming. Like JS iterator helpers.
- Don't nest them more than two levels deep; readability matters.

### What are generators and `yield`? 🔥

A function containing **`yield`** returns a **generator** (an iterator) whose execution **pauses** at each `yield` and resumes on the next `next()`. It's the same concept as JS `function*`.

- **Lazy**, memory-efficient pipelines: read a huge log file line by line, paginate an API.
- `yield from` delegates to a sub-generator (like `yield*`).
- `send()` passes values in, like `next(value)` in JS.

```python
def read_transcript_words(path):
    with open(path, encoding="utf-8") as f:     # file is closed when the generator finishes
        for line in f:                          # files are iterators: one line at a time
            yield from line.split()

def low_confidence(words, threshold=0.7):
    for w in words:
        if w["confidence"] < threshold:
            yield w

import itertools
first_ten = list(itertools.islice(read_transcript_words("big.txt"), 10))   # only reads what's needed
```

### What are decorators? Write one with arguments 🔥

A **decorator** is a function that **takes a function and returns a new function**, usually wrapping it with extra behaviour: logging, timing, caching, retries, auth checks. The `@decorator` syntax is sugar for `func = decorator(func)`. Decorators are built on **closures**. **`functools.wraps`** preserves the wrapped function's name and docstring.

```python
import functools, time, random

def retry(times=3, delay=0.2, exceptions=(ConnectionError,)):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(1, times + 1):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    if attempt == times:
                        raise
                    time.sleep(delay * 2 ** (attempt - 1))   # exponential backoff
        return wrapper
    return decorator

@retry(times=4, exceptions=(ConnectionError, TimeoutError))
def upload_recording(path):
    if random.random() < 0.5:
        raise ConnectionError("S3 hiccup")
    return f"uploaded {path}"

@functools.lru_cache(maxsize=256)          # built-in memoisation decorator
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
```

The JavaScript equivalent is a higher-order function (`const withRetry = (fn) => async (...args) => {…}`). TC39 decorators work on classes and their members.

### What are context managers and the `with` statement? 🔥

A **context manager** guarantees setup and **teardown**, even if an exception occurs: files, locks, DB transactions, temporary directories, timing. It implements `__enter__` and `__exit__`, or uses `@contextlib.contextmanager` with a generator. It's like Java's try-with-resources or TS `using`.

```python
from contextlib import contextmanager
import time

with open("transcript.txt", "w", encoding="utf-8") as f:   # file closed automatically
    f.write("hello")

@contextmanager
def timer(label):
    start = time.perf_counter()
    try:
        yield
    finally:
        print(f"{label}: {(time.perf_counter() - start) * 1000:.1f} ms")

with timer("redaction"):
    run_redaction()

class DbTransaction:
    def __init__(self, conn): self.conn = conn
    def __enter__(self): self.conn.begin(); return self.conn
    def __exit__(self, exc_type, exc, tb):
        (self.conn.rollback if exc_type else self.conn.commit)()
        return False                       # don't suppress the exception
```

### Explain `*args`, `**kwargs`, keyword-only and positional-only parameters

```python
def schedule(title, /, start, *attendees, duration=30, **metadata):
    # title: positional-only (before /)
    # start: positional or keyword
    # *attendees: extra positional args collected into a tuple
    # duration: keyword-only (after *attendees)
    # **metadata: extra keyword args collected into a dict
    return {"title": title, "start": start, "attendees": attendees, "duration": duration, **metadata}

schedule("Standup", "09:30", "asha@x.com", "ravi@x.com", duration=15, recurring=True)
args = ("Retro", "17:00"); opts = {"duration": 60}
schedule(*args, **opts)                   # unpacking, like JS spread
```

### What are dunder (magic) methods and the data model?

Special methods let your classes integrate with Python syntax and built-ins:

- `__init__` (initialiser)
- **`__repr__`** (unambiguous, for developers) vs **`__str__`** (readable, for users)
- `__eq__`/`__hash__` (equality and hashing; define both, or set `__hash__ = None` for mutable objects)
- `__lt__` (sorting; `functools.total_ordering` fills in the rest)
- `__len__`, `__getitem__`, `__iter__`/`__next__` (iteration), `__contains__` (`in`)
- `__call__` (callable instances)
- `__enter__`/`__exit__` (context managers)
- `__add__` and friends (operator overloading)

**`@dataclass`** generates `__init__`, `__repr__` and `__eq__` (plus ordering and hashing when `frozen=True, order=True`). It's like Kotlin data classes or Java records.

```python
from dataclasses import dataclass, field
from typing import Literal

@dataclass(frozen=True, slots=True)        # immutable, hashable, memory-efficient
class Participant:
    id: str
    name: str
    role: Literal["host", "guest"] = "guest"
    tags: tuple[str, ...] = field(default_factory=tuple)

p = Participant("p1", "Asha", "host")
print(p)                                   # Participant(id='p1', name='Asha', role='host', tags=())
print(p == Participant("p1", "Asha", "host"))   # True: value equality
```

## Concurrency

### What is the GIL, and how do you do concurrency in Python? 🔥

- **GIL (Global Interpreter Lock):** in CPython, only **one thread executes Python bytecode at a time** in a process. Threads still help with **I/O-bound** work, because the GIL is **released during blocking I/O** (network, disk, `time.sleep`) and inside many C extensions (NumPy). They **don't speed up CPU-bound pure-Python code**.
- **Options:**

| Workload | Tool | Notes |
|---|---|---|
| **I/O-bound, many connections** | **`asyncio`** (`async`/`await`, an event loop: the same model as JS) | Single-threaded concurrency; needs async libraries (`aiohttp`, `httpx`, `asyncpg`) |
| I/O-bound with blocking libraries | **`threading`** / `concurrent.futures.ThreadPoolExecutor` | Simple; watch for shared-state races (use `Lock`, `queue.Queue`) |
| **CPU-bound** | **`multiprocessing`** / `ProcessPoolExecutor` | Separate processes, so no GIL contention; data is pickled between processes |
| CPU-heavy numeric | NumPy, Numba, Cython, Rust extensions | Work happens outside the GIL |

- **Free-threaded Python:** CPython **3.13** introduced an experimental **no-GIL build** (PEP 703). **3.14** made the free-threaded build officially supported (still optional, not the default).

### Explain `asyncio` with an example. How does it compare to JavaScript? 🔥

`asyncio` runs **coroutines** (`async def`) on an **event loop**. `await` suspends until an awaitable (coroutine, Task, Future) completes. It's conceptually **the same model as JS async/await**, but:

- **Calling an `async def` function doesn't start it.** It creates a coroutine object that must be **awaited** or **scheduled** as a Task (`asyncio.create_task`). JS promises start immediately.
- **`asyncio.gather`** ≈ `Promise.all`. **`asyncio.wait_for`** ≈ a timeout with cancellation. **`TaskGroup`** (3.11) gives **structured concurrency** (like Kotlin's `coroutineScope`).
- **Blocking calls** (`time.sleep`, `requests.get`) **freeze the event loop**, just like blocking JS. Use async libraries, or `await asyncio.to_thread(blocking_fn)`.

```python
import asyncio, httpx

async def fetch_status(client, meeting_id):
    r = await client.get(f"https://api.example.com/meetings/{meeting_id}/status", timeout=5)
    r.raise_for_status()
    return meeting_id, r.json()["status"]

async def main(ids):
    sem = asyncio.Semaphore(5)                         # limit concurrency (like a promise pool)
    async with httpx.AsyncClient() as client:
        async def limited(mid):
            async with sem:
                return await fetch_status(client, mid)
        async with asyncio.TaskGroup() as tg:          # structured concurrency: one failure cancels the rest
            tasks = [tg.create_task(limited(mid)) for mid in ids]
    return dict(t.result() for t in tasks)

statuses = asyncio.run(main(["m1", "m2", "m3"]))
```

### How does Python manage memory?

- **Reference counting:** each object tracks how many references point to it. When the count drops to 0, it's freed **immediately** (deterministic).
- **A cyclic garbage collector** (generational) handles **reference cycles** that refcounting can't (`a.b = b; b.a = a`). Tune or inspect it with the `gc` module.
- **Memory leaks** happen with lingering references: global caches, closures, listeners, cycles involving objects with `__del__` (historically). Tools: `tracemalloc`, `objgraph`, `memory_profiler`.
- **Small-object allocator** (pymalloc), interning of small ints and strings, and **`__slots__`** to save memory per instance.

## Practical Python

### How do exceptions work? Explain `else`, `finally` and `raise from`

```python
class RedactionError(Exception):
    """Domain-specific error with context."""

def redact(doc_id):
    try:
        text = load_text(doc_id)
    except FileNotFoundError as e:
        raise RedactionError(f"document {doc_id} missing") from e   # keep the original cause (like Error.cause)
    else:
        return apply_redactions(text)        # runs only if no exception occurred
    finally:
        cleanup_temp_files(doc_id)           # always runs
```

- Catch **specific** exceptions. A bare `except:` also catches `KeyboardInterrupt`/`SystemExit`.
- **EAFP** ("easier to ask forgiveness than permission") is idiomatic: try the operation and handle the exception, rather than checking first (LBYL).

### Which standard-library modules should you know for interviews? 🔥

```python
from collections import Counter, defaultdict, deque, namedtuple
import heapq, bisect, itertools, functools

words = "the cat and the hat and the bat".split()
Counter(words).most_common(2)              # [('the', 3), ('and', 2)]  — frequency maps

graph = defaultdict(list)                  # no KeyError on missing keys
graph["a"].append("b")

q = deque([1, 2, 3]); q.appendleft(0); q.pop()   # O(1) at both ends: BFS queues

heap = [5, 1, 4]; heapq.heapify(heap)      # min-heap
heapq.heappush(heap, 2); smallest = heapq.heappop(heap)
top3 = heapq.nlargest(3, [7, 2, 9, 4, 8])  # top-K

sorted_ids = [10, 20, 30, 40]
bisect.bisect_left(sorted_ids, 25)         # 2 — binary search insertion point

list(itertools.combinations("ABC", 2))     # [('A','B'), ('A','C'), ('B','C')]
list(itertools.accumulate([1, 2, 3, 4]))   # [1, 3, 6, 10] — prefix sums

sorted(participants, key=lambda p: (p["role"] != "host", p["name"].lower()))   # hosts first, then by name
```

### Show common interview snippets in Python 🔥

```python
# Two Sum (hash map) — O(n)
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
    return []

# Valid anagram
def is_anagram(a, b):
    return Counter(a) == Counter(b)

# Palindrome ignoring non-alphanumerics
def is_palindrome(s):
    clean = [c.lower() for c in s if c.isalnum()]
    return clean == clean[::-1]

# Group anagrams
def group_anagrams(words):
    groups = defaultdict(list)
    for w in words:
        groups["".join(sorted(w))].append(w)
    return list(groups.values())

# Flatten arbitrarily nested lists (generator)
def flatten(xs):
    for x in xs:
        if isinstance(x, list):
            yield from flatten(x)
        else:
            yield x

# Reverse words, FizzBuzz
" ".join(reversed("hello big world".split()))      # 'world big hello'
["FizzBuzz" if i % 15 == 0 else "Fizz" if i % 3 == 0 else "Buzz" if i % 5 == 0 else str(i) for i in range(1, 16)]
```

### What modern Python features (3.8 to 3.14) should you know?

- **3.8:** the **walrus operator** `:=` (`if (n := len(items)) > 10:`), positional-only parameters `/`, the f-string `=` debug specifier (`f"{x=}"`).
- **3.9:** built-in generic types (`list[int]`, `dict[str, int]`), dict merge operators `|` and `|=`, `str.removeprefix`.
- **3.10:** **structural pattern matching** (`match`/`case`, like a powerful `switch` with destructuring), `X | Y` union types, better error messages.
- **3.11:** **significant speed-ups** (Faster CPython, roughly 10–60%), **exception groups** and `except*`, **`asyncio.TaskGroup`**, `tomllib`.
- **3.12:** improved f-strings (nested quotes), the `type` statement for aliases, per-interpreter GIL (subinterpreters, C-API level).
- **3.13:** an experimental **free-threaded (no-GIL) build**, an experimental JIT, a new interactive REPL.
- **3.14:** **free-threaded build officially supported**, **template strings (t-strings, PEP 750)**, deferred evaluation of annotations, `concurrent.interpreters` (multiple interpreters in the standard library).

```python
def describe(event):
    match event:
        case {"type": "recording", "status": "on", "mode": mode}:
            return f"Recording ({mode})"
        case {"type": "recording", "status": "failed", "reason": reason}:
            return f"Recording failed: {reason}"
        case {"type": "participant", "action": "joined" | "left" as action, "name": name}:
            return f"{name} {action}"
        case _:
            return "unknown event"
```

### How do you use Python in AWS Lambda and for automation?

- **Handler:** `def handler(event, context): …` returns a dict (an API Gateway proxy response: `statusCode`, `headers`, `body`).
- **Initialise clients outside the handler** (`boto3.client('s3')`) so warm invocations reuse them.
- **Package dependencies** in the deployment zip or a **Lambda layer**, or use **container images**.
- **Cold starts:** keep the package small and avoid heavy imports at module level.
- Logging uses the `logging` module, with structured output through **Lambda Powertools for Python** (logger, tracer, metrics, idempotency, validation).
- **Typical scripts:** processing S3 events (thumbnails, transcription job triggers), a Jibri finalize uploader, data migrations, **pandas** for CSV/report crunching.
- **Tooling:** **`venv`**, `pip`, `pyproject.toml`; modern fast tools such as **uv** (packages and environments) and **ruff** (lint and format); `pytest` for tests; type checking with mypy or pyright.

### Python vs JavaScript: a quick comparison

| | Python | JavaScript |
|---|---|---|
| Typing | Dynamic, **strong** (`"1" + 1` → TypeError); optional type hints | Dynamic, **weak** (coercion); TypeScript for static types |
| Blocks | Indentation | Braces |
| Concurrency | GIL; threads for I/O; processes for CPU; asyncio | Single-threaded event loop; workers |
| Numbers | Arbitrary-precision int, float | IEEE double (+ BigInt) |
| Async start | Coroutine runs when awaited or scheduled | Promise starts immediately |
| Truthiness | Empty containers (`[]`, `{}`, `""`, `0`) are **falsy** | `[]` and `{}` are **truthy** |
| Main uses | Data and ML, scripting, back ends (Django/FastAPI), automation | Web frontends, Node back ends, full stack |
