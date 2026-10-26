# Redis & Caching Strategies

"How would you make this faster?" and "how would you scale it?" usually end at **caching**. Caching is famously one of the hard problems: invalidation, stampedes, stale data and consistency.

**Redis** is the default answer for shared caching. It also handles **sessions, rate limiting, distributed locks, queues, leaderboards, pub/sub fan-out for WebSockets, and presence**, which matters for real-time systems like the ones you built.

This doc covers:

- Redis internals and data structures.
- Persistence, eviction and clustering.
- Every caching pattern and failure mode.
- HTTP and CDN caching for APIs.
- The classic Redis-backed algorithms.

> Redis commands aren't runnable here. **Single-flight + stale-while-revalidate caching, a Bloom filter, an O(1) LFU cache, token-bucket and sliding-window rate limiters, and fencing-token locks** are implemented in **runnable JavaScript with tests**.

## Redis fundamentals

### What is Redis, and why is it so fast? 🔥

Redis is an **in-memory data structure server**. Values aren't just strings: they're lists, hashes, sets, sorted sets, streams and more, each with atomic server-side operations.

**Why it's fast:**

1. **In-memory.** No disk access on the read path. Typical latency is **sub-millisecond**; the network round trip dominates.
2. **A single-threaded command executor.**
   - No locks and no context switches between commands.
   - **Every command is atomic.**
   - Network I/O can use **I/O threads** (since 6.0), and slow work is offloaded to background threads: `UNLINK`, AOF fsync, lazy freeing.
3. **An event loop** (epoll/kqueue) multiplexes thousands of connections, exactly like Node.js.
4. **Efficient encodings.** Small hashes, lists and sets use compact **listpack** or intset encodings.
5. **A simple protocol (RESP)**, plus **pipelining** that sends many commands without waiting for each reply.

**The flip side:**

- **One slow command blocks everyone.** `KEYS *`, `SMEMBERS` on a million-element set, `DEL` of a huge key, or a long Lua script will stall the server.
- **Data must fit in RAM**, or you shard with Redis Cluster.

**Ecosystem news worth knowing:**

- In 2024 Redis moved to source-available licences, and the Linux Foundation forked it as **Valkey** (now supported by AWS ElastiCache and others).
- **Redis 8** (2025) added **AGPLv3** as an open-source option and bundled JSON, search and time-series modules into the core.
- Commands and concepts are the same across both.

### Which Redis data structures do you know, and what is each used for? 🔥

| Type | Key commands | Typical uses |
|---|---|---|
| **String** (binary-safe, up to 512 MB) | `SET k v EX 60 NX`, `GET`, `INCR`, `INCRBY`, `MGET` | Cache values (JSON), counters, locks, rate-limit windows |
| **Hash** | `HSET user:7 name Zaki plan pro`, `HGET`, `HINCRBY`, `HGETALL` | Objects with fields (sessions, user profiles); update one field without rewriting the rest |
| **List** | `LPUSH`, `RPOP`, `BRPOP`, `LRANGE`, `LTRIM` | Simple queues, "latest N items" feeds (`LPUSH` + `LTRIM 0 99`) |
| **Set** | `SADD`, `SISMEMBER`, `SINTER`, `SCARD` | Unique members, tags, "online users in room", set intersections (mutual friends) |
| **Sorted set (ZSET)** | `ZADD`, `ZINCRBY`, `ZRANGE … REV WITHSCORES`, `ZRANK`, `ZRANGEBYSCORE`, `ZREMRANGEBYSCORE` | **Leaderboards**, priority queues, **sliding-window rate limits**, delayed jobs (score = run time), time-ordered indexes |
| **Stream** | `XADD`, `XREADGROUP`, `XACK`, `XAUTOCLAIM` | Durable event log with **consumer groups** (a lightweight Kafka) |
| **Bitmap** | `SETBIT`, `GETBIT`, `BITCOUNT`, `BITOP` | Daily active users (bit per user id), feature flags per user |
| **HyperLogLog** | `PFADD`, `PFCOUNT`, `PFMERGE` | **Approximate unique counts** (0.81% error, at most 12 KB per key) |
| **Geospatial** | `GEOADD`, `GEOSEARCH … BYRADIUS` | Nearby drivers or trucks, store locators |
| **JSON** (Redis Stack / Redis 8) | `JSON.SET`, `JSON.GET $.path` | Nested documents with partial updates |
| **Pub/Sub** (not stored) | `PUBLISH`, `SUBSCRIBE`, `PSUBSCRIBE` | Fire-and-forget fan-out (WebSocket node fan-out, cache invalidation broadcasts) |

**Choosing the structure is the interview skill:**

- "Leaderboard": a **sorted set**.
- "Unique visitors at scale": **HyperLogLog**.
- "Users currently in meeting 42": a **set**, or a sorted set scored by last heartbeat so stale users can be expired.
- "Recent 100 notifications": **list + LTRIM**.

### How does key expiration work?

- `SET key value EX 60` (or `PX` in ms), `EXPIRE key 60`, `TTL key` (returns −1 = no expiry, −2 = missing).
- **Write the value and TTL atomically.** `SET k v EX 60` is one command. `SET` followed by `EXPIRE` is two, and a crash in between leaves a key that never expires.
- **Expiration is lazy plus active:**
  - **Passive:** an expired key is deleted when someone accesses it.
  - **Active:** about 10 times a second, Redis samples keys that have TTLs and deletes the expired ones. It repeats while many are expiring.
  - So expired keys may use memory briefly, but they're never returned.
- **Overwriting a key with `SET` clears its TTL** unless you pass `KEEPTTL`. This is a classic bug: updating a cached value makes it immortal.
- `EXPIREAT` sets an absolute time. `PERSIST` removes the TTL.
- **Replicas don't expire keys independently.** The primary sends `DEL`s, so replica reads stay consistent.

### How does Redis persist data? RDB vs AOF 🔥

