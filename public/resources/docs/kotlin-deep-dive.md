# Kotlin Deep Dive: Coroutines, Flow & Backend Kotlin

[Kotlin](/docs/kotlin) covers the language essentials and coroutine basics. This doc goes to the depth that Kotlin-heavy backend or Android interviews reach:

- **How `suspend` compiles** to a state machine.
- **Coroutine contexts and dispatchers.**
- **Structured concurrency, cancellation and exceptions** in precise detail.
- **Shared state:** `Mutex`, confinement and channels.
- **Flow internals and operators**, plus `StateFlow`/`SharedFlow` configuration and `callbackFlow`.
- **Testing with virtual time.**
- **The type system:** `Nothing`, platform types, value classes, delegation, DSLs, contracts.
- **K2 and Kotlin 2.x.**
- **Kotlin on the server:** Spring Boot, Ktor, Exposed, serialisation.

The Jitsi components you worked around (Jicofo, the Videobridge) are partly written in Kotlin, which makes this a natural topic to bring up.

> Kotlin isn't runnable here. Coroutine **semantics** are simulated in **runnable JavaScript with tests**: the **CPS state machine**, **`coroutineScope` vs `supervisorScope`** cancellation, a **virtual-time test scheduler**, and **debounce + flatMapLatest** timelines.

## Coroutines internals

### How does a `suspend` function work under the hood? 🔥

The Kotlin compiler applies a **continuation-passing style (CPS) transformation**:

1. **A hidden parameter is added.** `suspend fun meetingTitle(id: String): String` becomes, on the JVM, `fun meetingTitle(id: String, cont: Continuation<String>): Any?`.
2. **The return type becomes `Any?`.** The function either returns the result directly, or the special marker **`COROUTINE_SUSPENDED`** if it suspended.
3. **The body becomes a state machine:**
   - Each **suspension point** (a call to another suspend function) gets a **label**.
   - Local variables that are needed after a suspension are stored in fields of a **continuation object**.
   - When the awaited operation completes, it calls `cont.resumeWith(result)`. That **re-enters the function at the saved label**.
4. **No threads are blocked** while suspended. The continuation is just an object on the heap waiting to be resumed, possibly on another thread (chosen by the **dispatcher**).

```kotlin
suspend fun meetingTitle(id: String): String {
    val meeting = api.fetchMeeting(id)          // suspension point → label 1
    val host = api.fetchUser(meeting.hostId)    // suspension point → label 2
    return "${meeting.title} by ${host.name}"
}
```

The runnable block hand-writes that state machine in JavaScript, with exactly the shape the compiler generates:

```js
const COROUTINE_SUSPENDED = Symbol('COROUTINE_SUSPENDED');

// "suspend" leaf functions: return the marker now, resume the continuation later
function fetchMeeting(id, cont) { setTimeout(() => cont.resumeWith({ title: 'Standup', hostId: 'u7' }), 5); return COROUTINE_SUSPENDED; }
function fetchUser(id, cont) { setTimeout(() => cont.resumeWith({ name: 'Zaki' }), 5); return COROUTINE_SUSPENDED; }

// What the compiler generates for meetingTitle(id): a re-entrant state machine
function meetingTitle(id, completion, sm) {
  sm = sm ?? {
    label: 0, id, completion, trace: [],
    resumeWith(value) { this.result = value; meetingTitle(this.id, this.completion, this); },   // re-enter at the saved label
  };
  for (;;) {
    switch (sm.label) {
      case 0: {
        sm.trace.push('label 0 → call fetchMeeting');
        sm.label = 1;
        const r = fetchMeeting(sm.id, sm);
        if (r === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED;   // unwind the stack; nothing is blocked
        sm.result = r;
        break;                                                         // completed immediately: continue at label 1
      }
      case 1: {
        sm.meeting = sm.result;                                        // locals survive in the continuation object
        sm.trace.push('label 1 → call fetchUser');
        sm.label = 2;
        const r = fetchUser(sm.meeting.hostId, sm);
        if (r === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED;
        sm.result = r;
        break;
      }
      case 2: {
        sm.trace.push('label 2 → return');
        sm.completion(`${sm.meeting.title} by ${sm.result.name}`, sm.trace);
        return;
      }
    }
  }
}

test('the state machine suspends twice and completes with the same result as async/await', async () => {
  let firstReturn;
  const { value, trace } = await new Promise((resolve) => {
    firstReturn = meetingTitle('m1', (v, t) => resolve({ value: v, trace: t }));
  });
  expect(firstReturn).toBe(COROUTINE_SUSPENDED);
  expect(value).toBe('Standup by Zaki');
  expect(trace).toEqual(['label 0 → call fetchMeeting', 'label 1 → call fetchUser', 'label 2 → return']);

  const asyncVersion = async () => {
    const m = await new Promise((r) => fetchMeeting('m1', { resumeWith: r }));
    const h = await new Promise((r) => fetchUser(m.hostId, { resumeWith: r }));
    return `${m.title} by ${h.name}`;
  };
  expect(await asyncVersion()).toBe(value);
});
```

**What follows from this:**

- **Suspend functions can only be called from coroutines or other suspend functions**, because they need a continuation to pass.
- **Coroutines are cheap.** A suspended coroutine is a small object (its continuation), not a thread with a 1 MB stack. That's why you can have 100,000s of them.
- **Suspension is cooperative.** A coroutine only suspends at suspension points. A CPU loop with no suspension points **hogs its thread** and **can't be cancelled** unless it checks.
- JavaScript `async/await` and C# `async` use the same idea. **Java's virtual threads** solve the same problem at the runtime level instead: no function colouring, but they need JVM support.

### What is a CoroutineContext, and how do its elements combine? 🔥

A `CoroutineContext` is an **indexed set of elements** keyed by type. You add elements with `+`, and the right-hand side wins for the same key.

| Element | Purpose |
|---|---|
| **`Job`** | Lifecycle: active, completing, cancelled. The parent-child hierarchy and cancellation |
| **`CoroutineDispatcher`** | Which thread or threads execute the coroutine |
| `CoroutineName` | Debugging (shows up in thread names with `-Dkotlinx.coroutines.debug`) |
| **`CoroutineExceptionHandler`** | Last-resort handler for uncaught exceptions in **root** `launch` coroutines |
| `ThreadContextElement` | Propagates ThreadLocal-style context, such as **MDC** (`MDCContext()`) or security context |

```kotlin
val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineName("recording-worker") + MDCContext())

scope.launch(CoroutineName("finalize-42")) {          // inherits the scope's context, overriding the name; gets a NEW child Job
    val meta = withContext(Dispatchers.Default) {     // switch the dispatcher for CPU work, then come back
        parseMetadata(bytes)
    }
    repo.save(meta)
}
```

**Inheritance rules:**

- A child coroutine inherits the parent's context, **except the `Job`**. Every coroutine gets its **own new Job**, whose parent is the scope's or parent coroutine's Job. That link is what makes structured concurrency work.
- **Passing a `Job()` explicitly** (`launch(Job()) { … }`) **breaks the parent-child link**. The coroutine is no longer cancelled with its parent, which is a subtle leak.

