# Java & Spring Boot

Java is on your resume, and the Jitsi components you work with (Jicofo, the Videobridge, Jibri) are **JVM services written in Java and Kotlin**. Full-stack interviews will test **core Java, collections internals, the JVM and garbage collection, concurrency (including virtual threads), modern Java features, and Spring Boot/JPA**. Answer at the depth you can genuinely defend, and be honest about where your production experience is.

> Java snippets aren't runnable in the JavaScript playground. A few concepts (`String.hashCode`, `HashMap` bucket indexing) are simulated in runnable JavaScript so you can experiment with them.

## Core Java & OOP

### How does Java code run? Explain JDK, JRE, JVM and JIT 🔥

- **JDK** (Development Kit): the compiler (`javac`), tools (`jshell`, `jcmd`, `jlink`, `jfr`) and the runtime.
- **JRE** (Runtime Environment): the JVM plus core libraries. Since Java 11 it isn't shipped separately; you build custom runtimes with **`jlink`**.
- **JVM:** executes **bytecode** (`.class` files), which gives "write once, run anywhere".
  - **class loading** (bootstrap → platform → application loaders, with **parent delegation**)
  - **bytecode verification**
  - **execution**: the interpreter, plus the **JIT compiler** (HotSpot **C1** for quick compiles, **C2** for heavily optimised hot code, chained by **tiered compilation**)
  - JIT optimisations include **inlining**, **escape analysis** (allocating objects on the stack or eliminating them), loop unrolling, and deoptimisation when assumptions break
- **GraalVM** adds an alternative JIT and **native-image** (ahead-of-time compilation to native executables: fast startup, low memory). It's used for serverless and CLIs.

### Explain the four OOP pillars with Java examples 🔥

1. **Encapsulation:** hide state behind methods, enforce invariants (`private` fields, validated setters, immutable objects).
2. **Abstraction:** expose **what** an object does, not **how** (interfaces such as `RecordingStorage`).
3. **Inheritance:** `class Webinar extends Meeting` reuses behaviour. Prefer **composition over inheritance** to avoid fragile hierarchies.
4. **Polymorphism:** one interface, many implementations.
   - **runtime** (method **overriding** + dynamic dispatch)
   - **compile time** (method **overloading**)

```java
public interface RecordingStorage {                      // abstraction
    URI upload(Path file, String meetingId) throws IOException;
}

public final class S3RecordingStorage implements RecordingStorage {   // polymorphism via interface
    private final S3Client s3;                           // encapsulated dependency (composition)
    private final String bucket;
    public S3RecordingStorage(S3Client s3, String bucket) { this.s3 = s3; this.bucket = Objects.requireNonNull(bucket); }

    @Override
    public URI upload(Path file, String meetingId) throws IOException {
        String key = "recordings/%s/%s".formatted(meetingId, file.getFileName());
        s3.putObject(b -> b.bucket(bucket).key(key), file);
        return URI.create("s3://" + bucket + "/" + key);
    }
}

// The caller depends on the abstraction; swap in LocalDiskStorage for tests
RecordingStorage storage = new S3RecordingStorage(s3, "meethour-recordings");
```

### Abstract class vs interface: when do you use which?

| | Abstract class | Interface |
|---|---|---|
| Inheritance | **Single** (`extends` one class) | **Multiple** (`implements` many) |
| State | Instance fields, constructors | Only `static final` constants (no instance state) |
| Methods | Abstract and concrete, any visibility | Abstract, **`default`** (8), `static` (8), **`private`** (9) |
| Purpose | Share **code and state** among closely related classes (an "is-a" base with a template) | Define a **capability or contract** ("can-do") across unrelated classes |

**Modern guidance:** design against **interfaces**, and use `default` methods for backward-compatible evolution. Use abstract classes for **template-method** style bases with shared state. **Sealed** interfaces and classes (17) restrict who may implement them.

### Overloading vs overriding 🔥

- **Overloading** (compile-time polymorphism): same method name, **different parameter lists**, in the same class or a subclass. Resolved by the compiler from **static types**. The return type alone can't distinguish overloads.
- **Overriding** (runtime polymorphism): a subclass provides a new implementation for an inherited method with the **same signature**. Resolved at **runtime** through **dynamic dispatch** on the object's actual type.
  - Use `@Override`.
  - The return type can be **covariant** (a subtype).
  - Access can't be more restrictive.
  - It can't throw broader **checked** exceptions.
- **`static` methods are hidden, not overridden** (resolved by the static type). `private` and `final` methods can't be overridden.

### What is the `equals`/`hashCode` contract and why does it matter? 🔥

**The contract:**

1. `equals` is **reflexive, symmetric, transitive and consistent**, and `x.equals(null)` is false.
2. **If `a.equals(b)`, then `a.hashCode() == b.hashCode()`.** The reverse isn't required: collisions are allowed.

**Why it matters:** `HashMap`/`HashSet` first use `hashCode` to find the **bucket**, then `equals` to find the entry. Override `equals` without `hashCode`, and equal objects land in **different buckets**, so `set.contains(equalObject)` returns **false** and duplicates appear.

**Also:**

- **Don't mutate fields used in `hashCode`** while the object is a key in a hash-based collection; it becomes unreachable.
- **Records** generate `equals`/`hashCode`/`toString` from their components automatically.