| | **RDB snapshots** | **AOF (append-only file)** |
|---|---|---|
| How | `fork()`, then the child writes a point-in-time snapshot (copy-on-write) | Logs every write command; replayed on restart |
| Data loss on crash | Everything since the last snapshot (minutes) | With `appendfsync everysec` (the default): **about 1 second**. With `always`: almost none, but slow |
| File size / restart | Compact, **fast restart** | Bigger, slower replay. **AOF rewrite** compacts it in the background |
| Cost | `fork` with a large dataset can cause latency spikes and memory overhead (copy-on-write) | Disk I/O on every write |

**Typical setups:**

- **Pure cache:** persistence off. It can be rebuilt from the database.
- **Data you care about** (sessions, queues, rate limits): **AOF everysec** plus RDB snapshots for backups. Modern AOF files start with an RDB preamble (a hybrid).
- **Remember replication is asynchronous.** On failover, a replica that hasn't received the last writes becomes primary, and those writes are **lost**. The `WAIT numreplicas timeout` command reduces this, but doesn't make Redis a strongly consistent database.

**Interview line:** "I treat Redis as a cache or as fast secondary state by default. If losing a second of data is unacceptable, the source of truth belongs in a database."

### What happens when Redis runs out of memory? Explain the eviction policies 🔥

Once `maxmemory` is reached, `maxmemory-policy` decides:

| Policy | Evicts | Use for |
|---|---|---|
| **`noeviction`** (default) | Nothing; **writes fail** with an OOM error | Data that must not silently disappear (queues, locks) |
| **`allkeys-lru`** | Least recently used, across all keys | **General caches**: the most common choice |
| **`allkeys-lfu`** | Least *frequently* used (with decay) | Caches with stable hot sets; resists one-off scans polluting the cache |
| `volatile-lru` / `volatile-lfu` | LRU/LFU among keys **that have a TTL** | Mixed instances: cache keys have TTLs, permanent keys don't |
| `volatile-ttl` | The keys closest to expiry | Rare |
| `allkeys-random` / `volatile-random` | Random | Uniform access patterns |

**Implementation details:**

- Redis's LRU is **approximated**: it samples `maxmemory-samples` keys (5 by default) and evicts the best candidate. There's no global linked list, to save memory.
- LFU uses a small **logarithmic counter** per key that decays over time.

**Best practice:**

- **Put a TTL on every cache key.**
- Use `allkeys-lru` or `allkeys-lfu` on a dedicated cache instance.
- **Never mix** must-keep data (queues) and evictable cache in one instance with an `allkeys-*` policy.

### Pipelining vs MULTI/EXEC vs Lua scripts: what are the guarantees? 🔥

| Mechanism | What it gives | What it doesn't |
|---|---|---|
| **Pipelining** | Many commands in one round trip, so **much higher throughput** | **No atomicity**: other clients' commands may interleave |
| **`MULTI` … `EXEC`** | Queued commands execute **atomically and in isolation** (nothing interleaves) | **No rollback** if one command fails at runtime. You **can't read a value and decide** inside the transaction |
| **`WATCH` + `MULTI`** | Optimistic check-and-set: `EXEC` aborts (returns null) if a watched key changed | Retry loops under contention |
| **Lua scripts** (`EVAL`) / **Functions** (Redis 7+) | **Atomic read-modify-write logic** running on the server | A long script blocks the whole server. Keep scripts tiny |

```redis
# Atomic "decrement stock only if enough" with Lua (KEYS[1] = stock key, ARGV[1] = qty)
EVAL "local s = tonumber(redis.call('GET', KEYS[1]) or '0')
      if s >= tonumber(ARGV[1]) then return redis.call('DECRBY', KEYS[1], ARGV[1]) else return -1 end" 1 stock:ticket:42 2
```

**Rule:** use Lua for anything that reads, then writes based on what it read: rate limiters, safe lock release, conditional decrements.

### Pub/Sub vs Streams vs Lists as queues: which do you use? 🔥

| | **Pub/Sub** | **Lists** (`LPUSH` / `BRPOP`) | **Streams** (`XADD` / `XREADGROUP`) |
|---|---|---|---|
| Delivery | **Fire-and-forget**. Offline subscribers miss messages | Each item is consumed by **one** worker | **Persistent log**; consumer groups split the work; each group gets every message |
| Durability | None | Persisted (if Redis persists) | Persisted, with history (trim with `MAXLEN`) |
| Acknowledgement | No | No (a crash after `BRPOP` loses the item, unless you use `LMOVE` to a processing list) | **`XACK`**. Unacked messages stay in the **pending entries list**, and `XAUTOCLAIM` reassigns them from dead consumers |
| Replay | No | No | Yes (read from any id) |
| Fits | **Broadcasting** to all nodes: Socket.IO adapter, cache invalidation, presence pings | Simple job queues (BullMQ adds reliability on top) | Event streams, reliable work queues, activity feeds |

**For WebSocket scaling:**

- **Pub/Sub** is the classic fan-out across server nodes (the `@socket.io/redis-adapter`). A missed message just means a client re-syncs.
- When **every message matters**, use **Streams** (`@socket.io/redis-streams-adapter`) or a real broker.

### Replication vs Sentinel vs Redis Cluster 🔥

| Setup | What it is | Gives you |
|---|---|---|
| **Replication** | One primary + async replicas | Read scaling, a warm standby |
| **Sentinel** | Separate processes that monitor the primary, **elect a new primary** on failure, and tell clients where it is | **High availability** for a single-shard dataset |
| **Redis Cluster** | Data **sharded across 16,384 hash slots** over several primaries, each with replicas | **Horizontal scale** (memory and throughput) plus HA |

**How Cluster works:**

- `slot = CRC16(key) mod 16384`. Each primary owns a range of slots.
- Clients are **cluster-aware**: a client sent to the wrong node gets **`MOVED`** (permanent) or **`ASK`** (slot migrating) redirects, and caches the slot map.
- **Multi-key operations** (`MGET`, transactions, Lua) only work if **all keys are in the same slot**. Force that with **hash tags**: `{user:42}:profile` and `{user:42}:cart` hash only `user:42`.
- Hash tags concentrate load, so **don't put everything under one tag**.

