# Replication, Sharding & Distributed Databases

Once data outgrows one machine, or must survive a machine (or a region) dying, you're in distributed-systems territory. Senior full-stack interviews probe this through questions like:

- "What happens to your app when the primary fails?"
- "How would you scale this table to 10 billion rows?"
- "Explain CAP."
- "How does DynamoDB stay fast at any scale?"
- "What's eventual consistency, and how does the UI deal with it?"

This doc covers:

- CAP, PACELC and consistency models.
- Quorums, clocks, conflict resolution and CRDTs.
- Consensus (Raft).
- Replication and failover.
- Sharding and consistent hashing.
- Storage engines (B-tree vs LSM).
- CQRS, event sourcing, CDC and multi-region designs.

> **Quorum reads, vector clocks, CRDT counters, a consistent-hashing ring and a mini LSM tree** are implemented in **runnable JavaScript with tests**. These ideas are much easier to explain once you've watched them run.

## Theory you must be able to explain

### Explain the CAP theorem properly (most explanations get it wrong) 🔥

**CAP** (Brewer, proven by Gilbert & Lynch) says that a distributed data store, **when a network partition happens**, must choose between:

- **Consistency (C):** here this means **linearisability**. Every read sees the most recent write, as if there were a single copy.
- **Availability (A):** every request to a **non-failing** node gets a **non-error** response. It doesn't have to be the latest data.

**Partition tolerance isn't optional.** Networks *do* partition: switches fail, there are GC pauses, AZ links drop. So the real choice is **CP vs AP during a partition**:

| Choice | During a partition | Examples |
|---|---|---|
| **CP** | Nodes that can't reach a majority **refuse** (error or timeout) rather than risk stale or conflicting data | ZooKeeper/etcd, HBase, MongoDB with majority concerns, Spanner, a single-primary SQL database (the minority side can't write) |
| **AP** | Every node keeps answering, possibly with **stale data** or accepting **conflicting writes**, and reconciles later | Cassandra/Dynamo-style stores with low consistency levels, DNS, CouchDB, DynamoDB eventually-consistent reads |

**Common mistakes to avoid:**

- **"Pick two of three"** is misleading. You can't give up P. Without partitions, a well-built system provides both C and A.
- **CAP's C is not ACID's C.** CAP-C is about replicas agreeing (linearisability). ACID-C is about invariants and constraints.
- **Systems aren't simply "CP" or "AP".** Many are **tunable per operation** (Cassandra consistency levels, DynamoDB `ConsistentRead`, MongoDB read/write concern).

### What is PACELC, and why is it more useful than CAP? 🔥

**PACELC** (Abadi) extends CAP:

- If there's a **P**artition, choose **A** or **C** (that's CAP).
- **E**lse, during normal operation, choose **L**atency or **C**onsistency.

**Why it matters:**

- Partitions are rare. The **latency vs consistency trade-off happens on every request.**
- Strong consistency needs coordination: waiting for a quorum, a leader, or a cross-region round trip.
- Weaker consistency answers from the nearest replica immediately.

| System (typical configuration) | Partition | Else |
|---|---|---|
| Cassandra, Dynamo-style stores, DynamoDB (default eventually-consistent reads) | PA | **EL** |
| DynamoDB with strongly consistent reads | PC | EC (leader reads, higher latency) |
| MongoDB with `w: majority` + `readConcern: majority`/`linearizable` | PC | EC |
| Spanner, CockroachDB, YugabyteDB | PC | **EC** |
| Postgres primary + async read replicas | PC on the primary | **EL** if reads go to replicas (stale reads) |

**Interview line:** "CAP tells you what happens in a partition. PACELC reminds you that you pay for consistency in **latency** all the time, so I choose per use case: strong reads for a balance or permission check, eventual reads for a feed or a dashboard."

### Describe the spectrum of consistency models with examples 🔥

From strongest to weakest:

| Model | Guarantee | Example where you need it |
|---|---|---|
| **Linearisable** (strong) | Operations appear instantaneous, in real-time order; a read after a completed write sees it, **from any client** | Leader election, locks, unique usernames, account balances |
| **Sequential** | All clients see the same order of operations, but not necessarily in real-time order | Some replicated logs |
| **Causal** | If A causes B (e.g. a reply to a message), everyone sees A before B; unrelated writes may appear in different orders | Chat threads and comments: never show the reply before the question |
| **Read-your-writes** | **You** always see your own writes | After editing your profile, the page must show the edit |
| **Monotonic reads** | You never see time go backwards (a newer value, then an older one) | Refreshing a feed shouldn't make a message disappear |
| **Consistent prefix** | You see writes in order, maybe delayed, never out of order | Event histories, bank statements |
| **Eventual** | If writes stop, replicas converge eventually | Like counts, view counts, recommendations, search indexes |

**How UIs cope with eventual consistency:**

- **Optimistic updates:** show the user's change immediately, then reconcile. This is how SWR/React Query `mutate` works.
- **Route the writer's reads to the primary** for a few seconds after a write (read-your-writes).
- **Sticky sessions** to one replica (monotonic reads).
- Show "updating…" states; **version numbers** to ignore older responses.

### How do quorums work (N, W, R)? 🔥

In leaderless replication (the Dynamo/Cassandra style), each key is stored on **N** replicas:

- A write succeeds when **W** replicas acknowledge it.
- A read queries **R** replicas and takes the value with the **newest version**.
- **If `W + R > N`**, every read set **overlaps** every write set, so at least one replica in any read has the latest write.
- Common choice: **N = 3, W = 2, R = 2** (QUORUM/QUORUM).