### How do dispatchers work, and how do you avoid starving them? 🔥

| Dispatcher | Threads | Use for |
|---|---|---|
| **`Dispatchers.Default`** | A pool sized to the **CPU core count** (minimum 2) | **CPU-bound work**: parsing, sorting, image or JSON processing |
| **`Dispatchers.IO`** | **Elastic**: 64 threads (or the core count, if higher) by default; **shares threads with Default** | **Blocking I/O**: JDBC, file system, blocking SDKs |
| `Dispatchers.Main` | The UI thread (Android, Swing, JavaFX) | UI updates |
| `Dispatchers.Unconfined` | Starts in the caller's thread; resumes in whichever thread resumed it | Rare: testing or special cases |
| `dispatcher.limitedParallelism(n)` | A **view** of a dispatcher with at most n concurrent tasks | **Bulkheads**: "at most 10 concurrent DB calls", or a 1-thread confinement view |
| `executor.asCoroutineDispatcher()` | A custom pool, including **virtual threads**: `Executors.newVirtualThreadPerTaskExecutor().asCoroutineDispatcher()` | Integrating existing pools; blocking calls on virtual threads |

**Starvation pitfalls:**

- **Blocking calls on `Default`** (`Thread.sleep`, JDBC, `File.readText`) occupy one of only N CPU threads. A few of them freeze **all** coroutines on Default. **Wrap blocking calls with `withContext(Dispatchers.IO)`**.
- **Blocking on `Dispatchers.Main`** freezes the UI (an ANR on Android).
- **`runBlocking` inside a coroutine** (or on a request thread in a reactive server) blocks a thread and can **deadlock** a small pool. Use `runBlocking` only at the boundaries: `main` or tests.

```kotlin
private val dbDispatcher = Dispatchers.IO.limitedParallelism(10)       // matches the connection pool size

suspend fun loadParticipants(meetingId: Long): List<Participant> =
    withContext(dbDispatcher) { jdbcTemplate.query(SQL, mapper, meetingId) }   // blocking JDBC isolated on IO, capped at 10
```

### Explain structured concurrency precisely: `coroutineScope` vs `supervisorScope` vs `SupervisorJob` 🔥

**Structured concurrency rules:**

1. Every coroutine runs **inside a scope**, and a parent **doesn't complete until all its children complete**.
2. **Cancelling a parent cancels all its children.**
3. **When a child fails** (an exception other than `CancellationException`), the parent is notified:
   - With a **regular `Job`**, the parent **cancels all its other children** and fails itself. Failure propagates **up**.
   - With a **`SupervisorJob` / `supervisorScope`**, a child's failure **doesn't** affect its siblings or the parent. Each child handles its own failure.