**Managed options:** AWS **ElastiCache / MemoryDB** (MemoryDB is durable, with a multi-AZ transaction log), Upstash (serverless, HTTP-based, Lambda-friendly), Azure Cache, Redis Cloud.

### What are big keys and hot keys, and how do you handle them? 🔥

**Big keys** are huge values or collections: a 50 MB string, or a hash with 5 million fields.

- **Problems:**
  - Slow commands block the server.
  - `DEL` blocks too, so use **`UNLINK`** (frees memory in the background).
  - Network spikes.
  - Uneven memory across cluster nodes.
  - Slow replication and migration.
- **Find them:** `redis-cli --bigkeys` / `--memkeys`, `MEMORY USAGE key`.
- **Fix:**
  - Split into multiple keys (shard a hash into `hash:{0..63}`).
  - Paginate access: `HSCAN`/`SSCAN`/`ZSCAN`, never `HGETALL` on huge hashes.
  - Store blobs elsewhere (S3).

**Hot keys** are a single key with enormous QPS: a viral post's counter, a global config key.

- **Problem:** one cluster node, and one CPU thread, saturates.
- **Find them:** `redis-cli --hotkeys` (needs an LFU policy), `MONITOR` briefly (expensive), client-side metrics.
- **Fix:**
  - A **local in-process cache** with a short TTL in front of Redis.
  - **Replicate the key** under N suffixes (`config:{1..8}`) and read a random one.
  - Read from replicas.
  - Batch increments.

**Never run `KEYS *` in production.** It's O(N) and blocks. Use **`SCAN`** with a cursor and `MATCH`/`COUNT`; it's incremental.

## Caching strategies

### Compare cache-aside, read-through, write-through, write-behind and write-around 🔥

| Pattern | Read path | Write path | Pros | Cons |
|---|---|---|---|---|
| **Cache-aside** (lazy loading) | The app checks the cache; on a miss it reads the DB and **populates the cache** | The app writes the DB, then **invalidates** (deletes) the cache key | Simple; only caches what's used; a cache failure degrades to the DB | First request is slow (a miss); invalidation races |
| **Read-through** | The **cache library or provider** loads from the DB on a miss | — | Loading logic in one place (Caffeine `LoadingCache`, DAX) | Needs a cache layer that knows the DB |
| **Write-through** | — | Write to the cache, which **synchronously** writes the DB | Cache always fresh for written keys | Write latency; caches data that may never be read |
| **Write-behind** (write-back) | — | Write to the cache; it **asynchronously** flushes to the DB in batches | Very fast writes; absorbs spikes (counters, analytics) | **Data loss** if the cache dies before flushing; complex consistency |
| **Write-around** | Cache-aside reads | Write **only to the DB**; the cache fills on later reads | Avoids polluting the cache with write-once data | Recent writes are misses |
| **Refresh-ahead** | Proactively refresh hot keys **before** expiry | — | No miss latency for hot keys | Wasted refreshes for keys that go cold |

**The default answer:** **cache-aside with TTLs plus delete-on-write**. Mention write-behind for counters and view counts, and refresh-ahead or stale-while-revalidate for hot keys.

```node
// Cache-aside with TTL jitter (Node + ioredis)
async function getMeeting(id) {
  const key = `meeting:v3:${id}`;                              // version the key format
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const meeting = await db.meetings.findById(id);
  if (meeting) await redis.set(key, JSON.stringify(meeting), 'EX', 300 + Math.floor(Math.random() * 60));
  return meeting;
}

async function updateMeeting(id, patch) {
  const updated = await db.meetings.update(id, patch);        // 1. write the source of truth
  await redis.del(`meeting:v3:${id}`);                        // 2. invalidate (not update) the cache
  return updated;
}
```

### Why delete the cache on write instead of updating it? What race conditions remain? 🔥

**Updating the cache on write races between writers:**

```text
Writer A: DB.set(v1)                         Writer B: DB.set(v2)
                                             Writer B: cache.set(v2)
Writer A: cache.set(v1)          → DB = v2, cache = v1 (wrong until TTL)
```

**Deleting is safer** (the next read reloads from the DB), but cache-aside **still has a rare race**:

```text
Reader R: cache miss → reads DB (old value v1) … slow …
Writer W: DB.set(v2) → cache.del(key)
Reader R: cache.set(v1)          → stale value cached after the invalidation
```

**Mitigations, from simplest:**