```java
public final class ParticipantKey {
    private final String meetingId;
    private final String participantId;
    public ParticipantKey(String meetingId, String participantId) { this.meetingId = meetingId; this.participantId = participantId; }

    @Override public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof ParticipantKey other)) return false;      // pattern matching for instanceof (16)
        return meetingId.equals(other.meetingId) && participantId.equals(other.participantId);
    }
    @Override public int hashCode() { return Objects.hash(meetingId, participantId); }
}

// Or simply (Java 16+):
public record ParticipantKey(String meetingId, String participantId) {}
```

```js
// Java's String.hashCode() and HashMap bucket index, simulated in JS (32-bit int arithmetic)
function javaStringHash(s) {
  let h = 0;
  for (const ch of s) h = (Math.imul(31, h) + ch.charCodeAt(0)) | 0;   // s[0]*31^(n-1) + ... with int overflow
  return h;
}
const spread = (h) => h ^ (h >>> 16);          // HashMap.hash(): mix high bits into low bits
const bucketIndex = (key, capacity = 16) => spread(javaStringHash(key)) & (capacity - 1);  // capacity is a power of two

console.table(['hello', 'Aa', 'BB', 'meeting-42', 'polygenelubricants'].map((k) => ({
  key: k, hashCode: javaStringHash(k), bucketIn16: bucketIndex(k), bucketIn32: bucketIndex(k, 32),
})));

test('matches Java values', () => {
  expect(javaStringHash('hello')).toBe(99162322);
  expect(javaStringHash('Aa')).toBe(javaStringHash('BB'));                   // classic collision: 2112
  expect(javaStringHash('polygenelubricants')).toBe(-2147483648);           // Integer.MIN_VALUE: Math.abs(hash) is still negative!
});
```

### Why is `String` immutable? `==` vs `equals`, the string pool, and `StringBuilder` 🔥

- **Immutability:**
  - **security**: file paths, URLs and class names can't be changed after validation
  - **thread safety** without synchronisation
  - the **hashCode is cached**, so strings are great `HashMap` keys
  - it enables the **string pool** (literals are interned and shared)
- **`==`** compares **references**; **`equals`** compares **content**. `"a" == "a"` is `true` (same pooled literal). `new String("a") == "a"` is `false`. `"a".equals(new String("a"))` is `true`. **Always use `equals`** for content (or `Objects.equals` for null safety).
- **Concatenation in loops** creates many temporary strings. Use **`StringBuilder`** (not synchronised, fast) or `StringBuffer` (synchronised, legacy). Since Java 9, `+` outside loops compiles to efficient `invokedynamic` string concatenation.
- **Since Java 9, compact strings** store Latin-1 text with 1 byte per char.
- **Text blocks** (`"""`, Java 15) for multi-line strings such as JSON and SQL.

### Primitives, wrappers and the `Integer` cache trap

- **Autoboxing:** `int ↔ Integer`. `Integer.valueOf` **caches -128..127**, so `Integer a = 127, b = 127; a == b` is **true**, while for `128` it's **false** (different objects). **Never compare wrappers with `==`.**
- **Unboxing `null`** throws a `NullPointerException`: `int x = map.get("missing");`.
- Prefer primitives in hot paths and large arrays (memory, no boxing). Specialised streams (`IntStream`) avoid boxing.

### Is Java pass-by-value or pass-by-reference?

**Always pass-by-value.** For objects, the *value* passed is a **copy of the reference**. A method can **mutate** the object through the copied reference (the caller sees the changes), but **reassigning** the parameter doesn't affect the caller's variable. JavaScript behaves the same way (see the JS output puzzles).

### Checked vs unchecked exceptions, and best practices 🔥

