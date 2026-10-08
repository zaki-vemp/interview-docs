# Kotlin

Kotlin is on your resume, and it's the main language of **Jicofo and much of the Jitsi Videobridge**. It's also the default language for Android (React Native native modules). Interviews focus on **null safety, data and sealed classes, extension and scope functions, inline/reified, delegation, generics variance and, above all, coroutines and Flow**.

> Kotlin isn't runnable in the playground. Where it helps, answers compare Kotlin concepts with their **TypeScript/JavaScript** equivalents, which makes explanations easier for a frontend-heavy engineer.

## Language fundamentals

### Why Kotlin over Java? What are its key advantages? 🔥

- **Null safety in the type system:** `String` vs `String?`, which eliminates most `NullPointerException`s at compile time.
- **Conciseness:** data classes, type inference, default and named arguments, string templates, `when` expressions, properties instead of getters and setters, smart casts.
- **Functional features:** lambdas, higher-order functions, a rich collections API, extension functions, **sealed types** with exhaustive `when`.
- **Coroutines:** structured, readable asynchronous code (`suspend`, `Flow`).
- **100% Java interop:** call Java libraries directly; mix languages in one project (as Jitsi does).
- **Multiplatform:** JVM, Android, JS, Native, and Kotlin Multiplatform for sharing business logic.
- **No checked exceptions.** **Classes are `final` by default** (inheritance must be explicit with `open`).
- **Kotlin 2.x** ships the **K2 compiler** (faster, smarter analysis).

### Explain Kotlin's null safety operators 🔥

| Syntax | Meaning | TS equivalent |
|---|---|---|
| `String?` | A nullable type | `string \| null` |
| `a?.b` | Safe call: `null` if `a` is null | `a?.b` |
| `a ?: b` | **Elvis**: `b` if `a` is null (only null, not "falsy") | `a ?? b` |
| `a!!` | Assert non-null; throws an NPE if null (a code smell) | `a!` (non-null assertion) |
| `a?.let { … }` | Run a block only when non-null, with `it` = the value | `if (a != null) { … }` |
| `as?` | Safe cast: `null` instead of `ClassCastException` | — |
| Smart cast | After `if (a != null)`, `a` is treated as non-null | Narrowing |

**Platform types:** values from Java (`String!`) have **unknown nullability**. Annotate the Java code (`@Nullable`/`@NonNull`, JSpecify) or treat them as nullable.

```kotlin
data class Participant(val id: String, val displayName: String?, val email: String?)

fun greeting(p: Participant?): String {
    val name = p?.displayName?.trim()?.takeIf { it.isNotEmpty() } ?: "Guest"   // safe calls + elvis
    p?.email?.let { sendWelcome(it) }                                           // only if non-null
    return "Welcome, $name"
}

fun requireRoom(roomId: String?): String = roomId ?: throw IllegalArgumentException("roomId required")
```

### `val` vs `var` vs `const val`; `lateinit` vs `lazy`

- **`val`** is a read-only **reference** (like JS `const`; the object itself may still be mutable). **`var`** is mutable. **`const val`** is a **compile-time constant** (primitives and String, top-level or in an `object`/companion), inlined at use sites.
- **`lateinit var`:** a non-null `var` initialised **later** (dependency injection, test setup, Android `onCreate`). Accessing it before initialisation throws `UninitializedPropertyAccessException`. Check with `::prop.isInitialized`. Not allowed for primitives.
- **`by lazy { … }`:** a `val` computed **on first access** and cached. **Thread-safe by default** (`LazyThreadSafetyMode.SYNCHRONIZED`). Good for expensive objects (a parser, a regex, a config).

### Data classes, sealed classes, enums and objects 🔥

- **`data class`:** auto-generates `equals`/`hashCode`/`toString`, **`copy()`** and `componentN()` (destructuring) from the **primary-constructor** properties. It's ideal for immutable models, like Java records or TypeScript types plus value semantics.
- **`sealed class`/`sealed interface`:** a **closed hierarchy** (all subclasses known at compile time, in the same module and package). **`when` is exhaustive without `else`**, so adding a subtype breaks the compile until it's handled. This is **Kotlin's discriminated union**, perfect for UI state, results and events.
- **`enum class`:** a fixed set of constants, which can have properties and methods (`entries` since 1.9).
- **`object`:** a **singleton** declaration (thread-safe lazy initialisation). **`companion object`** holds static-like members and factories inside a class. Also object expressions (anonymous objects).
- **`@JvmInline value class`:** wraps a single value **with no runtime allocation** in most cases. Gives type safety like **branded types** in TS (`value class MeetingId(val raw: String)`).