1. **A TTL on every key** bounds the staleness. Often that's acceptable.
2. **Delayed double delete:** delete, then delete again about 500 ms later, catching a reader that populated in between.
3. **Versioned writes:** store `{value, version}` and only `SET` if the new version is higher (Lua compare), or include the version in the key.
4. **Invalidate from the database's change stream** (CDC: Debezium, DynamoDB Streams). Invalidation then happens *after commit*, in commit order.
5. **Leases** (Facebook's memcache paper): a miss returns a lease token, and only the token holder may fill the key. A delete invalidates outstanding leases.

**Also:** **invalidate after the transaction commits**, never inside it. Otherwise a reader can reload the old row before your commit lands.

### What is a cache stampede, and how do you prevent it? 🔥

**A cache stampede** (thundering herd, dogpile) happens when a **hot key expires** and **thousands of concurrent requests miss at once**. They all hit the database with the same expensive query, and the database falls over, often repeatedly.

**Fixes:**

| Technique | How |
|---|---|
| **Request coalescing / single-flight** | Within one process, concurrent misses for a key **share one in-flight promise** |
| **Distributed lock** | The first miss takes `SET lock:key NX PX 5000`, the others wait briefly or serve stale data |
| **Stale-while-revalidate** | Keep serving the **stale** value while **one** background refresh runs (soft TTL < hard TTL) |
| **Probabilistic early expiration** (XFetch) | Each request refreshes early with a probability that rises as expiry approaches, so refreshes spread out |
| **TTL jitter** | `ttl = base + random(0..spread)`, so keys cached together don't expire together (prevents an **avalanche**) |
| **Pre-warming** | Populate hot keys at deploy or before known traffic peaks (webinar start times!) |

This runnable cache combines **single-flight**, **stale-while-revalidate** and **jittered TTLs**:

```js
// Single-flight + stale-while-revalidate cache with an injectable clock
function createCache({ loader, freshMs, staleMs, jitterMs = 0, now = () => Date.now(), random = Math.random }) {
  const entries = new Map();          // key -> { value, freshUntil, staleUntil }
  const inflight = new Map();         // key -> Promise (single-flight)
  const stats = { loads: 0, hits: 0, stale: 0 };

  function load(key) {
    if (inflight.has(key)) return inflight.get(key);                    // coalesce concurrent misses
    stats.loads++;
    const p = loader(key)
      .then((value) => {
        const t = now(), ttl = freshMs + Math.floor(random() * jitterMs);
        entries.set(key, { value, freshUntil: t + ttl, staleUntil: t + ttl + staleMs });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function get(key) {
    const e = entries.get(key), t = now();
    if (e && t < e.freshUntil) { stats.hits++; return e.value; }
    if (e && t < e.staleUntil) {                                         // serve stale, refresh in background
      stats.stale++;
      load(key).catch(() => {});                                         // a failed refresh keeps the stale value
      return e.value;
    }
    return load(key);                                                    // hard miss: wait for the loader
  }
  return { get, stats };
}

// Fake clock + a slow "database"
let clock = 0;
let dbValue = 'v1';
const dbCalls = [];
const loader = (key) => new Promise((resolve) => { dbCalls.push(key); setTimeout(() => resolve(dbValue), 5); });

test('100 concurrent misses trigger ONE database call', async () => {
  const cache = createCache({ loader, freshMs: 1000, staleMs: 5000, now: () => clock });
  const results = await Promise.all(Array.from({ length: 100 }, () => cache.get('meeting:42')));
  expect(new Set(results)).toEqual(new Set(['v1']));
  expect(cache.stats.loads).toBe(1);
});

test('after the fresh TTL, stale data is served instantly while one refresh runs', async () => {
  dbCalls.length = 0;
  clock = 0;
  const cache = createCache({ loader, freshMs: 1000, staleMs: 5000, now: () => clock });
  await cache.get('k');                       // initial load (v1)
  dbValue = 'v2';
  clock = 1500;                               // past fresh, within stale
  const [a, b] = await Promise.all([cache.get('k'), cache.get('k')]);
  expect([a, b]).toEqual(['v1', 'v1']);       // no waiting on the DB
  await new Promise((r) => setTimeout(r, 20)); // let the background refresh finish
  expect(await cache.get('k')).toBe('v2');
  expect(dbCalls).toHaveLength(2);            // initial + exactly one refresh
});

test('jitter spreads expiry times so keys do not expire together', async () => {
  let r = 0;
  const randoms = [0.1, 0.9, 0.5];
  const cache = createCache({ loader: async () => 'x', freshMs: 1000, staleMs: 0, jitterMs: 600, now: () => 0, random: () => randoms[r++] });
  await Promise.all(['a', 'b', 'c'].map((k) => cache.get(k)));
  expect(r).toBe(3);                          // each key got its own random TTL (1060, 1540, 1300 ms)
});
```

### Explain cache penetration, cache avalanche and cache breakdown 🔥

This is a classic trio, often asked by name:

| Problem | What happens | Fixes |
|---|---|---|
| **Penetration** | Requests for keys that **don't exist** in the DB (random ids, attackers) always miss and always hit the DB | **Cache negative results** (`null` with a short TTL); a **Bloom filter** of valid ids in front of the cache; input validation and rate limiting |
| **Avalanche** | **Many keys expire at the same time**, or the cache cluster goes down, so the DB gets the full load | **TTL jitter**; multi-level caches (local + Redis); a highly available cache; **circuit breakers** and load shedding on the DB path; warm-up |
| **Breakdown** (hot-key expiry) | **One very hot key** expires and the herd hits the DB | Single-flight or mutex rebuild; stale-while-revalidate; never-expire hot keys with background refresh |

A **Bloom filter** answers "**definitely not present**" or "**possibly present**". It uses k hash functions setting bits in an m-bit array. It never gives false negatives, but has a tunable false-positive rate. Redis has `BF.ADD`/`BF.EXISTS` (RedisBloom, bundled in Redis 8). LSM-tree databases use Bloom filters to skip SSTables.

```js
// Bloom filter: no false negatives, small tunable false-positive rate
class BloomFilter {
  constructor(expectedItems, falsePositiveRate) {
    this.m = Math.ceil(-(expectedItems * Math.log(falsePositiveRate)) / Math.LN2 ** 2);   // bits
    this.k = Math.max(1, Math.round((this.m / expectedItems) * Math.LN2));                 // hash functions
    this.bits = new Uint8Array(Math.ceil(this.m / 8));
  }
  hash(str, seed) {                         // FNV-1a variant with a seed
    let h = 2166136261 ^ seed;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) % this.m;
  }
  positions(item) {                         // double hashing: h1 + i*h2
    const h1 = this.hash(item, 0), h2 = this.hash(item, 0x9e3779b9) || 1;
    return Array.from({ length: this.k }, (_, i) => (h1 + i * h2) % this.m);
  }
  add(item) { for (const p of this.positions(item)) this.bits[p >> 3] |= 1 << (p & 7); }
  mightContain(item) { return this.positions(item).every((p) => this.bits[p >> 3] & (1 << (p & 7))); }
}

const bloom = new BloomFilter(10_000, 0.01);
for (let i = 0; i < 10_000; i++) bloom.add(`meeting:${i}`);

let falsePositives = 0;
for (let i = 10_000; i < 20_000; i++) if (bloom.mightContain(`meeting:${i}`)) falsePositives++;
console.log({ bits: bloom.m, kilobytes: (bloom.m / 8 / 1024).toFixed(1), hashes: bloom.k, falsePositiveRate: falsePositives / 10_000 });

test('never a false negative', () => {
  for (let i = 0; i < 10_000; i++) expect(bloom.mightContain(`meeting:${i}`)).toBe(true);
});
test('false-positive rate stays near the 1% target', () => {
  expect(falsePositives / 10_000).toBeLessThan(0.03);
});
```

**The penetration flow:**

1. Request `GET /meetings/999999`.
2. The Bloom filter says "definitely not present", so return 404 **without touching the cache or the DB**.
3. If it says "maybe", fall through to the cache, then the DB.

### What should you cache, for how long, and how do you design cache keys?

**Good candidates:**

- Read-heavy, expensive-to-compute, tolerant of slight staleness: product and meeting details, permissions, configuration and feature flags, rendered fragments, aggregated dashboard numbers, third-party API responses (exchange rates, tokens).
- **Session and auth lookups** that are hit on every request.

**Be careful with:**

- Highly personalised data (low hit rate, memory waste).
- Rapidly changing data (constant invalidation).
- Anything where **staleness is a correctness bug**: balances, inventory at checkout, permissions right after revocation (use short TTLs plus explicit invalidation).

**Choosing TTLs:**

- Ask "**how stale can this be without harm?**".
- Then choose **TTL = that bound**, with jitter.
- Longer TTLs plus explicit invalidation for data you control. Shorter TTLs for data that changes outside your control.

**Key design:**

- **Namespaced and versioned:** `app:meeting:v3:{id}`. Bump `v3 → v4` when the serialised shape changes, and old entries simply age out.
- **Include every input that changes the output:** tenant, locale, role. `perm:{tenantId}:{userId}`. Missing the tenant in a key is a **data-leak bug**.
- **Hash long keys:** `search:{sha1(normalisedQuery)}`.
- Keep values reasonably small. Compress big JSON, or cache only the fields the UI needs.

### How do multi-level caches work, and how do you keep them consistent? 🔥

```text
Browser cache → CDN (CloudFront) → reverse proxy (Nginx) → app in-process cache (LRU) → Redis → database
   ms 0           ~10–30 ms              ~1 ms                  ~0.01 ms                  ~0.5 ms   ~5–50 ms
```

| Level | Scope | Invalidation |
|---|---|---|
| **Browser** | Per user | `Cache-Control`, ETags; hashed filenames for assets |
| **CDN** | Global, shared | TTL (`s-maxage`), **invalidation API** (CloudFront `CreateInvalidation`), versioned URLs |
| **In-process** (Caffeine, `lru-cache`, Guava) | Per instance; **N copies** | Short TTLs; **broadcast invalidations via Redis Pub/Sub** to every instance |
| **Redis** | Shared by all instances | Delete on write, TTLs, CDC |

**Pitfalls:**

- **In-process caches diverge between instances.** User A hits pod 1 (fresh) and then pod 2 (stale). Keep local TTLs very short (seconds), or subscribe every pod to an invalidation channel.
- **Total staleness adds up** across levels: CDN TTL + Redis TTL + browser max-age.
- Memory: an in-process cache competes with the app heap (watch Node's heap limit, JVM GC).

### How do HTTP caching headers work for APIs and assets? 🔥

| Header | Meaning |
|---|---|
| `Cache-Control: max-age=60` | Fresh for 60 s in any cache |
| `s-maxage=300` | Override for **shared caches** (CDN, proxy) |
| `public` / `private` | `private`: only the browser may cache (user-specific responses) |
| **`no-cache`** | **May store, but must revalidate** with the server before each use |
| **`no-store`** | **Never store** (sensitive data) |
| `must-revalidate` | Once stale, don't serve without revalidation |
| `stale-while-revalidate=30` | Serve stale for up to 30 s while revalidating in the background (RFC 5861) |
| `stale-if-error=86400` | Serve stale if the origin errors |
| `immutable` | Never revalidate. For **content-hashed** assets (`app.3f9a1c.js`) |
| **`ETag`** / `If-None-Match` | Validator: if unchanged, the server returns **304 Not Modified** with no body |
| `Last-Modified` / `If-Modified-Since` | Time-based validator (1 s resolution) |
| **`Vary: Accept-Encoding, Accept-Language`** | Cache a separate variant per header value. **`Vary: Authorization`** or `Cookie` effectively disables shared caching |

**Typical policies:**

```http
# Hashed JS/CSS from Vite builds
Cache-Control: public, max-age=31536000, immutable

# index.html (must pick up new deployments)
Cache-Control: no-cache

# Public API: list of public webinars
Cache-Control: public, max-age=30, s-maxage=120, stale-while-revalidate=60
ETag: "a1b2c3"

# User-specific API data
Cache-Control: private, no-cache
ETag: W/"user42-v17"

# Tokens, payment pages
Cache-Control: no-store
```

**The SWR connection.** The **SWR** library used by this prep app is named after the HTTP `stale-while-revalidate` directive:

- It returns the cached data immediately.
- It revalidates in the background.
- It deduplicates concurrent requests for the same key (single-flight).

It's the client-side version of the server patterns in this doc. Mention this when asked about SWR or React Query caching.

### Implement an LFU cache with O(1) operations 🔥

LRU appears in [Machine Coding](/docs/machine-coding). **LFU** (least frequently used) is the follow-up, and it's harder:

- **Evict the key with the lowest access count.**
- Break ties by **least recent** within that count.
- O(1) needs **frequency buckets**, each an insertion-ordered set, plus a `minFreq` pointer.

```js
class LFUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.values = new Map();          // key -> value
    this.freq = new Map();            // key -> count
    this.buckets = new Map();         // count -> Set of keys (insertion order = recency within the count)
    this.minFreq = 0;
  }
  touch(key) {
    const f = this.freq.get(key);
    this.buckets.get(f).delete(key);
    if (this.buckets.get(f).size === 0) {
      this.buckets.delete(f);
      if (this.minFreq === f) this.minFreq = f + 1;
    }
    this.freq.set(key, f + 1);
    if (!this.buckets.has(f + 1)) this.buckets.set(f + 1, new Set());
    this.buckets.get(f + 1).add(key);
  }
  get(key) {
    if (!this.values.has(key)) return -1;
    this.touch(key);
    return this.values.get(key);
  }
  put(key, value) {
    if (this.capacity <= 0) return;
    if (this.values.has(key)) { this.values.set(key, value); this.touch(key); return; }
    if (this.values.size >= this.capacity) {
      const bucket = this.buckets.get(this.minFreq);
      const evict = bucket.values().next().value;               // least recently used among least frequent
      bucket.delete(evict);
      if (bucket.size === 0) this.buckets.delete(this.minFreq);
      this.values.delete(evict);
      this.freq.delete(evict);
    }
    this.values.set(key, value);
    this.freq.set(key, 1);
    if (!this.buckets.has(1)) this.buckets.set(1, new Set());
    this.buckets.get(1).add(key);
    this.minFreq = 1;
  }
}

test('LeetCode 460 sequence', () => {
  const c = new LFUCache(2);
  c.put(1, 1); c.put(2, 2);
  expect(c.get(1)).toBe(1);        // freq: 1→2, 2→1
  c.put(3, 3);                     // evicts 2 (lowest freq)
  expect(c.get(2)).toBe(-1);
  expect(c.get(3)).toBe(3);        // freq: 3→2
  c.put(4, 4);                     // 1 and 3 both have freq 2 → evict the least recent: 1
  expect(c.get(1)).toBe(-1);
  expect(c.get(3)).toBe(3);
  expect(c.get(4)).toBe(4);
});
test('a scan of one-off keys does not evict a hot key', () => {
  const c = new LFUCache(3);
  c.put('hot', 'x');
  for (let i = 0; i < 5; i++) c.get('hot');
  for (let i = 0; i < 10; i++) c.put(`scan${i}`, i);   // LRU would have evicted 'hot'
  expect(c.get('hot')).toBe('x');
});
```

**LRU vs LFU:**

- **LRU** adapts quickly to changing popularity, but a one-off **scan** evicts hot items.
- **LFU** keeps long-term favourites, but needs **ageing/decay** so yesterday's hit doesn't stay forever. Redis's LFU decays its counters.
- Production caches like **Caffeine** (Java) use **W-TinyLFU**, a hybrid that gets the best of both.

### How do you use caching in Spring, Node, Django and the frontend?

```java
// Spring: @EnableCaching + RedisCacheManager
@Cacheable(cacheNames = "meetings", key = "#id", unless = "#result == null", sync = true)   // sync: one loader per key per JVM
public MeetingDto getMeeting(long id) { … }

@CacheEvict(cacheNames = "meetings", key = "#id")
public MeetingDto update(long id, UpdateMeeting cmd) { … }
// ⚠ Self-invocation (this.getMeeting()) bypasses the proxy, so the cache isn't used — same pitfall as @Transactional
```

**Per stack:**

- **Node:**
  - `ioredis`/`node-redis` with cache-aside helpers.
  - `lru-cache` for in-process caching.
  - Fastify `@fastify/caching`.
  - Next.js has its own data cache (see [Next.js](/docs/nextjs)).
- **Django:** `django.core.cache` with a Redis backend, `@cache_page`, `cache.get_or_set`, template fragment caching.
- **Frontend:**
  - **SWR / TanStack Query** cache server state: dedupe, revalidation, `mutate` for optimistic updates and invalidation.
  - Service workers cache assets and API responses (Workbox strategies: cache-first, network-first, stale-while-revalidate).

## Redis beyond caching

### Sessions in Redis vs JWTs: which and why?

| | **Server-side sessions** (cookie with session id → Redis) | **JWT** (self-contained token) |
|---|---|---|
| Revocation | **Instant**: delete the key (logout everywhere, ban) | Hard. The token is valid until expiry unless you keep a denylist (which is a session store again) |
| Per-request cost | One Redis lookup (~0.5 ms) | Signature verification only |
| Size | A small cookie | Grows with claims; sent on every request |
| Cross-service | Services need Redis access | Any service with the public key can verify |
| Typical use | **Web apps** (BFF pattern), admin panels | **Service-to-service**, mobile APIs, short-lived access tokens + refresh tokens |

```node
// Express sessions in Redis
import session from 'express-session';
import { RedisStore } from 'connect-redis';
app.use(session({
  store: new RedisStore({ client: redis, prefix: 'sess:' }),
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 },
}));
```

**A common hybrid:** short-lived JWT access tokens (5–15 min) plus **refresh tokens stored server-side** (Redis or DB) with rotation and reuse detection. You get revocability without a lookup on every call. See [Web Security & Auth](/docs/web-security-auth).

### Implement rate limiting: fixed window, sliding window and token bucket 🔥

| Algorithm | How | Pros | Cons |
|---|---|---|---|
| **Fixed window** | `INCR rl:{user}:{minute}`, with `EXPIRE` on the first hit | Simplest, cheap | **Bursts at boundaries**: 2× the limit across 12:00:59 and 12:01:00 |
| **Sliding window log** | ZSET of timestamps: remove those older than the window, `ZCARD`, `ZADD` | Exact | Memory per request (O(limit) per user) |
| **Sliding window counter** | `current + previous × (1 − elapsed fraction)` | Smooth, O(1) memory | Approximate |
| **Token bucket** | Tokens refill at rate r up to capacity b; a request spends one | **Allows controlled bursts**; the standard for APIs (AWS API Gateway uses it) | Needs atomic read-modify-write (Lua) |
| **Leaky bucket** | Requests drain at a constant rate (a queue) | Smooths traffic (shaping) | Adds latency; bursts are queued or dropped |

```js
// Token bucket and sliding-window counter with an injectable clock (what the Lua script would do in Redis)
function tokenBucket({ capacity, refillPerSec, now }) {
  const state = new Map();            // key -> { tokens, last }
  return (key) => {
    const t = now();
    const s = state.get(key) ?? { tokens: capacity, last: t };
    s.tokens = Math.min(capacity, s.tokens + ((t - s.last) / 1000) * refillPerSec);
    s.last = t;
    const allowed = s.tokens >= 1;
    if (allowed) s.tokens -= 1;
    state.set(key, s);
    return { allowed, remaining: Math.floor(s.tokens) };
  };
}

function slidingWindowCounter({ limit, windowMs, now }) {
  const counts = new Map();           // `${key}:${windowIndex}` -> count
  return (key) => {
    const t = now();
    const idx = Math.floor(t / windowMs);
    const elapsed = (t % windowMs) / windowMs;
    const cur = counts.get(`${key}:${idx}`) ?? 0;
    const prev = counts.get(`${key}:${idx - 1}`) ?? 0;
    const estimate = cur + prev * (1 - elapsed);
    if (estimate >= limit) return { allowed: false };
    counts.set(`${key}:${idx}`, cur + 1);
    return { allowed: true };
  };
}

let now = 0;
test('token bucket allows a burst up to capacity, then refills over time', () => {
  now = 0;
  const take = tokenBucket({ capacity: 5, refillPerSec: 1, now: () => now });
  const burst = Array.from({ length: 7 }, () => take('user:7').allowed);
  expect(burst).toEqual([true, true, true, true, true, false, false]);
  now = 2000;                                        // 2 s later: 2 tokens refilled
  expect([take('user:7').allowed, take('user:7').allowed, take('user:7').allowed]).toEqual([true, true, false]);
});
test('sliding window counter blocks the boundary burst a fixed window would allow', () => {
  now = 59_000;                                      // end of minute 0
  const hit = slidingWindowCounter({ limit: 10, windowMs: 60_000, now: () => now });
  const endOfWindow = Array.from({ length: 10 }, () => hit('ip').allowed).filter(Boolean).length;
  now = 61_000;                                      // 2 s into minute 1: previous window still weighs ~97%
  const startOfNext = Array.from({ length: 10 }, () => hit('ip').allowed).filter(Boolean).length;
  expect(endOfWindow).toBe(10);
  expect(startOfNext).toBe(1);                       // 10 × 0.98 ≈ 9.8 already counted; a fixed window would allow 10 more
});
```

**Production details:**

- Run the logic **atomically in Redis** with a Lua script, keyed per user, API key or IP.
- Return **`429 Too Many Requests`** with `Retry-After` and `RateLimit-*` headers.
- Layer it: per-IP at the edge (WAF/CDN), per-user and per-tenant at the API, per-endpoint for expensive operations.
- **Fail open or closed?** Usually fail open when Redis is down, and alert. Fail closed for login or OTP endpoints.

### How do you build a distributed lock with Redis, and what are its limits? 🔥

```redis
# Acquire: set only if absent, with an expiry (so a crashed holder can't block forever); value = unique token
SET lock:invoice-job 8f14e45f NX PX 30000

# Release: only if we still own it (a compare-and-delete must be atomic → Lua)
EVAL "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end" 1 lock:invoice-job 8f14e45f
```

**Why each part matters:**

- **`NX`:** mutual exclusion.
- **`PX`:** liveness if the holder dies.
- **A unique token:** you never delete someone else's lock after yours expired.
- **Lua release:** atomic check-and-delete.

**The fundamental problem:** a lock with a timeout **can't guarantee safety on its own**.

1. Client A gets the lock.
2. A stalls: a GC pause, a network partition, or a laptop sleeping.
3. The lock **expires** and client B takes it.
4. A wakes up and **still believes it holds the lock**. Both write.

**The fix is fencing tokens:**

- The lock service issues a **monotonically increasing token** with each lock grant.
- The **storage layer rejects writes carrying an older token** than one it has already seen.

```js
// Fencing tokens: the resource rejects writes from a holder whose lease has been superseded
function lockService() {
  let token = 0, holder = null, expiresAt = 0;
  return {
    acquire(client, now, ttl) {
      if (holder && now < expiresAt) return null;
      holder = client; expiresAt = now + ttl;
      return ++token;                                  // monotonically increasing
    },
  };
}
function storage() {
  let highestSeen = 0;
  const writes = [];
  return {
    write(client, fencingToken, data) {
      if (fencingToken < highestSeen) throw new Error(`rejected stale token ${fencingToken} from ${client}`);
      highestSeen = fencingToken;
      writes.push(`${client}:${data}`);
    },
    writes,
  };
}

test('a paused client with an expired lock cannot corrupt data', () => {
  const locks = lockService(), db = storage();
  const tokenA = locks.acquire('A', 0, 1000);          // A gets token 1, then pauses (GC) for 5 s
  const tokenB = locks.acquire('B', 2000, 1000);       // lock expired at 1000 → B gets token 2
  db.write('B', tokenB, 'invoice-v2');
  expect(() => db.write('A', tokenA, 'invoice-v1')).toThrow('stale token 1');
  expect(db.writes).toEqual(['B:invoice-v2']);
});
```

**Redlock** acquires the lock on a majority of N independent Redis nodes. Martin Kleppmann criticised it because it relies on **timing assumptions** (bounded pauses and clock drift) and provides **no fencing token**. The interview-ready summary:

- Redis locks are fine for **efficiency**: avoiding duplicate work, such as two pods running the same cron job.
- For **correctness** (money, inventory), rely on **database constraints, transactions, fencing tokens or a consensus system** (etcd/ZooKeeper, or Postgres advisory locks within one database).

### Build a leaderboard with sorted sets 🔥

```redis
ZINCRBY quiz:webinar42 10 user:7          # add points (atomic)
ZRANGE  quiz:webinar42 0 9 REV WITHSCORES # top 10, highest first
ZREVRANK quiz:webinar42 user:7            # my rank (0-based)
ZSCORE  quiz:webinar42 user:7             # my score
ZCOUNT  quiz:webinar42 100 +inf           # how many have ≥ 100 points
# "Around me": fetch ranks rank-2 .. rank+2
ZRANGE  quiz:webinar42 3 7 REV WITHSCORES
```

**Complexity:** a sorted set is a **skip list plus a hash**, so updates and rank queries are **O(log N)** and range reads are O(log N + M).

**Details interviewers probe:**

- **Ties:** equal scores order **lexicographically by member**. To make earlier achievers rank higher, encode time into the score: `score = points * 1e10 + (MAX_TS - timestamp)`.
- **Time-boxed boards:** daily and weekly keys (`lb:2026-10-09`) with TTLs; `ZUNIONSTORE` combines days into a week.
- **Huge boards** (100M users): shard by score range, or use approximate ranks for the long tail.

### Count unique visitors and daily actives cheaply

```redis
PFADD   visitors:2026-10-09 user:7 user:9 user:7      # HyperLogLog: duplicates ignored
PFCOUNT visitors:2026-10-09                            # ≈ unique count (0.81% standard error, ≤ 12 KB)
PFMERGE visitors:week41 visitors:2026-10-06 … visitors:2026-10-12

SETBIT  dau:2026-10-09 7 1                             # bitmap: bit per (numeric) user id
BITCOUNT dau:2026-10-09                                # exact daily actives
BITOP AND active_both dau:2026-10-08 dau:2026-10-09    # retained users (active on both days)
```

**Choosing:**

- **HyperLogLog** for huge cardinalities when ±1% is fine: page views, unique viewers of a webinar replay.
- **Bitmaps** for exact counts with dense numeric ids. 10M users is 1.25 MB per day.
- **A set** when you need the actual members and the set is small.

### How does Redis help scale real-time features like WebSockets and presence? 🔥

**1. Fan-out across nodes.**

- With several WebSocket servers behind a load balancer, a message for room 42 must reach clients **connected to other nodes**.
- The **Socket.IO Redis adapter** publishes every broadcast to Redis Pub/Sub, and every node delivers it to its local sockets.

```node
import { createAdapter } from '@socket.io/redis-adapter';
const pub = new Redis(process.env.REDIS_URL), sub = pub.duplicate();
io.adapter(createAdapter(pub, sub));
io.to('meeting:42').emit('reaction', { from: 'zaki', emoji: '👏' });   // reaches sockets on every node
```

**2. Presence** ("who's online in this room").

- Each client heartbeats every ~15 s: `ZADD presence:meeting:42 <now> user:7`.
- Readers call `ZRANGEBYSCORE presence:meeting:42 <now-45s> +inf`.
- A sweeper runs `ZREMRANGEBYSCORE … -inf <now-45s>`.
- The score-as-timestamp trick handles crashed clients that never sent "leave".

**3. Other uses:**

- Rate limiting of chat messages.
- Typing indicators (short-TTL keys).
- Recent message buffers (`LPUSH` + `LTRIM`).
- **Sticky-session alternatives:** keep session state in Redis, so any node can serve any client.

In a Jitsi deployment, room state and presence live in **Prosody (XMPP MUC)**, not Redis. Redis-style patterns fit the surrounding web app: dashboards, notifications, analytics counters.

### How do Redis-backed job queues work (BullMQ, Sidekiq, Celery)?

**BullMQ (Node), structurally:**

- Jobs are stored in Redis hashes, lists and sorted sets.
- Workers claim jobs **atomically with Lua**.
- **Delayed jobs** sit in a sorted set scored by run time.
- **Retries with backoff**, rate limiting, priorities, repeatable (cron) jobs and **stalled-job detection** (locks with heartbeats; jobs whose worker died are re-queued).

```node
import { Queue, Worker } from 'bullmq';
const recordings = new Queue('recording-postprocess', { connection });
await recordings.add('transcode', { recordingId: 991 }, { attempts: 5, backoff: { type: 'exponential', delay: 2000 }, jobId: 'rec-991' });

new Worker('recording-postprocess', async (job) => {
  await transcodeAndUpload(job.data.recordingId);              // must be idempotent: it may run twice
}, { connection, concurrency: 4 });
```

**Points to make:**

- Delivery is **at-least-once**, so handlers must be **idempotent**. A custom `jobId` deduplicates enqueues.
- Redis must have **persistence (AOF) and `noeviction`**, or jobs vanish.
- For cross-language, very high-volume, or long-retention needs, use **SQS, RabbitMQ or Kafka** (see [Backend System Design](/docs/backend-system-design)).

**The same model in other ecosystems:** Sidekiq (Ruby) and Celery (Python, with Redis or RabbitMQ as the broker).

### Find nearby drivers or loads with geospatial commands

```redis
GEOADD trucks 78.4867 17.3850 truck:12         # lon lat member (Hyderabad)
GEOADD trucks 78.3489 17.4401 truck:31
GEOSEARCH trucks FROMLONLAT 78.47 17.40 BYRADIUS 15 km ASC COUNT 10 WITHDIST
```

**How it works:**

- Positions are stored as **geohash-encoded scores in a sorted set**, so radius queries are sorted-set range scans plus distance filtering.
- Update positions frequently and expire stale trucks with a parallel heartbeat ZSET.
- For complex polygons, routes and joins with business data, use **PostGIS**.

### Redis vs Memcached vs an in-process cache vs DAX: how do you choose? 🔥

| | **In-process** (Caffeine, `lru-cache`) | **Memcached** | **Redis / Valkey** | **DynamoDB DAX** |
|---|---|---|---|---|
| Latency | ~µs (no network) | ~sub-ms | ~sub-ms | ~µs to sub-ms |
| Shared across instances | ❌ (N copies) | ✅ | ✅ | ✅ (DynamoDB only) |
| Data types | Language objects | Strings/blobs only | **Rich structures**, Lua, streams | DynamoDB items |
| Persistence / replication | ❌ | ❌ | ✅ RDB/AOF, replicas, cluster | Managed |
| Multi-threading | n/a | **Multi-threaded** (scales vertically on many cores) | Single-threaded execution (+ I/O threads) | Managed |
| Best for | Ultra-hot, small, rarely changing data (config, permission maps) with short TTLs | Simple large-scale string caching | **Default choice**: caching plus sessions, locks, queues, leaderboards, rate limits | Read-heavy DynamoDB apps that want caching without code changes (write-through) |

**A typical answer:** "Redis as the shared cache and coordination layer. A small in-process LRU with a few seconds' TTL in front of it for the hottest keys. And CDN/HTTP caching for public responses, because the cheapest request is the one that never reaches the server."