- **Hierarchy:** `Throwable` → **`Error`** (JVM problems: `OutOfMemoryError`, `StackOverflowError`; don't catch) and **`Exception`**. `Exception` → **checked** exceptions (`IOException`, `SQLException`: they **must be caught or declared**) and **`RuntimeException`** (unchecked: `NullPointerException`, `IllegalArgumentException`, `IllegalStateException`).
- **Use checked** exceptions for recoverable conditions callers must handle. **Use unchecked** for programming errors and in most application or framework code (Spring translates exceptions to unchecked ones).
- **Best practices:**
  - **try-with-resources** for anything `AutoCloseable` (streams, JDBC connections), which handles closing and suppressed exceptions
  - don't swallow exceptions (an empty catch block)
  - **wrap with the cause** (`throw new StorageException("upload failed", e)`)
  - catch specific exceptions
  - don't use exceptions for control flow
  - in `finally`, never `return` (it masks exceptions)
  - custom exceptions with context (meeting ID, status)

```java
try (var in = Files.newInputStream(path); var out = s3Uploader.open(key)) {   // both closed automatically, in reverse order
    in.transferTo(out);
} catch (NoSuchFileException e) {
    throw new RecordingNotFoundException(meetingId, e);                      // domain exception with cause
}
```

### Explain generics, type erasure and PECS 🔥

- **Generics** give compile-time type safety (`List<String>`) and eliminate casts.
- **Type erasure:** generic type information is **removed at compile time**. At runtime, `List<String>` and `List<Integer>` are both just `List`. **Consequences:**
  - you can't do `new T()`, `T[]`, or `instanceof List<String>`
  - you can't overload on generic parameters only
  - there are **no generics over primitives** (hence `List<Integer>`; Project Valhalla aims to change this)
  - bridge methods are generated
- **Bounded types:** `<T extends Comparable<T>>`.
- **Wildcards and PECS ("Producer Extends, Consumer Super"):**
  - `List<? extends Number>` is a **producer**: you can **read** `Number`s but can't add (except `null`)
  - `List<? super Integer>` is a **consumer**: you can **add** `Integer`s, and reads give `Object`
  - example: `Collections.copy(List<? super T> dest, List<? extends T> src)`
- **Kotlin's equivalents:** `out T` / `in T` (declaration-site variance).

## Collections

### Compare the main collections and their complexities 🔥

| Collection | Implementation | get / contains | add / remove | Ordering | Notes |
|---|---|---|---|---|---|
| `ArrayList` | Resizable array | **O(1)** by index; O(n) contains | Amortised O(1) append; O(n) middle insert/remove | Insertion | Default list; cache-friendly |
| `LinkedList` | Doubly linked list | O(n) by index | O(1) at the ends | Insertion | Rarely better than `ArrayList`/`ArrayDeque` in practice |
| `ArrayDeque` | Circular array | — | O(1) both ends | — | **Use for stacks and queues** (not `Stack`/`LinkedList`) |
| `HashMap` / `HashSet` | Hash table (+ trees for big buckets) | **O(1)** average, O(log n) worst (treeified) | O(1) average | **None** | Allows one null key |
| `LinkedHashMap` | Hash table + linked list | O(1) | O(1) | **Insertion or access order** | `removeEldestEntry` makes an **LRU cache** |
| `TreeMap` / `TreeSet` | **Red-black tree** | O(log n) | O(log n) | **Sorted** (natural or `Comparator`) | `floorKey`, `ceilingKey`, `subMap` range queries |
| `PriorityQueue` | Binary heap | O(1) peek | O(log n) offer/poll | Heap order | Top-K, scheduling |
| `ConcurrentHashMap` | Hash table, CAS + per-bin locks | O(1) | O(1) | None | Thread-safe, **no null keys or values** |

**Also:**

- **Immutable collections:** `List.of`, `Map.of` (Java 9) throw on modification and reject nulls. `Collections.unmodifiableList` is a **read-only view** (it reflects changes to the backing list).
- **Sequenced collections** (Java 21): `getFirst()`, `getLast()`, `reversed()` on ordered collections.

### How does `HashMap` work internally? 🔥

1. **Structure:** an array of **buckets** (`Node<K,V>[] table`). The capacity is always a **power of two** (default 16).
2. **Hashing:** `hash = key.hashCode() ^ (h >>> 16)` mixes the high bits into the low bits. **Index = `hash & (capacity - 1)`**, a fast modulo.
3. **Collisions:** entries in the same bucket form a **linked list**. **Since Java 8**, when a bucket reaches **8 entries** (and the table capacity is at least 64), it's converted to a **red-black tree** (treeified), so worst-case lookup becomes **O(log n)** instead of O(n). This mitigates hash-collision DoS. It converts back below 6.
4. **`get`:** compute the index, walk the bucket comparing **hash first, then `equals`**.
5. **Resize:** when `size > capacity × loadFactor` (**0.75** by default), the table **doubles**. Entries are redistributed, and because the capacity is a power of two, each entry either **stays** at index `i` or moves to `i + oldCapacity`. Resizing is O(n), so pre-size (`new HashMap<>(expected / 0.75f + 1)`) when you know the size.
6. **Not thread-safe:** concurrent modification can corrupt it or lose updates (in Java 7 a resize race could even create an infinite loop). Use `ConcurrentHashMap`.
7. **Iteration is fail-fast:** structural modification during iteration throws `ConcurrentModificationException` (detected through `modCount`), except via `iterator.remove()`.

### How does `ConcurrentHashMap` achieve thread safety?

- **Java 7:** **segments** (lock striping, 16 segments by default).
- **Java 8+:**
  - **lock-free reads** (volatile reads)
  - **CAS** to insert into empty bins
  - **`synchronized` on the first node of a bin** for updates to non-empty bins, so contention is per bucket
  - **cooperative resizing** by multiple threads
  - treeified bins as in `HashMap`
- **Atomic compound operations:** `computeIfAbsent`, `merge`, `compute`, `putIfAbsent`. Use them instead of check-then-act (`if (!map.containsKey(k)) map.put(k, v)` is a race).
- **No null keys or values.** `null` from `get` would be ambiguous: absent, or present with a null value.
- **Iterators are weakly consistent** (no `ConcurrentModificationException`). `size()` is an estimate under concurrency; use `mappingCount()`.

```java
ConcurrentHashMap<String, LongAdder> joinsPerMeeting = new ConcurrentHashMap<>();
joinsPerMeeting.computeIfAbsent(meetingId, k -> new LongAdder()).increment();   // atomic, low contention
```

### Comparable vs Comparator; implement an LRU cache with `LinkedHashMap`

- **`Comparable<T>`:** the **natural ordering**, implemented by the class itself (`compareTo`). One ordering only.
- **`Comparator<T>`:** an **external** ordering. You can have many, composed fluently: `Comparator.comparing(Participant::role).thenComparing(Participant::joinedAt).reversed()`.
- Keep comparisons **consistent with equals** for sorted sets and maps (a `compareTo` of 0 means "duplicate" in a `TreeSet`).

```java
public class LruCache<K, V> extends LinkedHashMap<K, V> {
    private final int capacity;
    public LruCache(int capacity) {
        super(capacity, 0.75f, true);          // accessOrder = true: get() moves the entry to the end
        this.capacity = capacity;
    }
    @Override protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > capacity;              // evict the least-recently used entry
    }
}
// Not thread-safe: wrap with Collections.synchronizedMap or use Caffeine for production caches.
```

## Modern Java

### Explain the Streams API and common collectors 🔥

**Streams** are declarative pipelines over data:

- a **source** (collection, array, `Stream.of`, `Files.lines`)
- **intermediate operations**, which are **lazy**: `filter`, `map`, `flatMap`, `distinct`, `sorted`, `limit`, `peek`
- a **terminal operation**, which triggers execution: `collect`, `forEach`, `reduce`, `count`, `anyMatch`, `findFirst`, `toList()` (Java 16)

**Rules:**

- Streams are **single-use**.
- Don't mutate shared state inside lambdas.
- **`parallelStream()`** only for large, CPU-bound, independent work. It uses the common ForkJoinPool, which is bad for blocking I/O and has overhead for small data.

```java
record Load(String id, String vendor, String status, double weightTons) {}

Map<String, Double> tonsByVendor = loads.stream()
    .filter(l -> !"cancelled".equals(l.status()))
    .collect(Collectors.groupingBy(Load::vendor, TreeMap::new, Collectors.summingDouble(Load::weightTons)));

Map<String, List<String>> idsByStatus = loads.stream()
    .collect(Collectors.groupingBy(Load::status, Collectors.mapping(Load::id, Collectors.toList())));

Optional<Load> heaviest = loads.stream().max(Comparator.comparingDouble(Load::weightTons));

String csv = loads.stream().map(Load::id).sorted().collect(Collectors.joining(","));

Map<Boolean, Long> overTen = loads.stream().collect(Collectors.partitioningBy(l -> l.weightTons() > 10, Collectors.counting()));
```

### How should `Optional` be used (and not used)?

- **Use it for return types** that may be absent: `Optional<User> findById(id)`. It forces callers to handle absence explicitly: `map`, `flatMap`, `filter`, `orElse`, `orElseGet` (lazy), `orElseThrow`, `ifPresentOrElse`.
- **Don't** use it for fields, method parameters or collections (return an empty collection instead), and don't call `get()` without checking (prefer `orElseThrow()`).
- **Prefer `orElseGet(() -> expensive())`** over `orElse(expensive())`, which **always evaluates** its argument.

### What are the key features of Java 11, 17, 21 and 25 (LTS releases)? 🔥

| Version | Features to mention |
|---|---|
| **8** (2014) | **Lambdas, Streams, Optional**, `java.time`, default methods, `CompletableFuture` |
| **11** (LTS) | `var` in lambdas, the **HTTP Client** (`java.net.http`), `String` methods (`isBlank`, `lines`, `strip`, `repeat`), running single-file sources (`java App.java`) |
| **17** (LTS) | **Records** (16), **sealed classes**, **pattern matching for `instanceof`** (16), **text blocks** (15), **switch expressions** (14), helpful NullPointerException messages, strong encapsulation of JDK internals |
| **21** (LTS) | **Virtual threads**, **pattern matching for `switch`** and **record patterns**, **sequenced collections**, generational ZGC |
| **25** (LTS, Sept 2025) | **Scoped values** (final), **flexible constructor bodies** (statements before `super(...)`), **module import declarations**, **compact source files and instance `main` methods** (simpler "hello world"), compact object headers (production), and continued work on structured concurrency (preview) |

```java
// Sealed hierarchy + records + pattern matching switch (Java 21): exhaustive, no default needed
sealed interface RecordingEvent permits Started, Failed, Stopped {}
record Started(String sessionId, String mode) implements RecordingEvent {}
record Failed(String sessionId, String reason) implements RecordingEvent {}
record Stopped(String sessionId, Duration duration) implements RecordingEvent {}

String describe(RecordingEvent e) {
    return switch (e) {
        case Started(var id, var mode) -> "Session %s started (%s)".formatted(id, mode);
        case Failed f when f.reason().contains("stream key") -> "Check your RTMP stream key";
        case Failed(var id, var reason) -> "Session %s failed: %s".formatted(id, reason);
        case Stopped(var id, var d) -> "Session %s stopped after %d min".formatted(id, d.toMinutes());
    };
}
```

This mirrors the TypeScript discriminated-union pattern (and Kotlin's `sealed class` + `when`). It's a great cross-language talking point.

## JVM memory & garbage collection

### Describe the JVM memory areas 🔥

- **Heap** (shared by all threads; all objects and arrays). Generational:
  - **Young generation:** **Eden** plus two **Survivor** spaces. New objects are allocated in Eden (fast bump-pointer allocation in thread-local buffers, TLABs).
  - **Old (tenured) generation:** objects that survived several young collections.
- **Metaspace** (native memory, **replaced PermGen in Java 8**): class metadata. It grows dynamically; cap it with `-XX:MaxMetaspaceSize`. Leaks here come from class-loader leaks (redeploys, dynamic proxies).
- **Thread stacks** (one per thread): frames with local variables and partial results; primitives and references live here. Too deep a recursion → `StackOverflowError`. Size set by `-Xss`.
- **PC register** and **native method stack** per thread. **Code cache** for JIT-compiled code.
- **Direct (off-heap) memory:** `ByteBuffer.allocateDirect`, used by Netty and NIO (the JVB uses off-heap buffers for media packets).

### How does garbage collection work? Compare G1, ZGC and others 🔥

- **Reachability:** objects reachable from **GC roots** (thread stacks, static fields, JNI references) are live; everything else is garbage. Cycles are fine.
- **Generational hypothesis:** most objects die young. **Minor GC** (young generation) is frequent and cheap: copy the survivors and age them. **Major/full GC** (old generation, or everything) is expensive.
- **Phases:** mark (find live objects), sweep or **compact/copy** (reclaim and defragment). **Stop-the-world** pauses vs **concurrent** work.

| Collector | Characteristics | Use |
|---|---|---|
| Serial | Single-threaded, STW | Tiny heaps, small containers |
| Parallel | Multi-threaded STW, maximises **throughput** | Batch jobs |
| **G1** (**default since Java 9**) | Region-based heap, incremental mixed collections, **pause-time goal** (`-XX:MaxGCPauseMillis=200`) | General-purpose servers |
| **ZGC** (**generational** option in 21, default in 23, generational-only since 24) | **Concurrent** compaction with coloured pointers / load barriers; **sub-millisecond pauses** independent of heap size (up to multi-TB) | Latency-sensitive services (real-time, trading, large heaps) |
| Shenandoah | Concurrent compaction (Brooks/load barriers), low pause | Low latency (Red Hat builds) |

**Tuning basics:**

- `-Xms` = `-Xmx` (or container-aware `-XX:MaxRAMPercentage=75`)
- choose the collector by goal (throughput vs latency)
- **GC logs** (`-Xlog:gc*`), **JFR** (Java Flight Recorder) plus JMC for profiling

For a media server like the **JVB**, low-pause GC matters: long pauses become audio and video glitches.

### What causes memory leaks in Java and how do you find them? 🔥

**Causes:**

- **static collections** that only grow (caches without eviction)
- **listeners and callbacks** never unregistered
- **`ThreadLocal`s in thread pools** never removed (threads live forever, and so do the values)
- unclosed resources (streams, connections)
- **class-loader leaks** on redeploys
- inner classes holding outer references
- interned strings or caches keyed by mutable objects
- off-heap buffers not released

**Symptoms:** heap usage grows after each full GC, GC runs more and more often, and eventually **`OutOfMemoryError`**. Kinds of OOM:

- `Java heap space`
- `GC overhead limit exceeded`
- `Metaspace`
- `Direct buffer memory`
- `unable to create native thread`

**Tools:**

- **heap dumps** (`-XX:+HeapDumpOnOutOfMemoryError`, `jcmd <pid> GC.heap_dump`)
- **Eclipse MAT** (dominator tree, leak suspects)
- JFR allocation profiling
- `jcmd GC.class_histogram`, VisualVM

## Concurrency

### `synchronized` vs `volatile` vs atomics: explain the Java Memory Model basics 🔥

- **The Java Memory Model (JMM)** defines when writes by one thread become **visible** to another. Without synchronisation, threads may see **stale values** (CPU caches, compiler reordering).
- **Happens-before** relationships guarantee visibility and ordering:
  - unlocking a monitor happens-before a later lock of the same monitor
  - a **volatile write** happens-before subsequent reads of that variable
  - `Thread.start()` and `join()`
  - actions before `executor.submit` / `CompletableFuture` completion
- **`volatile`:** **visibility and ordering** for a single variable. **Not atomicity**: `count++` (read-modify-write) is still a race. Good for flags (`volatile boolean running`) and safe publication.
- **`synchronized`:** **mutual exclusion + visibility**. A reentrant intrinsic lock on an object (or the class for static methods).
- **Atomics** (`AtomicInteger`, `AtomicReference`, **`LongAdder`** for hot counters): **lock-free CAS** operations (`incrementAndGet`, `compareAndSet`, `updateAndGet`).
- **Locks** (`ReentrantLock`, `ReadWriteLock`, `StampedLock`): `tryLock` with a timeout, fairness, multiple `Condition`s, interruptible locking.

### What is a deadlock and how do you prevent it? 🔥

A **deadlock** needs all four **Coffman conditions**:

1. mutual exclusion
2. **hold and wait**
3. no preemption
4. **circular wait**

Example: thread 1 locks A then B, while thread 2 locks B then A.

**Prevention:**

- a **global lock ordering** (always lock A before B)
- **`tryLock` with timeouts** and back-off
- hold locks for the shortest time; avoid calling external or unknown code (alien methods) while holding locks
- use higher-level concurrency utilities and immutable data

**Detection:** thread dumps (`jstack`, `jcmd Thread.print`) show "Found one Java-level deadlock". JFR helps too.

**Related problems:**

- **livelock:** threads keep reacting to each other without progress
- **starvation:** low-priority threads never get the lock, or unfair locks
- **race conditions:** check-then-act and read-modify-write without synchronisation

### ExecutorService, thread pools and CompletableFuture 🔥

- **Don't create raw threads per task.** Use **`ExecutorService`**:
  - `newFixedThreadPool(n)` for CPU-bound work (n ≈ cores)
  - scheduled executors
  - **`ThreadPoolExecutor`** with explicit core and max size, a **bounded queue**, and a **rejection policy** (`CallerRunsPolicy` for backpressure)
- **`Executors.newCachedThreadPool`** and unbounded queues can blow up under load (unbounded threads or memory).
- **Always shut down** executors (`shutdown()` + `awaitTermination`), or use **try-with-resources on `ExecutorService`** (Java 19+).
- **`CompletableFuture`** composes async work:
  - `supplyAsync`, `thenApply` (map), **`thenCompose`** (flatMap), **`thenCombine`** (zip two), **`allOf`/`anyOf`**
  - `exceptionally`/`handle`/`whenComplete` for errors
  - `orTimeout`/`completeOnTimeout` (9+)
  - **Pass your own executor** for blocking I/O. The default `ForkJoinPool.commonPool()` is meant for CPU-bound work.

```java
ExecutorService io = Executors.newFixedThreadPool(16);

CompletableFuture<Meeting> meeting = CompletableFuture.supplyAsync(() -> meetingApi.get(id), io);
CompletableFuture<List<Recording>> recordings = CompletableFuture.supplyAsync(() -> recordingApi.list(id), io);

MeetingView view = meeting
    .thenCombine(recordings, MeetingView::new)                       // like Promise.all for two
    .orTimeout(2, TimeUnit.SECONDS)
    .exceptionally(ex -> MeetingView.unavailable(id, ex))
    .join();
```

### What are virtual threads (Java 21) and when should you use them? 🔥

- **Virtual threads** are **lightweight threads managed by the JVM**, not one-to-one with OS threads. Millions can exist.
- When a virtual thread **blocks** on I/O (socket read, JDBC call, `Thread.sleep`), the JVM **unmounts** it from its **carrier thread** (a small ForkJoinPool of platform threads) and runs other virtual threads. It's remounted when the I/O completes.
- **Why it matters:** you get the **simple blocking, thread-per-request style** with the **scalability of async/reactive code**, without callback or reactive complexity. Ideal for **I/O-bound** servers (REST APIs calling databases and other services).
- **Usage:** `Executors.newVirtualThreadPerTaskExecutor()`, `Thread.ofVirtual().start(...)`, Spring Boot `spring.threads.virtual.enabled=true` (3.2+).
- **Caveats:**
  - **Don't pool** virtual threads; create one per task.
  - They **don't speed up CPU-bound** work.
  - Avoid **pinning**: before Java 24, blocking inside `synchronized` pinned the carrier (JEP 491 fixed this in 24). Native calls still pin.
  - **Limit concurrency to downstream resources** with semaphores or connection pools; the DB doesn't scale to a million connections.
  - `ThreadLocal`s get expensive at that scale. Prefer **scoped values** (final in 25).
- **The analogy for a JS developer:** like **async/await making async code look synchronous**, but at the runtime level, so even legacy blocking libraries benefit.

### Producer–consumer and other concurrency utilities

- **`BlockingQueue`** (`ArrayBlockingQueue` bounded, `LinkedBlockingQueue`): `put` blocks when full and `take` blocks when empty. That's classic producer–consumer with natural **backpressure**, e.g. recording-finalize jobs feeding uploader threads.
- **`CountDownLatch`:** wait for N events (one-shot), e.g. wait for all services to start.
- **`CyclicBarrier`:** N threads wait for each other repeatedly. **`Phaser`** is a flexible version.
- **`Semaphore`:** limit concurrent access to a resource (max 10 concurrent Jibri start requests).
- **`CopyOnWriteArrayList`:** read-heavy lists of listeners; writes copy the array.
- **`ConcurrentLinkedQueue`:** a lock-free queue.

## Spring Boot & JPA

### Explain IoC/DI in Spring and the bean lifecycle 🔥

- **Inversion of Control:** the **Spring container** (`ApplicationContext`) creates and wires objects (**beans**) instead of your code calling `new`. **Dependency Injection** supplies a bean's dependencies.
- **Prefer constructor injection** (required dependencies, immutable `final` fields, easy to test, fails fast). Field injection (`@Autowired` on fields) is discouraged.
- **Declaring beans:**
  - **stereotypes** for component scanning: `@Component`, `@Service`, `@Repository` (adds exception translation), `@Controller`/`@RestController`
  - **`@Configuration` classes with `@Bean` methods** for third-party objects
- **Scopes:** **singleton** (the default, one per container, so it **must be thread-safe and stateless**), prototype, request, session, application.
- **Lifecycle:**
  1. instantiate
  2. populate dependencies
  3. `*Aware` callbacks
  4. **BeanPostProcessors** (before), `@PostConstruct`
  5. BeanPostProcessors (after); **this is where AOP proxies are created**, e.g. for `@Transactional`
  6. ready
  7. `@PreDestroy` on shutdown
- **Resolving ambiguity:** `@Primary`, `@Qualifier`. Configuration comes from `@Value` or **`@ConfigurationProperties`** (type-safe, validated). Use `@Profile` and profiles for environment-specific beans.

### What does Spring Boot add over Spring Framework? 🔥

- **Auto-configuration:** `@SpringBootApplication` = `@Configuration` + `@EnableAutoConfiguration` + `@ComponentScan`. Boot registers beans **conditionally** (`@ConditionalOnClass`, `@ConditionalOnMissingBean`, `@ConditionalOnProperty`) based on the classpath and properties. Put `spring-boot-starter-data-jpa` on the classpath plus a datasource URL, and you get a configured `DataSource`, `EntityManagerFactory` and transaction manager. Your own beans override the defaults.
- **Starters:** curated dependency sets (`spring-boot-starter-web`, `-security`, `-actuator`, `-validation`).
- An **embedded server** (Tomcat/Jetty/Undertow), so it runs as an executable JAR. Good for containers.
- **Externalised configuration:** `application.yml`, profiles, env variables, a clear precedence order.
- **Actuator:** health, metrics (Micrometer → Prometheus), info, readiness and liveness probes for Kubernetes.
- **Boot 3:** **Java 17+**, the **`jakarta.*`** namespace (from `javax.*`), observability with Micrometer Tracing, GraalVM native images, virtual-thread support (3.2+). **Boot 4** (late 2025) builds on Spring Framework 7.

### Write a REST controller with validation and global error handling 🔥

```java
@RestController
@RequestMapping("/api/v1/loads")
@RequiredArgsConstructor                                      // Lombok: constructor injection
class LoadController {
    private final LoadService service;

    @GetMapping("/{id}")
    LoadDto get(@PathVariable UUID id) {
        return service.get(id);                               // throws LoadNotFoundException if missing
    }

    @GetMapping
    Page<LoadDto> list(@RequestParam(defaultValue = "in-transit") String status, Pageable pageable) {
        return service.list(status, pageable);                // ?page=0&size=20&sort=updatedAt,desc
    }

    @PostMapping
    ResponseEntity<LoadDto> create(@Valid @RequestBody CreateLoadRequest req, UriComponentsBuilder uri) {
        LoadDto created = service.create(req);
        return ResponseEntity.created(uri.path("/api/v1/loads/{id}").build(created.id())).body(created);
    }
}

record CreateLoadRequest(@NotBlank String vendorId, @Positive double weightTons, @NotNull @Future Instant pickupAt) {}

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(LoadNotFoundException.class)
    ProblemDetail notFound(LoadNotFoundException e) {
        return ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, e.getMessage());   // RFC 9457 problem+json
    }
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail invalid(MethodArgumentNotValidException e) {
        var pd = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        pd.setProperty("errors", e.getFieldErrors().stream().map(f -> Map.of("field", f.getField(), "message", f.getDefaultMessage())).toList());
        return pd;
    }
}
```

### How does `@Transactional` work, and what are its pitfalls? 🔥

- Spring wraps the bean in a **proxy** (JDK dynamic proxy or CGLIB). On calls to `@Transactional` methods, the proxy **begins a transaction**, invokes the method, then **commits**, or **rolls back** on a **`RuntimeException`/`Error`** (by default **not on checked exceptions**; use `rollbackFor`).
- **Propagation:**
  - `REQUIRED` (default: join or create)
  - `REQUIRES_NEW` (suspend the outer transaction and start a new one, e.g. for audit logs that must persist even if the outer transaction rolls back)
  - `NESTED` (savepoints), `MANDATORY`, `SUPPORTS`, `NEVER`
- **Isolation:** `READ_COMMITTED` (Postgres default), `REPEATABLE_READ`, `SERIALIZABLE`. See the databases doc.
- **Pitfalls:**
  1. **Self-invocation:** calling a `@Transactional` method from **another method in the same class** bypasses the proxy, so **no transaction** is applied.
  2. Only **public** methods are intercepted by default (newer Spring versions also support protected and package-private with CGLIB).
  3. **Checked exceptions don't roll back** by default.
  4. **Long transactions** that hold DB connections while calling external APIs. Do remote calls outside the transaction.
  5. `@Transactional(readOnly = true)` for queries (optimisations, flush mode).
  6. **Lazy loading outside the transaction** throws `LazyInitializationException`. Disable `open-in-view` and fetch what you need explicitly.

### What is the N+1 query problem in JPA/Hibernate and how do you fix it? 🔥

**N+1:** you load N parent entities with 1 query, then accessing a **lazy** association on each one triggers **N more queries**. Example: listing 100 loads and reading `load.getVendor().getName()` runs 101 queries.

**Detection:** SQL logging (`spring.jpa.show-sql`, or better, Hibernate statistics, p6spy, datasource-proxy), and query count assertions in tests.

**Fixes:**

1. **`JOIN FETCH`** in JPQL: `select l from Load l join fetch l.vendor where l.status = :s`. Careful with pagination combined with collection fetch joins.
2. **`@EntityGraph(attributePaths = {"vendor", "stops"})`** on repository methods.
3. **Batch fetching** (`@BatchSize(size = 50)` or `hibernate.default_batch_fetch_size`) loads associations in `IN (...)` batches.
4. **DTO projections** (select only the needed columns into records or interfaces). Often the best option for read APIs.
5. Keep associations **`LAZY` by default**. `@ManyToOne` is EAGER by default, so make it LAZY explicitly. Fetch per use case.

### Spring Security: how do you protect a REST API with JWTs?

- Spring Security is a **filter chain** in front of the dispatcher servlet: authentication filters → the `SecurityContext` → authorisation checks.
- **JWT resource server:** `spring-boot-starter-oauth2-resource-server` with `spring.security.oauth2.resourceserver.jwt.issuer-uri` (Entra ID, Keycloak, Cognito). It **validates signatures through JWKS**, plus `iss`/`exp` (add an audience validator). It maps scopes and roles to authorities.
- **Authorisation:**
  - URL rules in `SecurityFilterChain`: `requestMatchers("/api/admin/**").hasRole("ADMIN")`
  - **method security**: `@PreAuthorize("hasAuthority('SCOPE_recordings.write') and @meetingSecurity.isHost(#meetingId)")`
- **Stateless APIs:** disable sessions (`SessionCreationPolicy.STATELESS`). CSRF protection can be disabled **only** for pure bearer-token APIs (no cookies). Configure CORS explicitly.

### How do you test Spring Boot applications?

- **Unit tests:** JUnit 5 + **Mockito** (`@ExtendWith(MockitoExtension.class)`, `@Mock`, `@InjectMocks`, `when(...).thenReturn(...)`, `verify(...)`) for services. No Spring context, so they're fast.
- **Slice tests:**
  - **`@WebMvcTest(LoadController.class)`** with **MockMvc** (controller, validation, error handling, security) and `@MockitoBean` for dependencies
  - **`@DataJpaTest`** for repositories (an embedded DB, or better, **Testcontainers** Postgres)
- **Integration tests:** `@SpringBootTest` + **Testcontainers** (a real Postgres, Redis or Kafka in Docker) + `RestClient`/`WebTestClient`. Spring Boot 3.1+ `@ServiceConnection` wires containers automatically.
- **Assertions** with AssertJ. **Contract tests** (Spring Cloud Contract or Pact) for API consumers such as the React app.

## Design

### Explain SOLID with examples 🔥

- **S — Single Responsibility:** a class has one reason to change. `RecordingService` orchestrates; `RecordingStorage` stores; `RecordingNotifier` notifies.
- **O — Open/Closed:** open for extension, closed for modification. Add a new `StreamTarget` (YouTube, Facebook, custom RTMP) by implementing an interface, not by editing a giant `switch`.
- **L — Liskov Substitution:** subtypes must be usable wherever the base type is expected, without breaking expectations. The classic violation is a `Square extends Rectangle` whose setters break area assumptions. Don't throw `UnsupportedOperationException` from overridden methods.
- **I — Interface Segregation:** many small, client-specific interfaces (`Recordable`, `Streamable`) instead of one fat `MediaComponent` interface that forces empty implementations.
- **D — Dependency Inversion:** high-level modules depend on **abstractions**, with concrete implementations injected (Spring DI). That enables testing with fakes.

### Which design patterns do you use, and where do they appear in Spring and Java? 🔥

| Pattern | Idea | Where you see it |
|---|---|---|
| **Singleton** | One instance | Spring singleton beans. The safest manual version is an `enum` singleton or the holder idiom (lazy, thread-safe) |
| **Factory / Factory Method** | Encapsulate creation | `BeanFactory`, `Executors.newFixedThreadPool`, `List.of` |
| **Builder** | Step-by-step construction of complex immutable objects | `HttpRequest.newBuilder()`, Lombok `@Builder`, AWS SDK v2 request builders |
| **Strategy** | Interchangeable algorithms behind an interface | `Comparator`, Spring `Resource` loaders, choosing a bridge-selection strategy in Jicofo |
| **Observer** | Publish/subscribe | Spring `ApplicationEvent` + `@EventListener`, JavaFX/Swing listeners, Jitsi event emitters |
| **Decorator** | Wrap to add behaviour | `BufferedInputStream(new FileInputStream(...))`, `Collections.synchronizedList` |
| **Proxy** | A stand-in controlling access | **Spring AOP** (`@Transactional`, `@Cacheable`, security), Hibernate lazy-loading proxies |
| **Template Method** | Skeleton algorithm with overridable steps | `JdbcTemplate`, `RestTemplate`, `AbstractController` |
| **Adapter** | Convert one interface to another | `HandlerAdapter` in Spring MVC, wrapping legacy APIs |
| **Chain of Responsibility** | Pass a request along handlers | **Servlet filters / the Spring Security filter chain** (like Express middleware) |

### How do you relate your Java experience to the Jitsi stack in an interview?

Be precise and honest:

> "Most of my production code is TypeScript, but the Jitsi back end is JVM-based. Jicofo, the Videobridge and Jibri are written in Kotlin and Java, and configured with HOCON. I've *[read and debugged Jicofo's Jibri session handling / modified configuration / made small changes / built and run them in Docker]* while working on multi-Jibri recording. That gave me practical exposure to JVM concerns like thread pools, GC behaviour in a media server, and reading thread dumps."

Then show depth with the fundamentals on this page. Don't claim large-scale Spring Boot ownership unless you have it. If the role needs it, say how you'd ramp up.