**Trade-offs:**

| Setting | Effect |
|---|---|
| W = 1, R = 1 | Fastest, most available; **stale reads possible** |
| W = N | Writes fail if any replica is down |
| R = N | Reads fail if any replica is down |
| W = 2, R = 2 (N = 3) | Tolerates one node down for both reads and writes; strongly consistent reads, barring edge cases |

**Edge cases** (why quorums ≠ linearisability):

- **Sloppy quorums with hinted handoff:** writes go to substitute nodes during failures, so the overlap breaks.
- **Concurrent writes** resolved by last-write-wins with skewed clocks.
- **A write that failed on some replicas but succeeded on others.**

**Repair mechanisms:**

- **Read repair:** fix stale replicas found during reads.
- **Anti-entropy:** background comparison using **Merkle trees**.
- **Hinted handoff.**

```js
// Quorum simulation: write to the FIRST W replicas, read from the LAST R replicas (worst-case overlap)
function cluster(n) {
  const replicas = Array.from({ length: n }, () => ({ value: 'v0', version: 0 }));
  let version = 0;
  return {
    write(value, w) {
      version++;
      for (let i = 0; i < w; i++) replicas[i] = { value, version };
    },
    read(r) {
      const answers = replicas.slice(n - r);                          // a different set of replicas than the writers
      return answers.reduce((best, a) => (a.version > best.version ? a : best)).value;
    },
  };
}

const N = 3;
const results = [];
for (let w = 1; w <= N; w++) {
  for (let r = 1; r <= N; r++) {
    const c = cluster(N);
    c.write('v1', w);
    results.push({ W: w, R: r, overlap: w + r > N, readSees: c.read(r) });
  }
}
console.table(results);

test('a read sees the latest write exactly when W + R > N', () => {
  for (const row of results) expect(row.readSees === 'v1').toBe(row.overlap);
});
```

### Why can't you trust wall clocks? Explain Lamport and vector clocks 🔥

**Physical clocks drift**:

- NTP corrections can make a clock **jump backwards**.
- Leap seconds and VM pauses distort time further.
- Two machines can disagree by milliseconds or more.

So **"order writes by timestamp" (last-write-wins) can silently drop the write that really happened later.**

**Logical clocks order events without wall time:**