| Builder | Waits for children | A child fails → |
|---|---|---|
| **`coroutineScope { }`** | Yes | Cancels the siblings, then **rethrows** the exception to the caller |
| **`supervisorScope { }`** | Yes | Siblings keep running. The failure goes to that child's handler (launch) or its `await()` (async) |
| `CoroutineScope(SupervisorJob())` | n/a (long-lived scope) | Children are independent. Typical for **application or component scopes** (Android `viewModelScope`, a server's background worker scope) |
| `GlobalScope` | **No parent** | Nothing. **Avoid it**: leaks, no cancellation, no structure |

```kotlin
// All-or-nothing: if fetching recordings fails, the participants call is cancelled and the whole thing fails
suspend fun meetingDetails(id: Long): Details = coroutineScope {
    val participants = async { participantsApi.list(id) }
    val recordings = async { recordingsApi.list(id) }
    Details(participants.await(), recordings.await())
}

// Best effort: one notification channel failing doesn't stop the others
suspend fun notifyAll(event: Event) = supervisorScope {
    launch { email.send(event) }          // a failure here…
    launch { slack.post(event) }          // …doesn't cancel this
    launch { push.send(event) }
}
```

The simulation reproduces both semantics with promises and `AbortController`. Cancellation is delivered at suspension points (`delay`), like Kotlin:

```js
class CancellationError extends Error { constructor() { super('CancellationException'); } }
const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(new CancellationError());
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); reject(new CancellationError()); }, { once: true });
});

// coroutineScope: the first real failure cancels the siblings; the scope waits for all, then rethrows
async function coroutineScope(body) {
  const ac = new AbortController();
  const children = [];
  let failure = null;
  const launch = (child) => children.push(child(ac.signal).catch((err) => {
    if (!(err instanceof CancellationError) && !failure) { failure = err; ac.abort(); }
  }));
  await body(launch);
  await Promise.all(children);                     // the parent completes only after ALL children (incl. their finally blocks)
  if (failure) throw failure;
}
// supervisorScope: failures stay with the failing child
async function supervisorScope(body) {
  const ac = new AbortController();
  const children = [];
  const failures = [];
  const launch = (child) => children.push(child(ac.signal).catch((err) => failures.push(err.message)));
  await body(launch);
  await Promise.all(children);
  return failures;
}

function makeChildren(log) {
  const slow = async (signal) => {
    try { await delay(60, signal); log.push('participants loaded'); }
    catch (e) { log.push('participants cancelled'); throw e; }
    finally { log.push('participants cleanup'); }
  };
  const failing = async (signal) => { await delay(10, signal); throw new Error('recordings API 503'); };
  return { slow, failing };
}

test('coroutineScope: one failure cancels the siblings and is rethrown', async () => {
  const log = [];
  const { slow, failing } = makeChildren(log);
  await expect(coroutineScope(async (launch) => { launch(slow); launch(failing); })).rejects.toThrow('recordings API 503');
  expect(log).toEqual(['participants cancelled', 'participants cleanup']);
});
test('supervisorScope: siblings keep running; the failure is isolated', async () => {
  const log = [];
  const { slow, failing } = makeChildren(log);
  const failures = await supervisorScope(async (launch) => { launch(slow); launch(failing); });
  expect(failures).toEqual(['recordings API 503']);
  expect(log).toEqual(['participants loaded', 'participants cleanup']);
});
```

### How does cancellation work, and what are the classic bugs? 🔥

**Cancellation is cooperative:**

- `job.cancel()` marks the Job as cancelled.
- The coroutine notices at its next **suspension point**: every `kotlinx.coroutines` suspend function checks, and throws **`CancellationException`**.

**The rules:**

1. **CPU loops must check:** `ensureActive()`, `isActive`, or `yield()` (which also lets other coroutines run).
2. **Never swallow `CancellationException`.**
   - `catch (e: Exception)` and **`runCatching { }`** catch it too. The coroutine then keeps running after it was cancelled, and the parent's structured completion is broken.
   - Rethrow it, or catch specific exception types.
3. **Clean up in `finally`.** But you **can't suspend in a cancelled coroutine**: the suspend call would immediately throw again. Wrap suspending cleanup in `withContext(NonCancellable) { … }`.
4. **Timeouts:**
   - `withTimeout(ms)` throws `TimeoutCancellationException` (a subclass of `CancellationException`).
   - `withTimeoutOrNull` returns null.
   - Beware: a `withTimeout` that throws inside `coroutineScope` cancels the scope.
5. **Blocking code doesn't respond to cancellation.** `Thread.sleep` and JDBC calls won't notice. Use **`runInterruptible(Dispatchers.IO) { … }`**, which interrupts the thread on cancellation, or library-level timeouts.

```kotlin
suspend fun transcode(file: Path) = withContext(Dispatchers.Default) {
    val chunks = split(file)
    try {
        for (chunk in chunks) {
            ensureActive()                                  // cooperative check in a CPU loop
            encode(chunk)
        }
    } finally {
        withContext(NonCancellable) { tempStore.delete(file) }   // suspending cleanup still runs after cancellation
    }
}

// ✗ Swallows cancellation
val result = runCatching { api.fetch() }                    // a CancellationException becomes Result.failure → the loop goes on
// ✓ Rethrow cancellation explicitly
val safe = try { Result.success(api.fetch()) } catch (e: CancellationException) { throw e } catch (e: IOException) { Result.failure(e) }
```

### How are exceptions propagated: `launch` vs `async`, and `CoroutineExceptionHandler`?

| Builder | Exception behaviour |
|---|---|
| `launch` | An uncaught exception **propagates to the parent Job** immediately. In a regular scope that cancels the siblings and the parent. At the **root** (or a direct child of a supervisor), it goes to the **`CoroutineExceptionHandler`**, or to the thread's uncaught handler if there isn't one |
| `async` | The exception is stored in the `Deferred` and **thrown on `await()`**. **Inside a regular scope it still propagates to the parent immediately as well.** So `try { deferred.await() } catch` doesn't stop the parent from being cancelled. Use `supervisorScope` for independent asyncs |

**`CoroutineExceptionHandler`:**

- It's a **last-resort logger**, not try/catch. It only works when installed on the **root coroutine** or scope (or on children of a SupervisorJob).
- Installing it on a nested child does nothing.
- It's never invoked for `async` (the exception goes to `await`).
- **Multiple failures:** the first exception wins, and the others are attached as **suppressed** exceptions.

### How do you protect shared mutable state in coroutines? 🔥

| Approach | How | Notes |
|---|---|---|
| **Avoid sharing** | Immutable data, and each coroutine returns results (`async`) instead of mutating shared state | The best option |
| **`Mutex`** | `mutex.withLock { … }`: **suspends** instead of blocking | **Not reentrant**: locking it again from inside `withLock` **deadlocks** |
| **Atomics** | `AtomicInteger`, `AtomicReference.update { }`, kotlinx `atomicfu` | Lock-free counters and immutable state swaps |
| **Thread confinement** | All state access on one thread: `Dispatchers.IO.limitedParallelism(1)` or `newSingleThreadContext` | No locks; the actor-like style |
| **Channels / actor pattern** | A single coroutine owns the state and receives commands through a `Channel` | Clean for complex state machines |
| `StateFlow.update { }` | Atomic compare-and-set update of the state value | UI/view-model state |

**Why not `synchronized` / `ReentrantLock`?**

- You **can't call suspend functions inside `synchronized`** (a compile error).
- **Blocking locks block the thread.** With limited dispatcher threads, that causes starvation and even deadlock.
- They're fine only for very short, **non-suspending** critical sections.

```kotlin
class ParticipantRegistry {
    private val mutex = Mutex()
    private val participants = mutableMapOf<String, Participant>()

    suspend fun join(p: Participant) = mutex.withLock {
        participants[p.id] = p
        // ✗ don't call another method that also does mutex.withLock: Mutex is NOT reentrant → deadlock
    }
    suspend fun snapshot(): List<Participant> = mutex.withLock { participants.values.toList() }   // copy out
}
```

### How do channels work, and when do you use them instead of Flow?

A **`Channel`** is a **hot**, concurrency-safe queue between coroutines. `send` suspends when the buffer is full, and `receive` suspends when it's empty.

| Capacity | Behaviour |
|---|---|
| `RENDEZVOUS` (0, the default) | `send` waits for a matching `receive`: a direct handoff |
| `BUFFERED` (64 by default) / `n` | A bounded buffer: backpressure when full |
| `CONFLATED` | Keeps only the **latest** value; `send` never suspends |
| `UNLIMITED` | Never suspends (memory risk) |
| `onBufferOverflow = DROP_OLDEST/DROP_LATEST` | Lossy, bounded buffers |

```kotlin
// Worker pool (fan-out) pulling recording jobs; results fan in to one channel
fun CoroutineScope.recordingPipeline(jobs: ReceiveChannel<RecordingJob>, workers: Int = 4): ReceiveChannel<Result> =
    produce(capacity = Channel.BUFFERED) {
        coroutineScope {
            repeat(workers) { w ->
                launch {
                    for (job in jobs) send(process(job, worker = w))      // `for` receives until the channel is closed
                }
            }
        }
    }   // produce closes the output channel when all workers finish

// select: react to whichever channel is ready first (with a timeout)
val event = select<String> {
    commands.onReceive { "command: $it" }
    heartbeats.onReceive { "heartbeat" }
    onTimeout(5_000) { "timeout" }
}
```

**Channels vs Flow:**

- **Channels** are for **communication between concurrently running coroutines**: hot, each element consumed once (fan-out).
- **Flow** is for **declarative, cold streams of values**, with operators.
- Use `channelFlow` / `callbackFlow` to **bridge** a channel-backed producer into a Flow.

## Flow deep dive

### How do cold flows work, and what are context preservation and exception transparency? 🔥

**A cold `Flow`:**

- `flow { emit(x) }` is just a description: **nothing runs until `collect`**, and **each collector runs the producer again**.
- **Operators are suspend functions** wrapping the upstream `collect`. **Backpressure is natural**: `emit` suspends until the downstream has processed the value. There's no buffer by default; producer and consumer run **sequentially in the same coroutine**.

**Context preservation:**

- A flow **must emit in the collector's context**. Calling `withContext(Dispatchers.IO) { emit(x) }` inside `flow {}` throws `IllegalStateException`.
- To change where the **upstream** runs, use **`flowOn(Dispatchers.IO)`**. It affects only the operators *above* it, and adds a buffer (a channel) between the two contexts.

**Exception transparency:**

- Don't wrap `emit` in try/catch, because that would catch **downstream** exceptions too.
- Use the **`catch` operator**, which only catches **upstream** exceptions, and can emit fallback values.
- Use `onCompletion` for finally-like behaviour, and `retry`/`retryWhen` for recovery.

```kotlin
fun participantStats(meetingId: String): Flow<Stats> = flow {
    while (currentCoroutineContext().isActive) {
        emit(statsApi.fetch(meetingId))            // blocking-ish network call…
        delay(2_000)
    }
}
    .flowOn(Dispatchers.IO)                        // …so the upstream runs on IO; the collector stays on its own context
    .retryWhen { cause, attempt ->                 // retry transient failures with exponential backoff
        (cause is IOException && attempt < 3).also { if (it) delay(1_000L shl attempt.toInt()) }
    }
    .catch { e -> emit(Stats.unavailable(e.message)) }   // upstream errors become a value
    .onCompletion { cause -> log.debug("stats stream ended: $cause") }
```

### Which Flow operators do you use, and how do `flatMapLatest`, `buffer` and `conflate` differ? 🔥

| Operator | Meaning | Typical use |
|---|---|---|
| `map`, `filter`, `transform`, `onEach` | Per element | Mapping, side effects |
| **`flatMapConcat`** | Process the inner flows **sequentially** | Ordered dependent work |
| **`flatMapMerge(concurrency)`** | Run inner flows **concurrently**, interleaving results | Parallel fetches with a cap |
| **`flatMapLatest`** | **Cancel the previous inner flow** when a new value arrives | **Search-as-you-type** (like RxJS `switchMap`) |
| **`combine(a, b)`** | Emit whenever **any** input emits, using the latest of each | UI state from several sources |
| `zip(a, b)` | Pair the **n-th** element of each | Lockstep pairing |
| `debounce(ms)` | Emit only after a quiet period | Text input |
| `sample(ms)` | The latest value per period | Throttled UI updates (media stats) |
| `distinctUntilChanged` | Skip consecutive duplicates | Avoid redundant work |
| **`buffer(n)`** | Run producer and consumer **concurrently**, with a buffer | Slow consumers, without losing values |
| **`conflate()`** | Keep only the **latest** value when the consumer is busy | Progress, state, sensor data |
| **`collectLatest { }`** | **Cancel** the collector block when a new value arrives | Re-render on the latest state only |
| `stateIn` / `shareIn` | Convert to a hot StateFlow/SharedFlow | Sharing one upstream between collectors |
| `retry`, `catch`, `onCompletion`, `onStart` | Lifecycle and error handling | Resilience, loading states |

```kotlin
val results: Flow<SearchResult> = queryFlow
    .map { it.trim() }
    .debounce(300)                             // wait for a typing pause
    .filter { it.length >= 2 }
    .distinctUntilChanged()
    .flatMapLatest { q -> flow { emit(searchApi.search(q)) } }   // a new query cancels the old request
    .catch { emit(SearchResult.Error(it)) }
```

The timeline simulation shows which emissions survive `debounce` and which requests `flatMapLatest` cancels:

```js
// Timeline semantics (ms) for: queries.debounce(300).flatMapLatest { search(it) }
function debounce(events, windowMs) {
  return events
    .filter((e, i) => !events[i + 1] || events[i + 1].at - e.at >= windowMs)   // no new event inside the window
    .map((e) => ({ at: e.at + windowMs, value: e.value }));                    // emitted when the window closes
}
function flatMapLatest(events, durationOf) {
  const results = [], cancelled = [];
  events.forEach((e, i) => {
    const doneAt = e.at + durationOf(e.value);
    const next = events[i + 1];
    if (!next || doneAt <= next.at) results.push({ at: doneAt, value: `results(${e.value})` });
    else cancelled.push(e.value);                                               // superseded before it finished
  });
  return { results, cancelled };
}

const typed = [
  { at: 0, value: 're' }, { at: 120, value: 'rea' }, { at: 260, value: 'react' },   // fast typing
  { at: 900, value: 'react h' }, { at: 1250, value: 'react hooks' },               // pause, then more typing
];
const debounced = debounce(typed, 300);
const searchTime = (q) => (q === 'react h' ? 500 : 200);                           // the 'react h' search is slow
const { results, cancelled } = flatMapLatest(debounced, searchTime);
console.log({ debounced, results, cancelled });

test('debounce only emits after a 300 ms pause', () => {
  expect(debounced).toEqual([
    { at: 560, value: 'react' },
    { at: 1200, value: 'react h' },
    { at: 1550, value: 'react hooks' },
  ]);
});
test('flatMapLatest cancels the slow search superseded by a newer query', () => {
  expect(cancelled).toEqual(['react h']);              // it would have finished at 1700, after 'react hooks' arrived at 1550
  expect(results.map((r) => r.value)).toEqual(['results(react)', 'results(react hooks)']);
});
```

### How do you configure `StateFlow` and `SharedFlow`, `stateIn` and `shareIn`? 🔥

| | **`StateFlow`** | **`SharedFlow`** |
|---|---|---|
| Holds | **Always one current value** (`.value`) | No value required |
| New collectors get | The current value immediately | The `replay` cache (0..n values) |
| Duplicates | **Conflated by equality**: setting the same value doesn't emit | Every emission is delivered |
| Buffer and overflow | Always conflated | `extraBufferCapacity` + `onBufferOverflow` (SUSPEND / DROP_OLDEST / DROP_LATEST) |
| Use for | **State**: UI state, connection status, "current participants" | **Events**: one-off notifications, broadcasts to many collectors |

**One-off events:**

- Use a `SharedFlow(replay = 0)` or a `Channel` (consumed once).
- **Not a StateFlow**, because a re-emitted state is "re-delivered" to new subscribers. That's the classic "navigation event fires again after rotation" bug.

```kotlin
class MeetingViewModel(repo: MeetingRepo, private val scope: CoroutineScope) {
    private val _state = MutableStateFlow(MeetingState())
    val state: StateFlow<MeetingState> = _state.asStateFlow()

    fun toggleMute() = _state.update { it.copy(muted = !it.muted) }      // atomic CAS loop; never read-then-set

    // Share ONE upstream subscription among all collectors; stop it 5 s after the last collector leaves
    val participants: StateFlow<List<Participant>> = repo.participantsFlow()
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), initialValue = emptyList())

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val events: SharedFlow<UiEvent> = _events.asSharedFlow()
}
```

**`SharingStarted` options:**

- `Eagerly`: start now and never stop.
- `Lazily`: start on the first subscriber and never stop.
- **`WhileSubscribed(stopTimeoutMs)`**: stop when there are no subscribers, after a grace period. 5 s rides out Android configuration changes without restarting expensive upstreams.

### How do you turn a callback-based API into a Flow? (`callbackFlow`) 🔥

**`callbackFlow`** bridges listener-style APIs (WebSocket messages, XMPP stanzas, location updates, Firebase listeners) into a cold Flow, with **cleanup on cancellation**:

```kotlin
fun XmppConnection.presenceEvents(room: String): Flow<PresenceEvent> = callbackFlow {
    val listener = object : PresenceListener {
        override fun onPresence(p: Presence) {
            trySend(PresenceEvent.from(p))                          // non-suspending send from a callback thread
                .onFailure { log.warn("presence dropped: buffer full") }
        }
        override fun onError(t: Throwable) { close(t) }             // complete the flow with an error
    }
    addPresenceListener(room, listener)
    awaitClose { removePresenceListener(room, listener) }           // REQUIRED: runs when the collector cancels; prevents leaks
}.buffer(capacity = 256, onBufferOverflow = BufferOverflow.DROP_OLDEST)   // a policy for bursts
```

**Rules:**

- **Always call `awaitClose`.** Without it the flow completes immediately and throws, or it leaks the listener.
- **Use `trySend` from callbacks** (non-suspending), and decide the buffer and overflow policy deliberately.
- For one-shot callbacks (a single result), use **`suspendCancellableCoroutine`** instead, with `invokeOnCancellation` to cancel the underlying request.

```kotlin
suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onResponse(call: Call, response: Response) = cont.resume(response)
        override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
    })
    cont.invokeOnCancellation { cancel() }                    // cancel the HTTP call if the coroutine is cancelled
}
```

### How do you test coroutines and flows with virtual time? 🔥

**`runTest`** (from `kotlinx-coroutines-test`) runs the test body with a **`TestCoroutineScheduler`**:

- **`delay()` doesn't actually wait.** Virtual time jumps forward, so a test of "retry after 30 s" runs in milliseconds.
- `advanceTimeBy(ms)`, `advanceUntilIdle()`, `runCurrent()` and `currentTime` control and inspect virtual time.
- **`StandardTestDispatcher`** (the default) queues coroutines until the scheduler runs them, giving deterministic ordering. **`UnconfinedTestDispatcher`** runs them eagerly, which is handy for collecting StateFlows.
- **Inject dispatchers** (`class Repo(private val io: CoroutineDispatcher = Dispatchers.IO)`), so tests can pass the test dispatcher. Use `Dispatchers.setMain(testDispatcher)` for Android Main.
- **Turbine** (Cash App) makes flow assertions readable: `flow.test { assertEquals(a, awaitItem()); awaitComplete() }`.

```kotlin
@Test
fun `retries with backoff then succeeds`() = runTest {
    val api = FakeApi(failures = 2)
    val repo = Repo(api, dispatcher = StandardTestDispatcher(testScheduler))
    val result = async { repo.fetchWithRetry() }       // delays of 1 s, then 2 s inside
    advanceUntilIdle()
    assertEquals("ok", result.await())
    assertEquals(3_000, currentTime)                   // virtual time, not wall time
}
```

The same idea in JavaScript: a scheduler with a **virtual clock** that runs timers in order without waiting:

```js
// A minimal virtual-time scheduler (what TestCoroutineScheduler does for delay())
function createTestScheduler() {
  let now = 0, seq = 0;
  const timers = [];
  return {
    get currentTime() { return now; },
    delay(ms) { return new Promise((resolve) => timers.push({ at: now + ms, seq: seq++, resolve })); },
    async advanceUntilIdle() {
      for (;;) {
        await new Promise((r) => setTimeout(r, 0));                  // let resumed coroutines run until they suspend again
        if (!timers.length) return;
        timers.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = timers.shift();
        now = next.at;                                               // jump the clock: no real waiting
        next.resolve();
      }
    },
  };
}

test('ten seconds of delays complete instantly, in virtual-time order', async () => {
  const s = createTestScheduler();
  const log = [];
  const started = Date.now();
  (async () => { await s.delay(10_000); log.push(`A@${s.currentTime}`); })();
  (async () => { await s.delay(5_000); log.push(`B@${s.currentTime}`); await s.delay(10_000); log.push(`C@${s.currentTime}`); })();
  await s.advanceUntilIdle();
  expect(log).toEqual(['B@5000', 'A@10000', 'C@15000']);
  expect(Date.now() - started).toBeLessThan(1_000);
});
```

## Language deep dive

### Explain Kotlin's type system: `Any`, `Unit`, `Nothing`, platform types and smart-cast limits 🔥

| Type | Meaning |
|---|---|
| **`Any`** / `Any?` | The root of all non-null / all types (`Object` on the JVM) |
| **`Unit`** | "No meaningful value". A real singleton object (unlike `void`), so it works with generics: `Function0<Unit>` |
| **`Nothing`** | **The bottom type: no values.** The return type of functions that **never return** (`throw`, `TODO()`, `error()`, infinite loops). It's a subtype of every type, so `val x: String = y ?: throw …` type-checks. `emptyList()` is `List<Nothing>`, which is assignable to `List<T>` because `List` is covariant |
| `Nothing?` | Its only value is `null` |
| **Platform types `T!`** | Types coming from Java **without nullability annotations**. Kotlin doesn't know whether they're nullable, so **null checks are up to you**. Assigning to a non-null type throws an NPE at runtime if it's null. Annotate Java code (JSpecify, `@Nullable`/`@NonNull`) to get real types |
| **Definitely non-null `T & Any`** | Generic code that needs a non-null version of `T` (often for Java interop) |

**Smart casts work only when the compiler can prove the value can't change between the check and the use:**

| Works | Doesn't work |
|---|---|
| `val` locals and parameters | **`var` properties** (another thread or code could change them) |
| `val` properties without custom getters, in the **same module** | `open` properties, or properties with **custom getters** |
| `var` locals not captured by a lambda that modifies them | Properties declared in **another module** (they could change in a new binary version) |

**The fix:** copy to a local `val` (`val user = this.user ?: return`), or use `?.let { }`. **K2** (Kotlin 2.0) made smart casts smarter: logical `||` checks, inline lambdas, and more.

### Generics in depth: declaration-site vs use-site variance, star projections, reified

**Declaration-site variance** (on the class, which Java doesn't have):

- `interface Source<out T> { fun next(): T }`: a **producer**, covariant. `Source<String>` is a `Source<Any>`.
- `interface Sink<in T> { fun put(t: T) }`: a **consumer**, contravariant. `Sink<Any>` is a `Sink<String>`.
- Kotlin's read-only `List<out E>` is covariant. `MutableList<E>` is invariant.

**Use-site variance (type projections),** like Java wildcards:

- `fun copy(from: Array<out Any>, to: Array<Any>)` (`out` = Java's `? extends`).
- `fun fill(dest: Array<in String>)` (`in` = `? super`).

**Star projection `Foo<*>`:**

- "Some unknown T". You can read values out as the upper bound (`Any?`), but you can't write in (except `null` where allowed).
- Like Java's `Foo<?>`.

**`@UnsafeVariance`** suppresses the variance check when you know it's safe. For example, `List<out E>.contains(element: @UnsafeVariance E)`.

**Reified type parameters:**

- **Only in `inline` functions.** The type is available at runtime because the body is inlined at each call site.
- Erasure is the same as Java's elsewhere.

```kotlin
inline fun <reified T> HttpResponse.bodyAs(): T = mapper.readValue(body, T::class.java)
inline fun <reified T : Any> Any.castOrNull(): T? = this as? T                  // a type check on a generic T works only when reified
val dtos: List<MeetingDto> = response.bodyAs()

fun <T> List<T>.secondOrNull(): T? where T : Comparable<T>, T : Any = sorted().getOrNull(1)   // multiple upper bounds
```

### What are value (inline) classes, and when do they box? 🔥

**`@JvmInline value class`** wraps a single value with **zero runtime overhead** in most cases. The compiler uses the underlying type directly.

Use it for **type-safe IDs and units**, so you can't pass a `UserId` where a `MeetingId` is expected:

```kotlin
@JvmInline value class MeetingId(val value: String)
@JvmInline value class UserId(val value: String) {
    init { require(value.startsWith("u_")) { "invalid user id: $value" } }     // validation is allowed
}
@JvmInline value class Millis(val value: Long) { operator fun plus(o: Millis) = Millis(value + o.value) }

fun kick(meeting: MeetingId, user: UserId) { … }
kick(UserId("u_1"), MeetingId("m_2"))         // ✗ compile error: the arguments were swapped, and the compiler catches it
```

**When does it box?** It's represented as the underlying type **except** when used as:

- **A nullable type** (`MeetingId?`, when the underlying type is non-null).
- **A generic type argument** (`List<MeetingId>` stores boxed objects).
- **An interface type** (if the value class implements an interface and is used through it).

**Java interop:**

- Functions taking value classes get **mangled names** (`kick-abc123`) to avoid signature clashes. That makes them awkward to call from Java. Use `@JvmName`, or keep Java-facing APIs on plain types.

**vs `typealias`:**

- A `typealias UserId = String` is **just another name**. There's no type safety; a `String` is accepted anywhere.
- A value class is a **distinct type**.

### Delegation in depth: `lazy` modes, observable, map-backed and custom delegates

```kotlin
class RecorderConfig(private val props: Map<String, Any?>) {
    val bucket: String by props                                   // map-backed properties (from JSON/config maps)
    val maxMinutes: Int by props

    val client: S3Client by lazy(LazyThreadSafetyMode.SYNCHRONIZED) { S3Client.create() }   // the default mode: thread-safe init once
    val parsedRules by lazy(LazyThreadSafetyMode.PUBLICATION) { parse(props["rules"]) }     // may compute more than once; first wins
    val uiOnly by lazy(LazyThreadSafetyMode.NONE) { heavyUiThing() }                         // single-threaded: no locking cost

    var status: String by Delegates.observable("idle") { _, old, new -> log.info("status $old → $new") }
    var quality: Int by Delegates.vetoable(720) { _, _, new -> new in setOf(360, 720, 1080) }   // reject invalid values
}

// Custom delegate: trimmed, length-limited strings
class Trimmed(private val max: Int) : ReadWriteProperty<Any?, String> {
    private var value = ""
    override fun getValue(thisRef: Any?, property: KProperty<*>) = value
    override fun setValue(thisRef: Any?, property: KProperty<*>, value: String) {
        this.value = value.trim().take(max)
    }
}
class Meeting { var title by Trimmed(200) }

// Class delegation: the decorator pattern without boilerplate
class LoggingRepo(private val inner: MeetingRepo) : MeetingRepo by inner {      // every method forwarded…
    override suspend fun save(m: Meeting) { log.info("saving ${m.id}"); inner.save(m) }   // …except the ones overridden
}
```

**Interview points:**

- `by lazy` defaults to `SYNCHRONIZED`, which adds locking cost. In single-threaded contexts (UI), `NONE` is fine.
- **Class delegation is composition over inheritance**, with the compiler generating the forwarding methods.
- `provideDelegate` lets you validate or register at delegate creation time. Gradle and Exposed use it.

### How do you build a type-safe DSL in Kotlin? 🔥

**DSLs use lambdas with receivers** (`T.() -> Unit`): inside the lambda, `this` is the builder, so you call its methods without a qualifier. **`@DslMarker`** prevents accidentally calling an **outer** builder's methods from an inner scope.

```kotlin
@DslMarker annotation class MeetingDsl

@MeetingDsl class MeetingBuilder {
    var title = ""
    var durationMin = 30
    private val participants = mutableListOf<Participant>()
    private var settings = Settings()
    fun participant(email: String, role: Role = Role.ATTENDEE) { participants += Participant(email, role) }
    fun settings(block: SettingsBuilder.() -> Unit) { settings = SettingsBuilder().apply(block).build() }
    fun build() = Meeting(title.also { require(it.isNotBlank()) }, durationMin, participants.toList(), settings)
}
@MeetingDsl class SettingsBuilder {
    var lobby = true
    var recording = RecordingMode.OFF
    fun build() = Settings(lobby, recording)
}
fun meeting(block: MeetingBuilder.() -> Unit): Meeting = MeetingBuilder().apply(block).build()

val standup = meeting {
    title = "Daily standup"
    durationMin = 15
    participant("asha@example.com", Role.HOST)
    participant("ravi@example.com")
    settings {
        recording = RecordingMode.AUTO
        // participant("x")   ← compile error thanks to @DslMarker (no leaking into the outer scope)
    }
}
```

**Real-world DSLs:**

- **Gradle Kotlin DSL** (`build.gradle.kts`).
- **Ktor routing** (`routing { get("/") { … } }`).
- **kotlinx.html**, Spring's `beans { }` and `router { }` DSLs.
- Exposed's SQL DSL, Jetpack Compose (a related mechanism).

### Sealed hierarchies, `when` exhaustiveness and contracts

```kotlin
sealed interface RecordingResult {
    data class Ready(val url: String, val durationSec: Int) : RecordingResult
    data class Failed(val reason: String, val retryable: Boolean) : RecordingResult
    data object InProgress : RecordingResult                          // data object (1.9+): nice toString
}

fun message(r: RecordingResult): String = when (r) {                  // exhaustive: no else; a new subtype = compile error
    is RecordingResult.Ready -> "Ready (${r.durationSec / 60} min)"   // smart cast
    is RecordingResult.Failed if r.retryable -> "Retrying…"           // guard condition (Kotlin 2.1 preview, stable in 2.2)
    is RecordingResult.Failed -> "Failed: ${r.reason}"
    RecordingResult.InProgress -> "Recording…"
}
```

**Use sealed types for:**

- **Domain results and errors**: a typed alternative to exceptions for expected failures.
- **UI state:** `Loading / Content / Error`.
- **Commands and events.**

**Contracts let custom functions inform smart casts:**

```kotlin
@OptIn(ExperimentalContracts::class)
fun Meeting?.isLive(): Boolean {
    contract { returns(true) implies (this@isLive != null) }
    return this != null && status == Status.LIVE
}
if (meeting.isLive()) println(meeting.title)    // smart cast to Meeting: no !! needed
```

The standard library uses contracts for `require`, `check`, `isNullOrEmpty` and `run`/`let` (for `callsInPlace`).

### Collections deep dive: read-only vs immutable, sequences, and useful operations

**`List` is read-only, not immutable.**

- `List<T>` is an **interface without mutators**. The underlying object may still be an `ArrayList` that someone else mutates.
- Casting to `MutableList` (or calling Java code) can mutate it.
- For real immutability, use **`kotlinx.collections.immutable`** (`persistentListOf`), or defensive copies (`toList()`).

**Sequences vs collections:**

- **Collections are eager.** Each operation creates an intermediate list.
- **Sequences are lazy** and process element by element, like Java streams.
- **Use sequences for long chains on large data, or for `first`/`take` short-circuiting.**
- **Small collections are often faster eagerly**: sequences have per-element overhead, and inline collection functions don't allocate lambdas.

```kotlin
val byRole: Map<Role, List<Participant>> = participants.groupBy { it.role }
val counts: Map<Role, Int> = participants.groupingBy { it.role }.eachCount()
val byId: Map<String, Participant> = participants.associateBy { it.id }
val (hosts, others) = participants.partition { it.role == Role.HOST }
val batches: List<List<Event>> = events.chunked(100)                     // fixed-size batches
val movingAvg = latencies.windowed(size = 5, step = 1) { it.average() }  // sliding window
val total = recordings.sumOf { it.sizeBytes }
val firstLongCall = sessions.asSequence().filter { it.minutes > 60 }.map { it.userId }.firstOrNull()   // lazy, stops early
val list = buildList { add(header); addAll(rows); if (withFooter) add(footer) }
```

### What's new in Kotlin 2.x (K2), and what's coming? 🔥

**Kotlin 2.0 (May 2024)** shipped the **K2 compiler**, a rewritten frontend:

- **Much faster compilation**: up to about 2× in JetBrains' benchmarks.
- One unified pipeline for all targets.
- **Smarter smart casts.**
- A better foundation for IDE performance.

**Language features in 2.1–2.2:**

- **Guard conditions in `when`** (`is X if cond ->`).
- **Non-local `break`/`continue`** inside inline lambdas.
- **Multi-dollar string interpolation** (`$$"""{"price": "$$amount"}"""` for templates containing `$`).
- **Context parameters**, a preview replacing the old experimental context receivers. They allow declaring implicit dependencies: `context(logger: Logger) fun process()`.

**Platform:**

- **Kotlin Multiplatform** has been stable since 1.9.20.
- **Compose Multiplatform** for iOS is stable since 2025.
- Kotlin/Wasm is maturing.
- Build tools: the **Gradle Kotlin DSL** is the default, alongside Amper experiments.

**Interview framing:** "K2 is mainly about compiler speed and smarter analysis. Language-wise, I'd highlight guard conditions and context parameters, the replacement for context receivers."

## Kotlin on the backend

### What are the Kotlin-specific gotchas with Spring Boot? 🔥

| Issue | Why | Fix |
|---|---|---|
| **Kotlin classes are `final` by default** | Spring needs to **subclass** (CGLIB proxies) for `@Configuration`, `@Transactional`, `@Cacheable`… | The **`kotlin-spring` (all-open) compiler plugin** opens classes annotated with Spring stereotypes. Start.spring.io adds it |
| **JPA needs no-arg constructors** and non-final classes | Hibernate instantiates entities reflectively and creates lazy proxies | **`kotlin-jpa` (no-arg) plugin** + all-open for `@Entity`. **Don't use `data class` for entities** (equals/hashCode over all fields, `copy()` creating detached duplicates, lazy loading in `toString`) |
| **Jackson and data classes** | Without **`jackson-module-kotlin`**, Jackson can't use Kotlin constructors and default values properly. With the no-arg plugin, non-null properties can end up **null** | Add `jackson-module-kotlin` (Spring Boot registers it automatically when it's on the classpath) |
| **Nullability from Java APIs** | Spring APIs are annotated (JSpecify in Framework 7), so they map to proper Kotlin types | Keep libraries current; treat platform types carefully |
| **Coroutines in controllers** | Spring supports **`suspend fun` handler methods** and `Flow` return types (natively in WebFlux; also in MVC) | `suspend fun get(@PathVariable id: Long): MeetingDto` |
| **Constructor injection** | It's natural in Kotlin (primary constructors). Avoid `lateinit var` + `@Autowired` fields | `class Service(private val repo: MeetingRepo)` |

```kotlin
@RestController
@RequestMapping("/api/meetings")
class MeetingController(private val service: MeetingService) {

    @GetMapping("/{id}")
    suspend fun get(@PathVariable id: Long): MeetingDto = service.find(id) ?: throw MeetingNotFound(id)

    @GetMapping("/{id}/events", produces = [MediaType.TEXT_EVENT_STREAM_VALUE])
    fun events(@PathVariable id: Long): Flow<MeetingEvent> = service.events(id)          // SSE stream from a Flow
}

// Kotlin extensions in Spring: reified, idiomatic helpers
val dto = restClient.get().uri("/recordings/{id}", id).retrieve().body<RecordingDto>()   // no ParameterizedTypeReference
```

### What is Ktor, and how does it compare with Spring Boot? 🔥

**Ktor** is JetBrains' **lightweight, coroutine-first** framework for servers and clients:

- Routing is a **Kotlin DSL**.
- Features are **plugins** you install explicitly: there's no auto-configuration magic.
- Engines: Netty, CIO, Jetty.

```kotlin
fun main() {
    embeddedServer(Netty, port = 8080) {
        install(ContentNegotiation) { json() }                                   // kotlinx.serialization
        install(StatusPages) {
            exception<MeetingNotFound> { call, e -> call.respond(HttpStatusCode.NotFound, Problem(e.message)) }
        }
        install(Authentication) {
            jwt("auth-jwt") {
                verifier(jwkProvider, issuer) { acceptLeeway(3) }
                validate { cred -> if (cred.payload.audience.contains("meethour-api")) JWTPrincipal(cred.payload) else null }
            }
        }
        routing {
            authenticate("auth-jwt") {
                route("/meetings") {
                    get("/{id}") {
                        val id = call.parameters["id"]?.toLongOrNull() ?: return@get call.respond(HttpStatusCode.BadRequest)
                        call.respond(meetingService.find(id) ?: throw MeetingNotFound(id))   // handlers are suspend functions
                    }
                }
            }
        }
    }.start(wait = true)
}
```

| | **Ktor** | **Spring Boot** |
|---|---|---|
| Philosophy | Minimal, explicit, a library | A batteries-included framework with conventions and auto-configuration |
| Concurrency | **Coroutines everywhere** | Threads (MVC/virtual threads) or reactive (WebFlux) plus coroutine support |
| Startup and footprint | Fast, small | Heavier (improvable with AOT/native) |
| Ecosystem | Smaller: you choose libraries (Exposed, Koin) | **Huge**: Data, Security, Batch, Cloud, integrations |
| Testing | `testApplication { client.get("/") }` | Slices, MockMvc, Testcontainers |
| Fits | Microservices, Kotlin-first teams, KMP shared clients (the Ktor client works everywhere) | Enterprise systems, large teams, rich integrations |

### How do you access databases from Kotlin?

| Option | Style | Notes |
|---|---|---|
| **Spring Data JPA** | Repositories, entities | Use the all-open/no-arg plugins and lazy-loading discipline. Blocking: run it from MVC/virtual threads, or wrap it in `Dispatchers.IO` |
| **Spring Data R2DBC** + coroutines | `CoroutineCrudRepository`, `suspend fun`, `Flow` | **Non-blocking** SQL; no lazy loading or JPA features |
| **Exposed** (JetBrains) | A **type-safe SQL DSL** (and a DAO layer) | Idiomatic Kotlin; transactions via `transaction { }` / `newSuspendedTransaction { }` |
| **jOOQ** | Generated type-safe SQL from the schema | Excellent for complex SQL; Kotlin extensions available |
| **Komapper / SQLDelight** | Compile-time checked SQL | SQLDelight generates Kotlin from `.sq` files (popular in KMP) |

```kotlin
// Exposed DSL
object Meetings : LongIdTable("meetings") {
    val title = varchar("title", 200)
    val hostId = long("host_id")
    val startsAt = timestamp("starts_at")
}
suspend fun upcoming(hostId: Long): List<MeetingRow> = newSuspendedTransaction(Dispatchers.IO) {
    Meetings.selectAll()
        .where { (Meetings.hostId eq hostId) and (Meetings.startsAt greater Clock.System.now()) }
        .orderBy(Meetings.startsAt)
        .limit(20)
        .map { MeetingRow(it[Meetings.id].value, it[Meetings.title], it[Meetings.startsAt]) }
}
```

### kotlinx.serialization vs Jackson: what are the trade-offs? 🔥

| | **kotlinx.serialization** | **Jackson + kotlin module** |
|---|---|---|
| Mechanism | A **compiler plugin** generates serialisers at build time: **no reflection** | Runtime reflection |
| Platforms | **Multiplatform** (JVM, JS, Native, Wasm) | JVM only |
| Kotlin awareness | Native: default values, nullability, `@SerialName`, sealed-class polymorphism | Good with the Kotlin module; some edge cases |
| Ecosystem | Ktor default; Spring supports it | **The Spring default**, with a huge ecosystem (Java types, modules, annotations) |
| Performance / native image | Fast, GraalVM-friendly | Reflection needs native-image configuration |

```kotlin
@Serializable
sealed interface Event {
    @Serializable @SerialName("participant.joined") data class Joined(val userId: String, val role: String = "attendee") : Event
    @Serializable @SerialName("recording.ready") data class RecordingReady(val url: String) : Event
}
val json = Json { ignoreUnknownKeys = true; encodeDefaults = false; classDiscriminator = "type" }
val e: Event = json.decodeFromString("""{"type":"participant.joined","userId":"u_7"}""")   // role uses its default
```

**Gotchas:**

- **Missing fields:** non-null properties without defaults fail to decode. That's good: explicit errors instead of nulls.
- Configure **`ignoreUnknownKeys = true`** for tolerant readers of evolving APIs.
- With Jackson, **forgetting `jackson-module-kotlin`** causes broken defaults and nullability, often discovered only in production.

### Which Java interop annotations matter, and why? 🔥

| Annotation / feature | Effect for Java callers |
|---|---|
| `@JvmStatic` (in `companion object` / `object`) | A real **static** method: `Util.parse()` instead of `Util.Companion.parse()` |
| `@JvmField` | Exposes the property as a **public field** (no getter or setter) |
| **`@JvmOverloads`** | Generates overloads for **default parameters**. Java has no default arguments |
| `@JvmName("…")` | Renames the generated method or file class; resolves signature clashes (`List<String>` vs `List<Int>` after erasure) |
| **`@Throws(IOException::class)`** | Declares checked exceptions, so Java callers can catch them. Kotlin has no checked exceptions |
| `fun interface` | **SAM conversion**: Kotlin lambdas work where Java expects a functional interface, and vice versa |
| `internal` | Becomes `public` in bytecode with a **mangled name**. Java can call it, but awkwardly |
| Nullability annotations on Kotlin APIs | Kotlin emits `@NotNull`/`@Nullable`, so Java IDEs warn appropriately |

```kotlin
class RecordingClient @JvmOverloads constructor(
    val baseUrl: String,
    val timeoutMs: Long = 5_000,
    val retries: Int = 2,
) {
    companion object {
        @JvmStatic fun fromEnv(): RecordingClient = RecordingClient(System.getenv("RECORDING_URL"))
        const val API_VERSION = "v1"              // const → a static final field in Java
    }
    @Throws(IOException::class)
    fun start(meetingId: String): String = TODO()
}
// Java: new RecordingClient("https://…"); RecordingClient.fromEnv(); RecordingClient.API_VERSION
```

### What performance considerations are specific to Kotlin?

- **Inline higher-order functions:**
  - `map`, `filter`, `let` and `forEach` on collections are `inline`, so **no lambda allocation**.
  - Your own higher-order functions should be `inline` when they're small and hot.
  - **Non-inline lambdas that capture variables allocate objects.**
- **Boxing:**
  - `Int?`, generic `List<Int>` and `Any` box primitives.
  - Use `IntArray` or `LongArray` for big numeric data, and avoid nullable primitives in hot loops.
- **Collections vs sequences:** see above. Eager is often faster for small data.
- **`data class` `copy()`** allocates a new object each time. That's fine usually, but heavy in tight loops or high-frequency state updates.
- **Companion objects** are a singleton instance. Use `const val` for compile-time constants, so they're inlined and don't touch the companion.
- **String templates** compile to `StringBuilder` chains, which is efficient. Avoid repeated concatenation in loops.
- **Coroutines:**
  - Much cheaper than threads, but not free.
  - Avoid launching a coroutine per tiny item. Batch work, and use `limitedParallelism` or a `Semaphore` for fan-out.
- **Measure with JMH** (the kotlinx-benchmark plugin). The JVM's JIT applies just as for Java.

### Kotlin Multiplatform vs React Native: how would you compare them?

You have React Native on your resume, so expect this comparison.

| | **Kotlin Multiplatform (KMP)** | **React Native** |
|---|---|---|
| What's shared | **Business logic** (networking, persistence, domain) in Kotlin. The UI is native per platform, **or** shared with **Compose Multiplatform** | **The UI and the logic** in JavaScript/TypeScript, rendered to native views (Fabric) |
| Runtime | Compiled to native code (Kotlin/Native on iOS, JVM on Android); no JS bridge | Hermes JS engine + JSI to native |
| Native feel and performance | Native by default; excellent performance | Very good with the new architecture; heavy animations or media sometimes need native modules |
| Team fit | Android/Kotlin teams; incremental adoption in existing native apps | Web/React teams (your background); one codebase for the UI |
| Ecosystem | Ktor client, SQLDelight, kotlinx.serialization, Koin | A huge npm ecosystem, Expo, OTA updates |

**The honest framing for you:** "I've shipped React and React Native. For a team with strong Android/Kotlin skills, or an existing native app, KMP shares logic without changing the UI stack. For a web-heavy team, React Native shares far more."