```kotlin
@JvmInline value class MeetingId(val raw: String)

sealed interface RecordingState {
    data object Idle : RecordingState
    data class Pending(val sessionId: String) : RecordingState
    data class On(val sessionId: String, val mode: Mode, val startedAt: Long) : RecordingState
    data class Failed(val sessionId: String, val reason: String) : RecordingState
    enum class Mode { FILE, STREAM }
}

fun label(state: RecordingState): String = when (state) {          // exhaustive: no else needed
    RecordingState.Idle -> "Not recording"
    is RecordingState.Pending -> "Starting…"
    is RecordingState.On -> "${if (state.mode == RecordingState.Mode.FILE) "Recording" else "Live"} (${state.sessionId})"  // smart cast
    is RecordingState.Failed -> "Failed: ${state.reason}"
}

val on = RecordingState.On("s1", RecordingState.Mode.STREAM, System.currentTimeMillis())
val restarted = on.copy(sessionId = "s2")                           // immutable update
val (id, mode) = on                                                 // destructuring via componentN()
```

### `==` vs `===` in Kotlin

- **`==`** is **structural equality**: it calls `equals()` (null-safe: `a == b` translates to `a?.equals(b) ?: (b === null)`).
- **`===`** is **referential equality** (same instance).
- This is the opposite of Java's habit (`==` for references), and avoids Java's `Integer` cache traps.

### Classes: constructors, inheritance, visibility and interfaces

- **Primary constructor** in the header (`class Bridge(val region: String, var stress: Double)`), plus `init` blocks and secondary constructors (`constructor(...) : this(...)`).
- **Final by default.** Mark classes and members `open` to allow overriding, and use `override`. `abstract` classes. Interfaces can have default implementations and properties (without backing state).
- **Visibility:** `public` (default), `private`, `protected`, **`internal`** (visible within the same **module**, useful for library APIs).
- **Nested vs inner:** a nested class is static by default (no outer reference). `inner class` holds a reference to the outer instance.
- **Properties** with custom getters and setters, and backing fields (`field`).

## Functions

### Explain extension functions and their limits 🔥

**Extension functions** add functions to existing types **without inheritance or modification**: `fun String.isMeetingCode(): Boolean = matches(Regex("^[a-z]{3}-[a-z]{4}-[a-z]{3}$"))`. Extension properties also exist.

- They're **resolved statically** (compile-time dispatch on the **declared type**), not virtually. If you call an extension on a variable declared as the base type, you get the base type's extension, even if the object is a subclass.
- **Member functions win** over extensions with the same signature.
- They **can't access private members** of the class.
- Under the hood they're **static methods** taking the receiver as the first parameter (`StringExtKt.isMeetingCode(str)`).
- They're great for **readable DSLs and utilities** (Android KTX, Ktor). Don't scatter them everywhere; keep them discoverable.

### Explain the scope functions: `let`, `run`, `with`, `apply`, `also` 🔥

| Function | Object reference | Returns | Typical use |
|---|---|---|---|
| **`let`** | `it` | **Lambda result** | Null checks (`x?.let { … }`), transforming a value, limiting scope |
| **`run`** | `this` | Lambda result | Configure and compute a result; `run { }` without a receiver groups statements |
| **`with(obj)`** | `this` | Lambda result | Several calls on an object without repeating its name (not an extension) |
| **`apply`** | `this` | **The object itself** | **Object configuration/builders**: `Request().apply { url = …; method = … }` |
| **`also`** | `it` | **The object itself** | Side effects such as logging or validation in a chain, without changing the value |