| Clock | How | Tells you |
|---|---|---|
| **Lamport clock** | A counter: increment on every event; on receive, `max(local, received) + 1` | A total order consistent with causality. If A → B then L(A) < L(B). But L(A) < L(B) does **not** mean A caused B |
| **Vector clock** | One counter **per node**; merge with an element-wise max | Can tell **"happened-before" vs "concurrent"**, so you can detect conflicts |
| **Hybrid logical clock (HLC)** | Physical time + a logical counter | Close to wall time **and** causally ordered (CockroachDB, YugabyteDB, MongoDB's cluster time) |
| **TrueTime** (Spanner) | GPS and atomic clocks give a bounded uncertainty interval; commits **wait out the uncertainty** | External consistency (linearisability) across the globe |

```js
// Vector clocks: detect whether two versions are ordered or concurrent (a conflict)
const increment = (vc, node) => ({ ...vc, [node]: (vc[node] ?? 0) + 1 });
const merge = (a, b) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
};
function compare(a, b) {
  const nodes = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aLess = false, bLess = false;
  for (const n of nodes) {
    if ((a[n] ?? 0) < (b[n] ?? 0)) aLess = true;
    if ((b[n] ?? 0) < (a[n] ?? 0)) bLess = true;
  }
  return aLess && bLess ? 'concurrent' : aLess ? 'before' : bLess ? 'after' : 'equal';
}

// Two replicas of a meeting title, edited while partitioned
const base = increment({}, 'mumbai');                 // { mumbai: 1 }
const fromMumbai = increment(base, 'mumbai');         // { mumbai: 2 }
const fromFrankfurt = increment(base, 'frankfurt');   // { mumbai: 1, frankfurt: 1 }
const resolved = increment(merge(fromMumbai, fromFrankfurt), 'mumbai');

test('causally ordered versions', () => {
  expect(compare(base, fromMumbai)).toBe('before');
  expect(compare(fromMumbai, base)).toBe('after');
});
test('concurrent edits are detected as a conflict', () => {
  expect(compare(fromMumbai, fromFrankfurt)).toBe('concurrent');
});
test('a merged, resolved version dominates both', () => {
  expect(compare(fromMumbai, resolved)).toBe('before');
  expect(compare(fromFrankfurt, resolved)).toBe('before');
});
```

### How are conflicting writes resolved? LWW, siblings, CRDTs 🔥

When two replicas accept different writes to the same key concurrently (multi-leader, leaderless, offline clients), you need a **resolution strategy**:

| Strategy | How | Trade-off |
|---|---|---|
| **Last-write-wins (LWW)** | Keep the highest timestamp | Simple, but **silently loses data**, and clock skew picks the "wrong" winner. DynamoDB global tables and Cassandra use it |
| **Keep siblings** (version vectors) | Store all concurrent versions and let the app or user merge them | No data loss; complex UX (Riak, CouchDB conflicts) |
| **Application merge** | Domain logic: union of shopping carts, max of counters, field-level merge | Correct for the domain; custom code |
| **CRDTs** (Conflict-free Replicated Data Types) | Data types whose merge is **commutative, associative and idempotent**, so replicas **converge automatically** in any order | Only certain data types; metadata overhead |
| **Operational transformation (OT)** | Transform concurrent edit operations against each other (Google Docs) | Needs a central server; complex |

**CRDT examples:**

- **G-Counter** (grow-only counter, one slot per replica, merge = max).
- **PN-Counter** (increments and decrements).
- **OR-Set** (add and remove with unique tags).
- **LWW-Register.**
- **Sequence CRDTs** for collaborative text (**Yjs**, Automerge).

Collaborative whiteboards and editors (Excalidraw-style, Etherpad-style) rely on these ideas.

```js
// State-based CRDTs: replicas merge in ANY order and still converge
const gCounter = {
  inc: (c, node, n = 1) => ({ ...c, [node]: (c[node] ?? 0) + n }),
  merge: (a, b) => Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, Math.max(a[k] ?? 0, b[k] ?? 0)])),
  value: (c) => Object.values(c).reduce((s, v) => s + v, 0),
};
const pnCounter = {
  inc: (c, node, n = 1) => ({ p: gCounter.inc(c.p, node, n), n: c.n }),
  dec: (c, node, n = 1) => ({ p: c.p, n: gCounter.inc(c.n, node, n) }),
  merge: (a, b) => ({ p: gCounter.merge(a.p, b.p), n: gCounter.merge(a.n, b.n) }),
  value: (c) => gCounter.value(c.p) - gCounter.value(c.n),
};

// Three replicas count "participants in the webinar" independently while partitioned
let a = { p: {}, n: {} }, b = { p: {}, n: {} }, c = { p: {}, n: {} };
a = pnCounter.inc(a, 'A', 5);           // 5 joined via region A
b = pnCounter.inc(b, 'B', 3);           // 3 joined via region B
b = pnCounter.dec(b, 'B', 1);           // 1 left via region B
c = pnCounter.inc(c, 'C', 2);

const m1 = pnCounter.merge(pnCounter.merge(a, b), c);
const m2 = pnCounter.merge(c, pnCounter.merge(b, a));
const m3 = pnCounter.merge(pnCounter.merge(m1, m1), b);     // re-delivered state (idempotent)

// Contrast: LWW on a plain number loses concurrent increments
const lww = [{ value: 5, ts: 100 }, { value: 2, ts: 101 }, { value: 2, ts: 99 }].reduce((x, y) => (y.ts > x.ts ? y : x));

test('CRDT merge is commutative, associative and idempotent', () => {
  expect(pnCounter.value(m1)).toBe(9);
  expect(pnCounter.value(m2)).toBe(9);
  expect(pnCounter.value(m3)).toBe(9);
});
test('last-write-wins keeps one replica value and drops the others', () => {
  expect(lww.value).toBe(2);              // the true total was 5 + 2 + 2 = 9
});
```

### How does consensus work? Explain Raft at interview depth 🔥

**Consensus** gets a group of nodes to agree on a value, or on a **sequence of log entries**, despite crashes. It's the basis of **replicated state machines**: every node applies the same commands in the same order.

**Raft** (designed to be understandable; used by **etcd** and so Kubernetes, Consul, **CockroachDB**, TiKV, **Kafka KRaft**, and MongoDB's election protocol is Raft-like):

1. **Roles:** **leader**, **followers**, **candidates**. Time is divided into **terms**.
2. **Leader election:**
   - Followers expect heartbeats.
   - After a **randomised election timeout** (e.g. 150–300 ms), a follower becomes a candidate, increments the term, and asks for votes.
   - **A majority of votes wins.**
   - Each node votes once per term, and only for candidates whose log is at least as up to date as its own.
   - Randomised timeouts avoid split votes.
3. **Log replication:**
   - The leader appends client commands to its log and replicates them (`AppendEntries`).
   - An entry is **committed** once stored on a **majority**. Then it's applied and the client gets its answer.
4. **Safety:**
   - A new leader always has every committed entry, thanks to the voting rule.
   - Stale leaders from older terms are rejected because their term is lower.

**Why a majority, and why an odd number of nodes:**

- Any two majorities **intersect**, so there can't be two leaders in the same term (no **split brain**).
- 3 nodes tolerate 1 failure, and 5 tolerate 2.
- 4 nodes tolerate only 1, the same as 3, so add nodes in odd numbers.

**Costs:**

- Every write needs a **majority round trip**.
- Leader-based systems have a **leader bottleneck**.
- Cross-region consensus adds latency equal to the round trip to the nearest majority.

**Paxos** is the older, equivalent family (Chubby, Spanner). Multi-Paxos is essentially a leader plus a replicated log, like Raft.

## Replication

### Explain leader-follower replication and the problems replication lag causes 🔥

**Single-leader replication:**

- All writes go to the **leader** (primary).
- It streams changes (the WAL/binlog) to **followers** (replicas), which serve reads.

| Mode | Commit returns when | Trade-off |
|---|---|---|
| **Asynchronous** (default for Postgres and MySQL replicas, RDS read replicas) | The leader has written locally | Fast. **Followers lag**, and **a failover can lose committed writes** |
| **Synchronous** | At least one follower has persisted it | No loss on failover; higher latency; a stalled follower stalls writes (use "any 1 of N" sync) |
| **Semi-synchronous** (MySQL) | One replica has *received* it | A middle ground |

**Lag anomalies, and the fixes:**

| Anomaly | Example | Fix |
|---|---|---|
| **Read-your-writes violation** | The user updates the meeting title, the next read hits a lagging replica, and the old title shows | Read from the leader for N seconds after the user writes, for that user/entity; or wait until the replica has replayed the write's **LSN/GTID**; or update the UI optimistically |
| **Non-monotonic reads** | Two refreshes hit different replicas, so a new message appears, then disappears | **Pin each user to one replica** (hash the user id) |
| **Inconsistent prefix** | A reply visible before the question in a sharded or partitioned system | Write causally related data to the same partition; causal consistency |

**Monitoring:** `pg_stat_replication` (`replay_lag`), `SHOW REPLICA STATUS` (`Seconds_Behind_Source`), CloudWatch `ReplicaLag`. Alert on it. **Large transactions and long queries on replicas** cause lag spikes.

### How does failover work, and what can go wrong? 🔥

**Steps:**

1. **Detect** the leader's failure (missed heartbeats; timeouts are a trade-off between false positives and recovery time).
2. **Elect** a new leader: the most up-to-date replica, by consensus or by an orchestrator.
3. **Reconfigure:** clients and replicas follow the new leader (DNS or endpoint update, proxy routing).

**What goes wrong:**

- **Lost writes** with async replication: the new leader is missing the last commits. If the old leader comes back, its unreplicated writes conflict and are usually **discarded**. GitHub's 2012 incident: an out-of-date MySQL replica was promoted, and auto-increment ids it handed out again were already in use in Redis, which leaked data between users.
- **Split brain:** two nodes both believe they're the leader and accept writes. You need **fencing**: STONITH ("shoot the other node in the head"), lease-based leadership, or consensus-based election (Patroni with etcd).
- **Timeout tuning:** a GC pause or network blip triggers unnecessary failovers. Flapping is dangerous.
- **Clients holding old connections** keep writing to the old primary until they reconnect.

**Managed versions:**

| Option | How it works | Failover time / data loss |
|---|---|---|
| **RDS Multi-AZ** (instance) | A **synchronous** standby in another AZ, not readable | Automatic failover in ~60–120 s via a DNS flip; **no data loss** |
| **RDS Multi-AZ DB cluster** | Two **readable** standbys, semi-synchronous | Faster failover |
| **RDS read replicas** | **Async**, for read scaling | Promotion is manual or managed |
| **Aurora** | Shared distributed storage, 6 copies across 3 AZs | Replica promotion in ~30 s or less; no storage-level data loss |
| **Self-hosted Postgres** | **Patroni** (etcd/Consul for leader election) + HAProxy/PgBouncer | Depends on configuration |

**Application side:**

- **Retry with backoff on connection errors.**
- Use the **cluster endpoint, never an instance IP**.
- Keep DNS TTLs low; use an RDS Proxy for faster failover handling.

### When do you need multi-leader or leaderless replication?

**Multi-leader:** several nodes accept writes and replicate to each other. Use cases:

- **Multi-region writes:** each region writes locally, giving low latency and tolerating region isolation.
- **Offline-capable clients:** each device is a "leader". Mobile apps, collaborative editing, calendar sync.
- **The cost: write conflicts.** You need conflict resolution (LWW, CRDTs, app merge), and you must avoid conflicts by design: route each user's writes to their home region.

**Leaderless** (Dynamo, Cassandra, Riak):

- The client (or a coordinator) writes to N replicas directly, using quorums.
- **No failover needed.** Any replica can take writes.
- Read repair and anti-entropy heal divergence.

**Examples:**

- **DynamoDB global tables:** multi-region active-active, with **last-writer-wins** reconciliation. A newer multi-Region strong consistency mode trades latency for linearisable reads.
- **Cassandra multi-DC:** `LOCAL_QUORUM` per data centre.
- **CouchDB/PouchDB:** offline sync with conflict documents.

### Physical vs logical replication in Postgres, and what is CDC?

| | **Physical (streaming) replication** | **Logical replication / decoding** |
|---|---|---|
| Ships | WAL byte-level changes for the **whole cluster** | **Row-level changes** (INSERT/UPDATE/DELETE) per table or publication |
| Replica | Read-only, identical copy, same major version | A writable database; can differ in version, schema or indexes; selected tables |
| Uses | HA standbys, read replicas | **Zero-downtime major upgrades**, consolidating databases, **CDC** into Kafka (Debezium), syncing to search or warehouses |

**Change Data Capture (CDC):**

- Read the database's change log (Postgres logical decoding via `pgoutput`, MySQL binlog, Mongo change streams, DynamoDB Streams).
- Publish row changes as events. **No dual writes**, and it captures changes made by every client.

**Replication slot gotcha (Postgres):**

- A slot keeps WAL until the consumer confirms it.
- **If the CDC consumer dies, WAL piles up and fills the disk**, taking the primary down.
- Monitor slot lag, and set `max_slot_wal_keep_size` (PG13+).

## Partitioning & sharding

### When do you actually need to shard, and what should you try first? 🔥

**Sharding** (horizontal partitioning across servers) is powerful but expensive:

- Cross-shard queries and transactions get hard.
- Operations multiply.
- Rebalancing is risky.

**Exhaust the cheaper options first:**

1. **Optimise:**
   - Indexes and query fixes.
   - Remove N+1 patterns.
   - Connection pooling.
2. **Scale up:** bigger instances go a long way. A single modern Postgres box handles **tens of thousands of transactions per second** and many TB.
3. **Read replicas** for read-heavy load. **Caching** (Redis, CDN).
4. **Partition tables** on one node: time-based retention, pruning.
5. **Archive** cold data. **Move analytics** to a warehouse.
6. **Functional partitioning:** split databases **by service or domain** (billing DB, meetings DB, analytics DB).
7. **Only then** shard by key. Or use a **distributed SQL** database or managed sharding (Citus, Vitess, Aurora Limitless, DynamoDB) that hides much of the pain.

**Signals that sharding is necessary:**

- Write throughput beyond one primary.
- A dataset beyond one node's storage or working memory.
- Per-tenant isolation or data-residency requirements.

### What are the sharding strategies, and how do you choose a shard key? 🔥

| Strategy | How keys map to shards | Pros | Cons |
|---|---|---|---|
| **Range** | Contiguous key ranges (A–F, G–M…; dates) | Efficient **range scans**; easy to split hot ranges | **Hot spots** with sequential keys (all new writes go to the last shard) |
| **Hash** | `hash(key) mod N`, or a **consistent hash** ring | Even distribution | Range queries scatter to every shard; `mod N` reshuffles almost everything when N changes |
| **Directory / lookup** | A mapping table: tenant → shard | Flexible: move single tenants, put big tenants on dedicated shards | The directory is a critical dependency (cache it) |
| **Geo** | By region or residency | Latency and **data residency** compliance | Uneven load across regions |

**A good shard key:**

- **High cardinality and even distribution.** Not `country` (India would dominate), not `status`.
- **Most queries include it**, so queries are **single-shard**.
- **Related data shares it**, so joins and transactions stay on one shard (**co-location**).
- **Doesn't change** for an entity. Moving a row between shards is painful.

**For multi-tenant SaaS:** shard by **`tenant_id`**.

- Nearly all queries are tenant-scoped.
- All of a tenant's tables co-locate (Citus "distributed tables" by tenant).
- **Large tenants** can get dedicated shards through a directory.
- **Cross-tenant analytics** go to a warehouse.

### Implement consistent hashing, and explain virtual nodes 🔥

**The problem with `hash(key) mod N`:** changing N (adding a server) **remaps almost every key**, causing a cache cold start or massive data movement.

**Consistent hashing:**

- Place **nodes on a hash ring** (0 … 2³²).
- A key belongs to the **first node clockwise** from its hash.
- **Adding or removing a node moves only the keys in its arc**, about **1/N** of the keys.

**Virtual nodes (vnodes):**

- Each physical node appears at **many points** (e.g. 100–256) on the ring.
- This **smooths the distribution**: without vnodes, three random points split the ring very unevenly.
- When a node leaves, its load **spreads across all the remaining nodes**, not just one neighbour.
- Heterogeneous hardware gets more or fewer vnodes.

**Used by:** DynamoDB/Dynamo, Cassandra, Riak, memcached client libraries (ketama), load balancers (Envoy ring hash, Maglev), and CDNs.

```js
// Consistent hashing ring with virtual nodes vs naive mod-N
function hash32(str) {                                   // FNV-1a + murmur3 finaliser for good spread
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}

class HashRing {
  constructor(vnodes = 100) { this.vnodes = vnodes; this.points = []; }
  add(node) {
    for (let v = 0; v < this.vnodes; v++) this.points.push({ h: hash32(`${node}#${v}`), node });
    this.points.sort((a, b) => a.h - b.h);
  }
  remove(node) { this.points = this.points.filter((p) => p.node !== node); }
  get(key) {
    const h = hash32(key);
    let lo = 0, hi = this.points.length;                 // first point with p.h >= h (binary search)
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.points[mid].h < h) lo = mid + 1; else hi = mid; }
    return this.points[lo === this.points.length ? 0 : lo].node;   // wrap around the ring
  }
}

const keys = Array.from({ length: 20_000 }, (_, i) => `meeting:${i}`);
const ring = new HashRing(150);
['db-a', 'db-b', 'db-c'].forEach((n) => ring.add(n));
const before = new Map(keys.map((k) => [k, ring.get(k)]));

const load = {};
for (const n of before.values()) load[n] = (load[n] ?? 0) + 1;

ring.add('db-d');                                         // scale out
const movedRing = keys.filter((k) => ring.get(k) !== before.get(k)).length / keys.length;

const modN = (k, n) => hash32(k) % n;
const movedMod = keys.filter((k) => modN(k, 3) !== modN(k, 4)).length / keys.length;

console.log({ load, movedRing: movedRing.toFixed(3), movedMod: movedMod.toFixed(3) });

test('virtual nodes spread keys roughly evenly', () => {
  for (const count of Object.values(load)) {
    expect(count / keys.length).toBeGreaterThan(0.25);
    expect(count / keys.length).toBeLessThan(0.42);
  }
});
test('adding a 4th node moves ~1/4 of keys on the ring, ~3/4 with mod-N', () => {
  expect(movedRing).toBeLessThan(0.35);
  expect(movedMod).toBeGreaterThan(0.6);
});
test('removing a node only moves the keys it owned', () => {
  const owned = keys.filter((k) => ring.get(k) === 'db-d');
  const snapshot = new Map(keys.map((k) => [k, ring.get(k)]));
  ring.remove('db-d');
  const moved = keys.filter((k) => ring.get(k) !== snapshot.get(k));
  expect(moved.length).toBe(owned.length);
});
```

### How do you deal with hot partitions and the "celebrity" problem?

**A hot partition** happens when one shard key receives a disproportionate share of traffic: a viral post, a huge tenant, today's date as the key, or one webinar with 50,000 attendees.

| Fix | How |
|---|---|
| **Better key choice** | Avoid monotonic or low-cardinality keys. Use a composite key, e.g. `(tenant, entity id)` instead of `date` |
| **Key salting / write sharding** | Append a random suffix `0..k-1` to hot keys (`webinar#42#7`). Writes spread over k partitions; reads **scatter-gather** k keys and merge them |
| **Caching** | Absorb hot **reads** in Redis or a CDN |
| **Dedicated shards** | Move the "celebrity" tenant to its own shard (via a directory) |
| **Split hot ranges** | Range-sharded systems split busy ranges automatically (DynamoDB adaptive capacity and partition splitting, Bigtable, CockroachDB) |
| **Batch or aggregate** | Buffer increments and write aggregates instead of one write per event |