```kotlin
val client = OkHttpClient.Builder().apply {                 // apply: configure, returns the builder
    connectTimeout(5, TimeUnit.SECONDS)
    addInterceptor(authInterceptor)
}.build()

val bridge = selectBridge(region)
    ?.also { log.info("Selected bridge ${it.id} stress=${it.stress}") }   // side effect, returns the bridge
    ?: error("No bridge available in $region")

val summary = with(conference) {                            // with: many calls on one object
    "Room $roomName: ${participants.size} participants, recording=${isRecording()}"
}

val port = config.getString("jvb.port")?.let { it.toIntOrNull() } ?: 10000  // let: transform nullable
```

### What are higher-order functions, `inline`, `crossinline`, `noinline` and `reified`? 🔥

- **Higher-order functions** take or return functions: `fun retry(times: Int, block: () -> T): T`. Function types look like `(Int) -> String`, and there are lambdas with receivers: `StringBuilder.() -> Unit`.
- **`inline` functions:** the compiler **copies the function body and the lambda bodies into the call site**:
  - no lambda **object allocation** and no virtual call, which matters for hot paths and the collection operators (`map`, `filter` are inline)
  - lambdas can use **non-local returns** (`return` from the enclosing function inside `forEach`)
- **`noinline`:** a lambda parameter that shouldn't be inlined, e.g. because it's stored or passed elsewhere.
- **`crossinline`:** the lambda is inlined but **can't do non-local returns**. Needed when it's called from another context such as a nested lambda or a `Runnable`.
- **`reified` type parameters** (only in `inline` functions): the type is **available at runtime**, avoiding erasure. You can write `inline fun <reified T> Gson.fromJson(json: String): T = fromJson(json, T::class.java)` and `if (x is T)`.

```kotlin
inline fun <T> measure(label: String, block: () -> T): T {
    val start = System.nanoTime()
    try {
        return block()                                        // inlined: no allocation
    } finally {
        log.debug("$label took ${(System.nanoTime() - start) / 1_000_000} ms")
    }
}

inline fun <reified T : Any> Map<String, Any?>.getTyped(key: String): T? = this[key] as? T   // T known at runtime

val bridges = measure("select bridges") { allBridges.filter { it.isHealthy } }
val maxVisitors: Int? = settings.getTyped("maxVisitors")
```

### Explain delegation: `by` for classes and properties

- **Class delegation:** `class LoggingList<T>(private val inner: MutableList<T>) : MutableList<T> by inner { override fun add(element: T) = inner.add(element).also { log("added $element") } }`. The compiler generates forwarding methods. It's **composition over inheritance** with no boilerplate, like the Decorator pattern.
- **Property delegation:** `val x by delegate`. The delegate provides `getValue`/`setValue`. Built-in delegates:
  - **`lazy`**
  - **`Delegates.observable`** (react to changes)
  - **`Delegates.vetoable`** (reject changes)
  - **`map`** delegation (`val name: String by map`, for JSON-like configs)
  
  Android uses `by viewModels()`; Compose uses `by remember { mutableStateOf(…) }`.

```kotlin
var participantCount: Int by Delegates.observable(0) { _, old, new ->
    if (new > MAX_MAIN_ROOM && old <= MAX_MAIN_ROOM) enableVisitorMode()   // react to threshold crossing
}
```

### Explain generics variance: `out`, `in`, star projection 🔥

- **`out T`** (covariant, a producer): `interface Source<out T> { fun next(): T }`. A `Source<Dog>` **is a** `Source<Animal>`. `T` appears only in **out** positions (return types). Kotlin's `List<out E>` is covariant, so a `List<Dog>` can be passed where a `List<Animal>` is expected.
- **`in T`** (contravariant, a consumer): `interface Comparator<in T> { fun compare(a: T, b: T): Int }`. A `Comparator<Animal>` can be used as a `Comparator<Dog>`.
- **Declaration-site variance** (Kotlin) vs Java's **use-site wildcards** (`? extends`, `? super`): Kotlin declares it once on the type. **Use-site projections** still exist: `fun copy(from: Array<out Any>, to: Array<Any>)`.
- **Star projection `Foo<*>`:** unknown type argument, safe to read as the upper bound, can't write.
- Mapping to the same idea elsewhere: **PECS in Java**, and TS's `in`/`out` variance annotations.