**DynamoDB specifics:**

- Each partition handles **~3,000 RCU / 1,000 WCU**.
- **Adaptive capacity** shifts throughput to hot partitions and isolates hot items.
- But a single item still can't exceed per-partition limits. **Sharded counters** are the fix.

### How do you handle cross-shard queries, global indexes and resharding? 🔥

**Cross-shard queries:**

- **Scatter-gather:** send to every shard and merge (sorting, limits, aggregates). Latency is that of the slowest shard, so the tail latency gets worse.
- **Avoid them by design:** co-locate by shard key; denormalise into **per-query tables**; send analytics to a warehouse.

**Secondary indexes in a sharded database:**

| Type | How | Trade-off |
|---|---|---|
| **Local (document-partitioned)** | Each shard indexes its own data | Writes stay local; **reads by index scatter to every shard** (DynamoDB LSI, MongoDB, Elasticsearch) |
| **Global (term-partitioned)** | The index itself is partitioned by the indexed value | Reads hit one index partition; **writes update a remote index**, usually **asynchronously** (DynamoDB GSIs are eventually consistent) |

**Cross-shard transactions:**

- These need 2PC or a distributed SQL engine.
- Otherwise, use **sagas** and design aggregates to live on one shard. See [Transactions & Locking](/docs/db-transactions-locking).

**Resharding (rebalancing):**

- **Never use `mod N` on physical nodes.**
- Create **many fixed logical partitions** up front (1,024 or 4,096) and map them to physical nodes. Rebalancing then **moves whole partitions**: Kafka partitions, Elasticsearch shards, Vitess/Citus shards, Cassandra vnodes.
- **Online moves:**
  1. Copy the data.
  2. Stream the changes (CDC).
  3. Cut over the routing briefly.
  4. Verify.
- Vitess and Citus automate this.

### What are distributed SQL (NewSQL) databases, and when would you use one? 🔥

**Distributed SQL** systems shard and replicate automatically (typically **Raft per range**), and still offer **SQL with ACID transactions across shards**.

| System | Notes |
|---|---|
| **Google Spanner** | TrueTime gives external consistency; global scale; Cloud Spanner |
| **CockroachDB** | Postgres wire-compatible; **serializable by default**; geo-partitioning (pin rows to regions); HLC clocks |
| **YugabyteDB** | Reuses the Postgres query layer on a distributed storage engine (DocDB, Raft) |
| **TiDB** | MySQL-compatible; TiKV storage plus TiFlash columnar storage for HTAP |
| **Aurora DSQL** (AWS) | Serverless, Postgres-compatible, multi-region active-active, **optimistic concurrency** (conflicts abort at commit) |

**Sharding layers over existing engines:**

- **Vitess:** MySQL sharding from YouTube; used by Slack and others; PlanetScale is built on it.
- **Citus:** a Postgres extension that distributes tables by a column, with co-located joins.

**Not distributed SQL, but often confused with it:** **Aurora**. Its single writer sits over distributed, replicated storage. It scales reads, durability and storage, not writes, except with Aurora Limitless sharding.

**When to choose distributed SQL:**

- You need **horizontal write scale or multi-region writes** *and* relational transactions.
- Example: a global SaaS with data-residency rules.

**Costs:**

- Higher per-transaction latency (consensus round trips).
- Some Postgres features missing.
- Operational and licensing complexity.
- **Most apps don't need it.** A well-tuned single primary with replicas goes very far.

## Storage engines

### B-tree vs LSM-tree storage engines: what are the trade-offs? 🔥

| | **B-tree** (Postgres, MySQL InnoDB, SQL Server, Oracle) | **LSM tree** (RocksDB, LevelDB, Cassandra, ScyllaDB, HBase, Bigtable; MyRocks; DynamoDB-like stores) |
|---|---|---|
| Writes | **In place** (page updates) + WAL; random I/O | **Append-only**: WAL + in-memory **memtable**, flushed as immutable sorted **SSTables**; sequential I/O |
| Reads | One tree traversal: predictable, fast | Check the memtable, then possibly several SSTables (**Bloom filters** skip most) |
| **Write amplification** | Rewrites whole pages for small changes | **Compaction** rewrites data repeatedly |
| **Read amplification** | Low | Higher (several levels) |
| **Space amplification** | Fragmentation, bloat | Old versions and tombstones until compaction |
| Best for | Read-heavy, transactional, range-heavy workloads | **Write-heavy**: time-series, logs, messaging, metrics, IoT |

**Compaction strategies:**

- **Size-tiered** merges similarly sized SSTables. It's write-friendly but uses more space and reads more files.
- **Leveled** keeps non-overlapping files per level. It's read- and space-friendly but writes more. RocksDB's default.
- Cassandra 5 introduces the Unified Compaction Strategy.

**Deletes in LSM trees** write **tombstones**, which are removed only during compaction. A delete-heavy workload causes slow reads and space bloat, the classic Cassandra pain point.