### What are the key collection operations, and sequences vs collections? 🔥

- **Read-only interfaces** (`List`, `Set`, `Map`) vs **mutable** ones (`MutableList`…). "Read-only" ≠ immutable: the underlying list might be mutable elsewhere. Use **`toList()`** copies, or kotlinx.collections.immutable.
- **Common operators:**
  - `map`, `filter`, `flatMap`
  - **`groupBy`**, **`associateBy`**, `associateWith`
  - **`partition`**, **`fold`**/`reduce`, `sumOf`, `maxByOrNull`
  - **`chunked`**, **`windowed`**, `zip`, `distinctBy`, `sortedWith(compareBy(...).thenBy(...))`, `firstOrNull`, `any`/`all`/`none`
- **Collections are eager:** each operator creates an intermediate list.
- **Sequences** (`asSequence()`) are **lazy**: elements flow through the whole chain one at a time, with no intermediate collections, and short-circuit with `first`/`take`. They're like Java Streams or JS iterator helpers. Use them for **large data or long chains**. For small lists, plain collections are often faster.

```kotlin
data class Load(val id: String, val vendor: String, val status: String, val tons: Double)

val tonsByVendor: Map<String, Double> = loads
    .filter { it.status != "cancelled" }
    .groupBy { it.vendor }
    .mapValues { (_, list) -> list.sumOf { it.tons } }

val (heavy, light) = loads.partition { it.tons > 10 }
val byId: Map<String, Load> = loads.associateBy { it.id }

val firstThreeDelayed = loads.asSequence()        // lazy: stops after finding 3
    .filter { isDelayed(it) }                     // isDelayed called only as many times as needed
    .map { it.id }
    .take(3)
    .toList()
```

## Coroutines & Flow

### What are coroutines and how do they differ from threads? 🔥

- A **coroutine** is a **suspendable computation**. It can **pause** at a `suspend` point (waiting for I/O or a delay) **without blocking the thread**, and resume later, possibly on another thread. Thousands or millions are cheap, because they're objects with state machines rather than OS threads.
- **`suspend` functions** compile into a **state machine** with a hidden **`Continuation`** parameter (continuation-passing style). That's conceptually the same as JS `async`/`await` compiling to generators and promises.
- **Threads** are OS-scheduled, heavyweight (about 1 MB stacks), and expensive to block. **Java virtual threads** make blocking cheap at the JVM level. Coroutines achieve that at the **language level**, plus **structured concurrency**, cancellation and Flow.
- **Dispatchers** decide **where** coroutines run:
  - `Dispatchers.Default` (CPU-bound; pool size about the number of cores)
  - **`Dispatchers.IO`** (blocking I/O; a larger elastic pool)
  - **`Dispatchers.Main`** (the UI thread on Android/desktop)
  - `Unconfined` (rare)
  
  Switch with **`withContext(Dispatchers.IO) { … }`**.

### What is structured concurrency? 🔥

**Structured concurrency:** every coroutine runs inside a **`CoroutineScope`**, and **a parent waits for and owns its children**:

- The scope **doesn't complete until all children complete**, so there are no leaked background tasks.
- **Cancelling the parent cancels all children** (when the user leaves a screen or a conference ends).
- **A child failure cancels the parent and its siblings** by default (with a regular `Job`), and the exception propagates.
- **`SupervisorJob` / `supervisorScope`:** a child failure **doesn't** cancel siblings. Use it for independent tasks such as one Jibri session failing without killing the others.
- **Builders:**
  - **`launch`** is fire-and-forget and returns a `Job`. Exceptions propagate to the parent or a handler.
  - **`async`** returns a `Deferred<T>`; call `await()` (like a Promise).
  - `coroutineScope { }` suspends until all children finish.
  - `runBlocking` blocks the current thread (only for `main` or tests).
- **Android:** `viewModelScope` and `lifecycleScope` cancel automatically with the lifecycle.