```js
// Mini LSM tree: memtable → immutable sorted SSTables → compaction (with tombstones)
const TOMBSTONE = Symbol('tombstone');

class MiniLSM {
  constructor(memtableLimit = 3) { this.limit = memtableLimit; this.memtable = new Map(); this.sstables = []; this.lastReadCost = 0; }
  put(key, value) { this.memtable.set(key, value); if (this.memtable.size >= this.limit) this.flush(); }
  delete(key) { this.put(key, TOMBSTONE); }                           // a delete is just another write
  flush() {
    const sorted = [...this.memtable.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    this.sstables.unshift(sorted);                                     // newest SSTable first
    this.memtable = new Map();
  }
  get(key) {
    this.lastReadCost = 1;
    if (this.memtable.has(key)) return this.resolve(this.memtable.get(key));
    for (const table of this.sstables) {                               // newest → oldest
      this.lastReadCost++;
      const hit = table.find(([k]) => k === key);                      // (real engines: Bloom filter + binary search)
      if (hit) return this.resolve(hit[1]);
    }
    return undefined;
  }
  resolve(v) { return v === TOMBSTONE ? undefined : v; }
  compact() {                                                          // merge all SSTables, newest wins, drop tombstones
    const merged = new Map();
    for (const table of [...this.sstables].reverse()) for (const [k, v] of table) merged.set(k, v);
    const live = [...merged.entries()].filter(([, v]) => v !== TOMBSTONE).sort(([a], [b]) => (a < b ? -1 : 1));
    this.sstables = live.length ? [live] : [];
  }
}

const db = new MiniLSM(3);
db.put('m1', 'Standup'); db.put('m2', 'Webinar'); db.put('m3', 'Retro');      // flush #1
db.put('m1', 'Daily standup'); db.delete('m2'); db.put('m4', 'Demo');         // flush #2
db.put('m5', 'Planning');

test('newest version wins and tombstones hide deleted keys', () => {
  expect(db.get('m1')).toBe('Daily standup');
  expect(db.get('m2')).toBeUndefined();
  expect(db.get('m3')).toBe('Retro');
  expect(db.sstables).toHaveLength(2);
});
test('reads may touch several SSTables (read amplification)', () => {
  db.get('m3');
  expect(db.lastReadCost).toBe(3);        // memtable → sstable#2 → sstable#1
});
test('compaction merges tables and physically removes tombstones', () => {
  db.compact();
  expect(db.sstables).toHaveLength(1);
  expect(db.sstables[0].map(([k]) => k)).toEqual(['m1', 'm3', 'm4']);
  db.get('m3');
  expect(db.lastReadCost).toBe(2);
});
```

### What are the write-ahead log and checkpoints, and how does crash recovery work?

**Write-ahead logging (WAL):** before a data page change is written to disk, a **log record** describing it is appended to the WAL and **fsynced at commit**.

**Why it works:**

- Appending to a log is sequential and fast.
- Data pages can be written lazily, in batches, later.
- **Crash recovery = replay the WAL** from the last checkpoint, redoing committed changes.
- **Checkpoints** periodically flush dirty pages so that recovery doesn't have to replay too much. Checkpoint spikes are why `max_wal_size` and `checkpoint_timeout` exist.
- **Group commit** batches the fsyncs of many concurrent transactions.

**The same log powers replication** (shipping WAL to replicas), **PITR** (archiving WAL), and **CDC** (logical decoding of WAL).

**The general pattern is "log first, then state":**

- Kafka is a durable log.
- Event sourcing makes the log the source of truth.
- Raft replicates a log.

Recognising this pattern across systems is a strong senior signal.

## Data architecture patterns

### What is CQRS, and when is it worth it? 🔥

**CQRS (Command Query Responsibility Segregation)** separates the **write model** (commands: validate, enforce invariants, normalised) from one or more **read models** (queries: denormalised, shaped for each screen).

```text
Commands → [Write model: Postgres, normalised] → events/CDC → [Read models: Redis view, OpenSearch index, analytics table]
Queries  ←───────────────────────────────────────────────────────────── read models
```

**Benefits:**

- Each side scales and is optimised independently.
- Read models are tailored per use case: search, dashboards, feeds.
- Complex domains keep their write logic clean.

**Costs:**

- **Eventual consistency between the write side and the read side.** The UI must handle "I just saved but the list doesn't show it yet".
- More moving parts: projections, rebuilds, monitoring of projection lag.

**Use it when** read and write patterns differ hugely, for example a high-read dashboard over a complex transactional core, or when you need several specialised read stores. **Don't use it** for simple CRUD apps.

**A light version is common and fine:** the same database, but separate query services or SQL views for reads. That's CQRS without separate stores.

### What is event sourcing? Pros, cons and pitfalls 🔥

**Event sourcing** stores **every state change as an immutable event**: `MeetingScheduled`, `ParticipantJoined`, `RecordingStarted`, `MeetingEnded`. Current state is derived by **replaying** the events. Read models (**projections**) are built from the event stream.

**Pros:**

- A **complete audit history**, because events are facts.
- **Time travel:** state at any point.
- **New projections** can be built later by replaying.
- A natural fit with event-driven microservices.
- Debugging by replay.

**Cons and pitfalls:**

- **Complexity**, and an unfamiliar model for teams.
- **Event schema evolution:** old events live forever, so you need versioning and **upcasters**.
- **Replays get slow**, so you need **snapshots** every N events.
- **Querying current state** needs projections, so reads are eventually consistent.
- **GDPR erasure versus immutable events:** use crypto-shredding (encrypt PII per user and delete the key) or keep PII out of events.
- **Side effects must not re-run on replay** (don't resend emails).

**Event sourcing vs CDC:**

| | Event sourcing | CDC |
|---|---|---|
| The source of truth | The events | The current-state tables |
| Event content | **Domain events** with business meaning | **Row changes**: "row changed", not "why" |

**When to use event sourcing:** ledgers and payments, audit-critical domains, complex workflows. Many teams get most of the benefit with **"state tables + outbox events + audit log"** instead.

### How would you design a multi-region data architecture? 🔥

**Why multi-region:**

- Latency for global users.
- **Disaster recovery** (a region outage).
- **Data residency** (EU or India data stays in-region).

| Pattern | Writes | Reads | Failover | Complexity |
|---|---|---|---|---|
| **Backup and restore** in another region | — | — | Hours (restore) | Low |
| **Active-passive (pilot light / warm standby)** | One primary region | Primary (+ local replicas) | Promote the standby region: minutes. **RPO = replication lag** | Medium |
| **Active-active with home regions** | Each user or tenant writes in **their home region**; replicated elsewhere for reads | Local | Re-home users | Medium-high |
| **Active-active, multi-writer** | Any region | Local | Instant | **High**: conflicts (LWW/CRDT) or global consensus latency |

**AWS building blocks:**

- **Aurora Global Database:** typical cross-region lag under a second, with managed failover and switchover.
- **DynamoDB global tables:** active-active, LWW, with an optional strong-consistency mode.
- **S3 Cross-Region Replication.**
- **Route 53** latency and failover routing.
- **CloudFront.**

**Design rules:**

1. **Partition by geography where possible.** Tenants and users have a home region, so most writes stay local and **conflicts are rare by design**.
2. Keep **globally unique constraints** (usernames, payments) in **one authoritative region**, or a globally consistent store.
3. **Test failover regularly.** An untested DR plan doesn't work.
4. Remember the **stateful satellites**: caches, queues, search indexes, secrets and object storage all need a regional story.

**Real-time media is regional too.** WebRTC SFUs (JVBs) are placed near users, while the signalling and metadata database can be global or home-region based. This makes a natural MeetHour talking point.

### How does DynamoDB work under the hood? 🔥

From AWS's published design (the USENIX ATC 2022 paper) and the documentation:

**Partitioning:**

- Each table is split into **partitions** by the **hash of the partition key**.
- Within a partition, items are sorted by sort key, which enables `Query` with key conditions.
- Partitions **split automatically** as size (~10 GB) or throughput grows.

**Replication:**

- Each partition is a **replication group of 3 replicas across 3 AZs**, using **Multi-Paxos** with a **leader**.
- A write is acknowledged once the leader and **a quorum (2 of 3)** have persisted it in their logs.

**Reads:**

- **Eventually consistent reads** (the default, half the price) can go to **any replica**, so they may be slightly stale.
- **Strongly consistent reads** go to the **leader**.

**Throughput:**

- Each partition handles about **3,000 RCU / 1,000 WCU**.
- **Adaptive capacity** rebalances throughput toward hot partitions and can isolate hot items.
- **On-demand mode** scales automatically (it pre-warms based on previous peaks).

**Indexes:**

- **GSIs** are separate partitioned tables, updated **asynchronously**, so GSI reads are always eventually consistent.
- **GSI throttling can back-pressure the base table's writes.**
- **LSIs** share the base table's partitions and allow strong reads, but impose a **10 GB per partition-key limit**. They must be created with the table.

**Streams, global tables and items:**

- **DynamoDB Streams** offers an ordered change log per partition key, retained for 24 h. It powers CDC, Lambda triggers and global tables.
- **Item limit:** 400 KB. Use S3 pointers for large payloads.

**What this means for design (Nebraska Draw / SCAI-style):**

- Choose high-cardinality partition keys.
- Know your access patterns up front: single-table design and GSIs.
- Use conditional writes for invariants.
- Use streams for side effects and search sync.

### How do you choose a database for a new system? 🔥

A decision framework to reason through out loud:

1. **Data shape and relationships:**
   - Relational with integrity needs: **Postgres**.
   - Aggregates read as a whole: a document store.
   - Graph traversals: a graph database.
2. **Query patterns:**
   - Ad-hoc, reporting and evolving: SQL.
   - Fixed key-based access at massive scale: DynamoDB or Cassandra.
   - Full text: a search engine.
   - Similarity: a vector index.
3. **Consistency needs per operation:** money and inventory need strong consistency (transactions, constraints). Feeds and counters can be eventual.
4. **Scale and latency targets:**
   - Requests per second, data size and growth.
   - p99 latency.
   - Multi-region requirements.
5. **Operational model:**
   - Managed or serverless (DynamoDB, Aurora Serverless, Atlas)?
   - Team expertise.
   - Cost model: provisioned vs per-request.
6. **Ecosystem:** ORMs, migrations, backup/PITR, observability, compliance (encryption, residency).

**A strong default answer:**

- "**Start with Postgres** as the system of record, because it covers relational data, JSONB, full-text search, pgvector and partitioning."
- "Add **Redis** for caching and coordination, **S3** for files, and **OpenSearch** if search grows complex."
- "**DynamoDB** when the workload is serverless with known access patterns, or needs effortless scale. I used it this way on Nebraska Draw."
- "**Specialise only when a measured requirement demands it.**"

*[Make the DynamoDB reference concrete with what you actually did — table design, GSIs, conditional writes.]*