```kotlin
// Start recording + streaming in parallel; if either fails, the other is cancelled (structured concurrency)
suspend fun startRecordingAndStream(room: String): Pair<Session, Session> = coroutineScope {
    val recording = async(Dispatchers.IO) { jibriPool.start(room, Mode.FILE) }
    val stream = async(Dispatchers.IO) { jibriPool.start(room, Mode.STREAM) }
    recording.await() to stream.await()                     // like Promise.all; a failure cancels the sibling
}

// Independent sessions: one failing must not cancel the others
suspend fun startAll(targets: List<StreamTarget>) = supervisorScope {
    targets.map { target ->
        async {
            runCatching { jibriPool.start(target) }
                .onFailure { log.warn("Stream to ${target.name} failed", it) }
        }
    }.awaitAll()
}
```

### How does coroutine cancellation work? 🔥

- **Cancellation is cooperative.** `job.cancel()` sets the job to *cancelling*. The coroutine actually stops at the next **suspension point** that checks for cancellation (`delay`, `yield`, `withContext`, most kotlinx suspending functions throw **`CancellationException`**).
- **CPU-bound loops must check:** `ensureActive()`, `isActive` or `yield()`.
- **Cleanup:** use `try { … } finally { … }`. To **suspend inside `finally`** (closing a connection gracefully), wrap the code in `withContext(NonCancellable) { … }`.
- **Never swallow `CancellationException`.** A broad `catch (e: Exception)` around suspending calls breaks cancellation. Rethrow it, or catch more specific exceptions.
- **Timeouts:** `withTimeout(5.seconds) { … }` throws `TimeoutCancellationException`. `withTimeoutOrNull` returns null instead.
- **JS analogy:** `AbortController` signals, but built into the runtime and automatically propagated through the scope tree.

### How are exceptions handled in coroutines?

- **`launch`:** an uncaught exception **propagates to the parent** (cancelling the scope). At the root, it goes to a **`CoroutineExceptionHandler`** installed in the scope context (or the thread's default handler).
- **`async`:** the exception is **held in the `Deferred`** and **rethrown at `await()`**. Even so, with a regular parent Job it **also cancels the parent** right away. Use `supervisorScope` if siblings should survive.
- **Patterns:**
  - `runCatching { }` or try/catch **inside** the coroutine for recoverable errors
  - **supervisor scopes** for independent children
  - a root `CoroutineExceptionHandler` for logging
  - always rethrow `CancellationException`

### What is Flow? Explain StateFlow vs SharedFlow vs Channel 🔥

**`Flow<T>`** is a **cold asynchronous stream**:

- Nothing runs until it's **collected** (`collect` is a suspend function). Each collector gets its **own execution**, like a cold Observable.
- **Operators:** `map`, `filter`, `debounce`, `distinctUntilChanged`, **`flatMapLatest`** (like RxJS `switchMap`), `combine`, `zip`, `catch`, `retry`, `onEach`, `buffer`, `conflate`.
- **`flowOn(Dispatchers.IO)`** changes the **upstream** context. **Backpressure** is natural, because emission suspends until the collector is ready.

**Hot streams:**

| | `StateFlow<T>` | `SharedFlow<T>` | `Channel<T>` |
|---|---|---|---|
| Nature | Hot, **always has a current value** (`.value`), conflated, `distinctUntilChanged` built in | Hot, **configurable replay and buffer**, no required initial value | Hot, **point-to-point queue**: each element received by **one** consumer |
| Use | **UI state** (like `BehaviorSubject` or a signal) | **Events** broadcast to many collectors (participant joined, toasts) | Work queues, one-time events to a single consumer, producer–consumer pipelines |
| Late subscribers | Get the latest value | Get the `replay` cache (0 by default) | — |

- **`stateIn` / `shareIn`** convert a cold flow into a hot one within a scope (`SharingStarted.WhileSubscribed(5000)`).

```kotlin
class ParticipantsViewModel(private val repo: ConferenceRepository) : ViewModel() {
    private val query = MutableStateFlow("")

    val visibleParticipants: StateFlow<List<Participant>> =
        combine(repo.participants, query.debounce(250)) { list, q ->      // recompute when either changes
            list.filter { it.name.contains(q, ignoreCase = true) }
        }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<UiEvent> = _events                           // one-shot UI events (toasts)

    fun onQueryChanged(q: String) { query.value = q }
    fun onKick(id: String) = viewModelScope.launch {
        runCatching { repo.kick(id) }
            .onSuccess { _events.emit(UiEvent.Toast("Participant removed")) }
            .onFailure { _events.emit(UiEvent.Toast("Couldn't remove participant")) }
    }
}
```

### Kotlin coroutines vs JavaScript async/await vs RxJS: how do they compare?

| Concept | Kotlin | JavaScript/TypeScript |
|---|---|---|
| Async function | `suspend fun` | `async function` |
| Await one result | Call it directly (sequential by default), or `async { }.await()` | `await promise` |
| Parallel | `coroutineScope { async {…}; async {…} }` + `awaitAll()` | `Promise.all([...])` |
| Cancellation | Built-in, cooperative, **structured** (parent cancels children) | Manual with `AbortController` |
| Stream of values | `Flow` (cold), `StateFlow`/`SharedFlow` (hot) | Async iterators, RxJS Observables (cold/hot), signals |
| switchMap | `flatMapLatest`, `collectLatest` | RxJS `switchMap` |
| Thread control | Dispatchers / `withContext` | Single thread + Web Workers |

**Key difference:** in Kotlin, calling a suspend function **suspends sequentially by default**, so concurrency is **explicit** (`async`/`launch`). In JS, calling an async function **starts it immediately** and returns a promise, so you must `await` to sequence.

## Interop & platform

### How does Kotlin interoperate with Java? What annotations help? 🔥

- Kotlin calls Java directly. Java getters and setters appear as **properties**, and **SAM conversions** let you pass lambdas to Java functional interfaces.
- Java sees Kotlin through the generated bytecode. Annotations improve the Java-side API:
  - **`@JvmStatic`:** a companion or object member becomes a real static method.
  - **`@JvmOverloads`:** generates overloads for default parameters (Java has no default arguments).
  - **`@JvmField`:** expose a property as a public field without getters and setters.
  - **`@JvmName`:** rename a generated class or method (e.g. avoid signature clashes after erasure).
  - **`@Throws(IOException::class)`:** declares checked exceptions for Java callers. Kotlin has no checked exceptions.
- **Nullability:** Java types are **platform types**. Annotate Java APIs (JSpecify, `@Nullable`) for safe Kotlin use.
- **Jitsi example:** Jicofo is largely Kotlin but uses Java libraries (Smack for XMPP, ice4j, Jetty), which is a good real-world example of a mixed codebase.

### What do you know about Kotlin on Android and Kotlin Multiplatform?

- **Android:**
  - Kotlin-first since 2019
  - **Jetpack Compose** (a declarative UI with ideas similar to React: composable functions, state with `remember`/`mutableStateOf`, recomposition ≈ re-render, `LaunchedEffect` ≈ `useEffect`)
  - **ViewModel + StateFlow** for UI state
  - **Hilt** for DI
  - **Room** for SQLite
  - coroutines everywhere
- **React Native native modules:** written in **Kotlin** on Android (TurboModules/Expo Modules). For example, audio routing or a foreground service for calls in a conferencing app.
- **Kotlin Multiplatform (KMP):** share **business logic** (networking, models, validation) across Android, iOS, desktop and web, with native UI or **Compose Multiplatform**. `expect`/`actual` declarations provide platform-specific implementations.

### What are some idiomatic Kotlin features every interviewer likes to see?

- **`when` as an expression** with ranges and smart casts: `when (code) { in 200..299 -> "ok"; 401, 403 -> "auth"; else -> "error" }`.
- **String templates** (`"Room $room has ${list.size}"`), raw strings (`"""…"""`), `trimIndent()`.
- **Destructuring** (`for ((key, value) in map)`).
- **Default and named arguments** instead of builders or overloads.
- **`require`/`check`/`error`** for preconditions (`require(port in 1..65535) { "invalid port $port" }`).
- **`use { }`** for auto-closing resources (try-with-resources).
- **`buildList { }` / `buildString { }`**, `takeIf`/`takeUnless`.
- **Type-safe builders and DSLs** (lambdas with receivers), as in Ktor routing, Gradle Kotlin DSL and HTML builders.
- **Immutability by default:** `val`, read-only collections, data classes with `copy`.
