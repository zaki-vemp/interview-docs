# SQL Scalability, Query Efficiency & High-Scale Coding Patterns

In almost every mid-level, senior, and staff interview, writing a syntactically *correct* SQL query is only **half the score**. Immediately after your query returns the right rows, the interviewer asks:

- *"What happens to this query when `orders` grows from 10,000 rows to **500 million rows**?"*
- *"Which exact composite index supports this `WHERE` + `ORDER BY` + `LIMIT`, and in what column order?"*
- *"How do we scale this database from **500 RPS to 200,000 RPS** without losing ACID guarantees?"*
- *"Can you rewrite this correlated subquery / multi-self-join into a **single table pass**?"*

This guide gives you the complete **Query Efficiency Rewrite Playbook**, the **Relational Scaling Ladder**, and **High-Signal Live SQL Coding Drills** with **both PostgreSQL and MySQL 8.0+ solutions**.

> Three core scalability algorithms — **Composite Index ESR + Deferred Join I/O math**, **Overlapping Interval Merging (`MAX() OVER` island detection)**, and **Slotted Hot-Row Counters + LSN/GTID Read-Your-Own-Writes Replica Routing** — are built as **runnable JavaScript simulations with tests** below.

---

## Query efficiency & rewrite playbook

### Why is `SELECT COUNT(*)` slow on 100M+ rows in PostgreSQL and MySQL, and what are the 4 production replacements? 🔥

Beginners assume databases store a magic `row_count` variable per table. **MVCC makes that impossible!** Because Transaction A (started 10s ago) and Transaction B (started 1ms ago) can legally see **different numbers of live rows** simultaneously, **neither PostgreSQL nor MySQL InnoDB can answer exact `SELECT COUNT(*) FROM orders` in $O(1)$**:

- **PostgreSQL:** Scans the entire heap — or performs an **Index-Only Scan** on the smallest index, consulting the Visibility Map (dropping down to 8 KB heap pages for any recently dirtied page whose All-Visible bit is `0`). On 200M rows, that still takes **hundreds of milliseconds to several seconds**.
- **MySQL InnoDB:** Picks the **narrowest secondary index** (smaller than the clustered PK!) and counts every visible leaf entry, chasing undo logs for concurrently modified pages — also **seconds** on 200M rows! *(Only legacy lock-the-world MyISAM cached an exact table count.)*

**The 4 production replacements interviewers want to hear:**

| Requirement | Replacement Pattern | Latency on 500M rows |
|---|---|---|
| **1. Approximate total ("~482M results" in admin UI)** | Query planner catalog stats!<br>**Postgres:** `SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.orders'::regclass;`<br>**MySQL:** `SELECT table_rows FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'orders';` | **`< 1 ms`** ($O(1)$ catalog read!) |
| **2. Bounded pagination UI ("1–20 of 10,000+")** | Cap the count inside a bounded subquery so the engine stops scanning at `10,001`:<br>`SELECT COUNT(*) FROM (SELECT 1 FROM orders WHERE status = 'paid' LIMIT 10001) sub;` | **`~2–5 ms`** (reads at most 10,001 index entries!) |
| **3. Exact per-tenant / dashboard badge counter** | Maintain a **summary counter table** (`tenant_stats(tenant_id, order_count)`) updated via transactional deltas / batched triggers / outbox consumer | **`< 1 ms`** PK lookup |
| **4. Distinct cardinality (`COUNT(DISTINCT user_id)` over billions of events)** | **HyperLogLog** (`postgresql-hll` extension in PG, `PFADD`/`PFCOUNT` in Redis, or `APPROX_COUNT_DISTINCT` in warehouses — ~0.8% error in 1.5–12 KB of state!) | **Milliseconds** |

### Complete SARGability rewrite playbook: turn index-blind `WHERE` clauses into B-tree lookups 🔥

A predicate is **SARGable (*Search ARGument ABLE*)** when the database can compare an **unwrapped indexed column** directly against a constant/parameter (`indexed_col <op> value`). Wrapping the column in a function, arithmetic, or implicit cast forces evaluating that expression on **every row**!

| Anti-pattern (✗ Full Scan) | SARGable Rewrite (✓ Index Range / Seek) | Alternative Index Option |
|---|---|---|
| `WHERE YEAR(created_at) = 2026` (MySQL)<br>`WHERE EXTRACT(YEAR FROM created_at) = 2026` (PG) | `WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'` | Functional index (still worse than naked range rewrite!) |
| `WHERE DATE(created_at) = '2026-10-27'` | `WHERE created_at >= '2026-10-27' AND created_at < '2026-10-28'` | — |
| `WHERE price * 1.18 > 1000` | `WHERE price > 1000 / 1.18` (isolate the column!) | — |
| `WHERE LOWER(email) = 'zaki@co.com'` | Keep query + create **expression/functional index**:<br>PG: `CREATE INDEX ON users (LOWER(email));`<br>MySQL 8+: `CREATE INDEX idx ON users ((LOWER(email)));` | Or `CITEXT` / deterministic case-insensitive collation (`utf8mb4_0900_ai_ci`) |
| `WHERE COALESCE(status, 'pending') = 'pending'` | `WHERE status = 'pending' OR status IS NULL` (both branches use B-tree on `status`!) | Partial index `WHERE status IS NULL` |
| `WHERE name LIKE '%zaki%'` | Prefix search if UX allows (`LIKE 'zaki%'`), or **GIN trigram index** (`pg_trgm` in PG) / `FULLTEXT` index | Elasticsearch / OpenSearch at scale |
| `WHERE customer_id = 42 OR seller_id = 42` | Rewrite into **`UNION`** (or `UNION ALL` with `AND customer_id IS DISTINCT FROM 42` on branch 2!) so each branch does a clean 3-ms index seek instead of Bitmap OR / Full Scan! | — |
| `WHERE varchar_code = 10042` (MySQL!) | Always pass typed string `'10042'`! Comparing `VARCHAR` to `INT` in MySQL casts every row's string to `DOUBLE`, killing the index! | Strict parameter typing in ORM / driver |

### The ESR rule (`Equality → Sort → Range`) for composite indexes — and why "most selective first" is a myth! 🔥

One of the **most repeated myths** online is *"always put the highest-cardinality column first in a composite index."* Here is why that fails in real interviews:

Suppose your endpoint runs:
```sql
SELECT id, total, created_at
FROM orders
WHERE status = 'paid'                 -- Equality (=) — low cardinality (5 statuses)
  AND total >= 500.00                 -- Range (>=)   — high cardinality
ORDER BY created_at DESC              -- Sort
LIMIT 20;
```

- **Once a B-tree encounters a RANGE condition (`>`, `<`, `BETWEEN`, `LIKE 'a%'`), all columns to the RIGHT of that range column are NO LONGER globally sorted!**
  - If you build `INDEX (total, status, created_at DESC)` ("most selective first"): the B-tree seeks `total >= 500`, then must **scan every order ≥ $500 across all statuses**, filter `status = 'paid'`, and **sort tens of thousands of rows (`filesort` / `Sort`)** to find the newest 20!
  - If you follow **ESR (`Equality → Sort → Range`)** and build **`INDEX (status, created_at DESC, total)`** (or `INCLUDE (id)`):
    1. **E (`status = 'paid'`):** Jumps straight to the `'paid'` slice of the B-tree.
    2. **S (`created_at DESC`):** Within `'paid'`, entries are **already physically ordered newest-first**!
    3. **R (`total >= 500`):** Walks backward from newest `'paid'` orders, checks `total >= 500` **inside the index leaf** (zero heap hops if covering!), and **stops the instant it collects 20 rows**!

*(What if there is NO `ORDER BY`, just `WHERE a = ? AND b = ?`? For multiple **Equality** columns, order between `a` and `b` doesn't change total leaf entries scanned for that query — so put first whichever column is **also queried standalone** like `tenant_id`, so one composite index serves both `WHERE tenant_id = ?` AND `WHERE tenant_id = ? AND status = ?`!)*

### Deep pagination at 10M+ rows: Keyset Cursors AND Deferred Joins (Late Row Lookups) 🔥

Why does `SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET 200000;` take **4+ seconds**? Because the DB must fetch, detoast/bookmark-lookup, and materialize **200,020 full wide rows** just to throw **200,000** away!

**Solution 1 (Best — $O(\log N)$ constant 1 ms at page 1 or page 500,000): Keyset / Seek Pagination**
Encode the last item of the previous page `(last_created_at, last_id)` as an opaque cursor:
```sql
-- Row-value comparison works natively in BOTH PostgreSQL AND MySQL 8.0+ using INDEX (created_at DESC, id DESC)
-- (or ASC/ASC; for mixed ASC/DESC write explicit compound OR: created_at < $1 OR (created_at = $1 AND id < $2))
SELECT id, customer_id, total, created_at
FROM orders
WHERE (created_at, id) < ('2026-10-01 12:00:00', 984512)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**Solution 2 (When product UX strictly demands "Jump to Page 5,000" numbers!): Deferred Join (Late Row Lookup)**
Do the `OFFSET 200000 LIMIT 20` inside a **narrow Covering Index-Only subquery** (zero heap / clustered-PK bookmark lookups for the skipped 200,000 rows!), then join back to `orders` for **only the 20 winning `id`s** — **10×–30× faster** in both MySQL and PostgreSQL:
```sql
SELECT o.id, o.customer_id, o.status, o.total, o.notes, o.created_at
FROM (
  -- Pure Index-Only Scan on idx_orders_created_id (created_at DESC, id DESC): skips 200,000 tiny 16-byte keys in RAM!
  SELECT id
  FROM orders
  ORDER BY created_at DESC, id DESC
  LIMIT 20 OFFSET 200000
) AS page_ids
JOIN orders o ON o.id = page_ids.id
ORDER BY o.created_at DESC, o.id DESC;
```

Run the interactive benchmark model below to compare exact index entries + random heap/PK lookups across Naive Index, ESR Index, Naive `OFFSET`, and Deferred Join:

```js
// Simulates B-tree leaf traversal & heap/clustered-PK lookups for ESR vs Non-ESR and Offset vs Deferred Join
const dataset = Array.from({ length: 5000 }, (_, i) => ({
  id: i + 1,
  status: i % 5 === 0 ? 'paid' : 'shipped',       // 20% 'paid' (1,000 rows)
  total: ((i * 73) % 1000) + 100,                 // ~60% >= 500
  created_at: 1_700_000_000 + i * 60,             // monotonic
}));

// Non-ESR index sorted by (total DESC, status, created_at DESC)
function runNonEsrLimit20(rows) {
  const idx = [...rows].sort((a, b) => b.total - a.total || a.status.localeCompare(b.status) || b.created_at - a.created_at);
  let indexEntriesScanned = 0;
  const candidates = [];
  for (const r of idx) {
    if (r.total < 500) break; // stops at range boundary, BUT had to read ALL total>=500 rows first!
    indexEntriesScanned++;
    if (r.status === 'paid') candidates.push(r);
  }
  candidates.sort((a, b) => b.created_at - a.created_at); // Extra filesort!
  return { resultIds: candidates.slice(0, 20).map((r) => r.id), indexEntriesScanned, neededFilesort: true };
}

// ESR index sorted by (status, created_at DESC, total) -> stops as soon as 20 rows match!
function runEsrLimit20(rows) {
  const idx = [...rows].sort((a, b) => a.status.localeCompare(b.status) || b.created_at - a.created_at || b.total - a.total);
  let indexEntriesScanned = 0;
  const out = [];
  const start = idx.findIndex((r) => r.status === 'paid');
  for (let i = start; i < idx.length && idx[i].status === 'paid'; i++) {
    indexEntriesScanned++;
    if (idx[i].total >= 500) {
      out.push(idx[i].id);
      if (out.length === 20) break; // Early termination! Zero sort!
    }
  }
  return { resultIds: out, indexEntriesScanned, neededFilesort: false };
}

function paginationHeapFetches({ offset, limit, deferredJoin }) {
  return deferredJoin ? limit : offset + limit;
}

const nonEsr = runNonEsrLimit20(dataset);
const esr = runEsrLimit20(dataset);
console.log('Non-ESR scanned entries:', nonEsr.indexEntriesScanned, '| filesort:', nonEsr.neededFilesort);
console.log('ESR     scanned entries:', esr.indexEntriesScanned, '| filesort:', esr.neededFilesort);
console.log(
  'OFFSET 4000 LIMIT 20 heap fetches -> Naive:',
  paginationHeapFetches({ offset: 4000, limit: 20, deferredJoin: false }),
  'vs Deferred Join:',
  paginationHeapFetches({ offset: 4000, limit: 20, deferredJoin: true }),
);

test('ESR index returns identical top-20 results while scanning ~90x fewer entries with zero filesort', () => {
  expect(esr.resultIds).toEqual(nonEsr.resultIds);
  expect(esr.neededFilesort).toBe(false);
  expect(esr.indexEntriesScanned).toBeLessThan(45);
  expect(nonEsr.indexEntriesScanned).toBeGreaterThan(2500);
});

test('Deferred join reduces random full-row fetches from 4,020 down to 20', () => {
  expect(paginationHeapFetches({ offset: 4000, limit: 20, deferredJoin: false })).toBe(4020);
  expect(paginationHeapFetches({ offset: 4000, limit: 20, deferredJoin: true })).toBe(20);
});
```

### Correlated subquery vs Pre-aggregated CTE vs Window function vs `LATERAL`: which wins when? 🔥

| Strategy | Best scenario | Complexity / Plan |
|---|---|---|
| **Pre-aggregated CTE / Derived Table + `JOIN`** | Summarising **all / most** groups across the whole table (`orders` aggregated per `customer_id` joined to `customers` with no tiny filter) | **1 Hash Aggregate + 1 Hash Join** — scans `orders` once instead of 1M index probes! |
| **`LATERAL` Join** (`CROSS/LEFT JOIN LATERAL (... LIMIT 3)`) | Outer query filters down to a **small set of parents** (e.g. 25 customers on the current UI page), and you want the **top 3 orders per customer** using an index on `(customer_id, created_at DESC)` | **25 tiny B-tree seeks ($\approx 1\text{ ms}$ total!)** — beats a Window Function (`ROW_NUMBER() OVER`) if the window would otherwise scan 50M orders of *other* customers! |
| **Window Function (`ROW_NUMBER()` / `SUM() OVER`)** | Analytical query already processing **the entire filtered dataset** where you need both detail columns AND group rankings/running totals in **one single scan** | **1 scan + 1 WindowAgg** (replaces self-joins & correlated scans that read the table twice!) |
| **`EXISTS` / `NOT EXISTS`** | Filtering parents by whether **at least one** child row matches ("customers who placed an order in 2026") | **Semi-join / Anti-join** — stops probing `orders` on the **very first match** per customer and **never duplicates parent rows**! |

### Eliminating `DISTINCT` abuse and `OR`-join catastrophes 🔥

```sql
-- ✗ SLOW & BUG-PRONE: Joining 1-to-many just to filter, then slapping DISTINCT to hide duplicate customers!
SELECT DISTINCT c.id, c.name, c.email
FROM customers c
JOIN orders o ON o.customer_id = c.id
WHERE o.created_at >= '2026-01-01';

-- ✓ FAST & CLEAN: Semi-join with EXISTS — zero duplicate inflation, zero final deduplication sort!
SELECT c.id, c.name, c.email
FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.customer_id = c.id
    AND o.created_at >= '2026-01-01'
);
```

And **never** write `LEFT JOIN b ON a.x = b.x OR a.y = b.y` — neither PostgreSQL nor MySQL can run a Hash Join or Merge Join on an `OR` join condition, collapsing to an **$O(N \times M)$ Nested Loop**! Split into two separate `LEFT JOIN`s (`b1 ON a.x = b1.x`, `b2 ON a.y = b2.y` + `COALESCE(b1.val, b2.val)`) or `UNION` two equijoin branches.

---

## High-throughput writes, contention & safe data lifecycle

### Bulk data ingestion at 100k+ rows/sec: multi-row `INSERT` vs `UNNEST` vs `COPY` / `LOAD DATA` 🔥

Ranked slowest → fastest when loading 1,000,000 rows:

1. **1,000,000 single-row `INSERT`s in autocommit mode (Worst — ~2–10 minutes!):** 1M network round-trips + 1M parser/planner runs + **1M WAL/redo `fsync`s**!
2. **Batched multi-row `INSERT`s of 500–2,000 rows per statement (~10–25s):** Cuts round-trips and `fsync`s by 1,000×. *(Don't send 500,000 rows in a single `INSERT` SQL string — hits MySQL `max_allowed_packet`, bloats SQL parser AST RAM, and holds row locks too long!)*
3. **PostgreSQL `INSERT ... SELECT * FROM UNNEST($1::bigint[], $2::text[], ...)` (~4–8s):** Passes parallel typed arrays as **only 3–5 bind parameters** (never hits Postgres's **65,535 bind-parameter limit** that trips ORMs on large multi-row inserts, and reuses 1 cached generic plan!).
4. **Native bulk loaders — Postgres `COPY tbl FROM STDIN (FORMAT BINARY)` / MySQL `LOAD DATA INFILE` (~1–3s!):** Bypasses SQL value parsing completely and streams directly into storage pages. *(For initial bulk loads into a brand-new table: load into an unindexed table first, then build indexes once at the end — building a B-tree via bulk sort is 5–10× faster and more compact than incremental inserts!)*

### How do you delete or archive 100 million old rows in live production without locking the table or spiking replica lag? 🔥

**Never run `DELETE FROM audit_logs WHERE created_at < '2025-01-01';` in one statement!** It holds row locks on 100M rows for 30 minutes, generates 50+ GB of WAL / Undo / Binlog in a single burst, prevents `VACUUM` from reclaiming anything if it rolls back, and causes **10+ minutes of read-replica lag**!

**Three production-grade strategies (ranked best → fallback):**

1. **Best ($O(1)$, zero I/O): Partitioning + `DROP` / `DETACH PARTITION`:** If monthly partitioned by `created_at`, dropping `audit_logs_2024_12` takes **5 milliseconds** with zero dead tuples and zero binlog row flood!
2. **Chunked Batched Deletes in a background loop (`1,000–5,000` rows per tx + adaptive sleep):**
   - Check replica lag between batches; sleep `50–200 ms` so OLTP queries and `autovacuum` / InnoDB purge keep up!

```pgsql
-- PostgreSQL chunked batch delete (uses PK index, skips locked rows so OLTP never blocks!)
DELETE FROM audit_logs
WHERE id IN (
  SELECT id FROM audit_logs
  WHERE created_at < '2025-01-01'
  ORDER BY id
  LIMIT 5000
  FOR UPDATE SKIP LOCKED
);
```

```mysql
-- MySQL native DELETE ... ORDER BY ... LIMIT (always ORDER BY PK to prevent gap-lock deadlocks!)
DELETE FROM audit_logs
WHERE created_at < '2025-01-01'
ORDER BY id ASC
LIMIT 5000;
```

3. **When keeping <10% of a giant unpartitioned table:** Copy the surviving 10% into a fresh table (`CREATE TABLE audit_logs_new ...`), sync delta writes, and swap table names atomically!

### Scaling hot-row writes (flash sales, viral counters, wallet ledgers) without lock serialization 🔥

If 10,000 users click "Like" on the same viral post or buy from the same flash-sale SKU simultaneously, `UPDATE posts SET likes = likes + 1 WHERE id = 99` forces all 10,000 threads into a **strict single-file row-lock queue** on `id = 99` (plus creates 10,000 dead tuple versions in Postgres)!

**Four patterns to break single-row lock serialization:**

| Pattern | How it works | Best for |
|---|---|---|
| **1. Slotted / Sharded Counters** | Split 1 row `(post_id=99)` into **$N = 64$ bucket rows** `(post_id=99, slot=0..63)`. Writers increment a random/hashed slot `slot = floor(random() * 64)` (**64× higher write concurrency!**); readers sum the 64 tiny rows `SELECT SUM(cnt) FROM post_like_slots WHERE post_id = 99` ($\approx 0.2\text{ ms}$)! | Viral likes, view counters, API quota meters, tenant rate counters |
| **2. Redis `DECR` / Lua Gatekeeper + Async DB Commit** | Pre-load `stock = 500` in Redis; atomic `DECR` rejects callers `#501–#50,000` in RAM at `0.1 ms` before they ever touch Postgres/MySQL; only the 500 winners write durable orders! | Flash sales, concert ticket drops |
| **3. In-Memory Micro-Batching / Write Coalescing** | Buffer increments in app memory or Kafka for 250 ms and flush **one** `UPDATE posts SET likes = likes + 842 WHERE id = 99` per 250 ms (`4 writes/sec` instead of `10,000 writes/sec`!). | Analytics counters, video view counts, presence timestamps |
| **4. Append-Only Ledger + Periodic Snapshot** | `INSERT` immutable credit/debit ledger entries (zero update lock contention on inserts unless balance check needed; partition stock into reservable sub-pools for high-TPS wallets). | Accounting ledgers, points/credits |

### Upsert efficiency traps at scale (`ON CONFLICT` / `ON DUPLICATE KEY UPDATE`) 🔥

1. **Suppressing no-op writes:** If a cron job upserts 500,000 product rows nightly where 495,000 haven't changed, naive `DO UPDATE SET price = EXCLUDED.price` still writes **495,000 dead tuples + WAL records + fires triggers** in PostgreSQL! Add a `WHERE` guard on `DO UPDATE`:
   ```pgsql
   INSERT INTO products (sku, name, price, updated_at)
   VALUES ($1, $2, $3, now())
   ON CONFLICT (sku) DO UPDATE
     SET name       = EXCLUDED.name,
         price      = EXCLUDED.price,
         updated_at = now()
   WHERE (products.name, products.price) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.price);
   ```
   *(Note: MySQL InnoDB already skips physical no-op updates if new column bytes equal existing bytes unless a column like `updated_at = NOW()` forces every row to change!)*
2. **Sequence / `AUTO_INCREMENT` burning:** Every conflict branch in `INSERT ... ON CONFLICT` / `ON DUPLICATE KEY UPDATE` (with `innodb_autoinc_lock_mode = 2` default) **still increments and discards a sequence ID**! At 1,000 conflict upserts/sec, an `INT` PK (`2.14B`) exhausts in **24 days** even if the table only has 500 rows! Always use **`BIGINT`** PKs, or check/update existing rows first when conflict rate is >90%.
3. **Batch upsert deadlocks:** When batch-upserting 500 rows at once, **sort the batch in deterministic `sku` / PK ascending order in application code before sending the SQL**! Otherwise Concurrent Batch 1 (`['B', 'A']`) and Batch 2 (`['A', 'B']`) lock rows in opposite orders and deadlock!

---

## The relational scaling ladder (100 RPS → 500,000 RPS)

### Walk an interviewer through scaling a SQL database from 100 RPS to 500,000 RPS 🔥

Never jump straight to *"shard the database"* in a system design interview! Sharding is **Rung 7** — premature sharding destroys joins, foreign keys, and cross-shard ACID while 95% of companies scale to **50k–100k+ RPS on a single well-tuned primary + replicas**. Walk up this exact ladder:

| Rung | Bottleneck solved | Concrete actions | Typical ceiling |
|---|---|---|---|
| **1. Query & Index Hygiene** | Bad plans, full scans, N+1s | `pg_stat_statements` / `sys.statement_analysis`, ESR covering indexes, sargability, eliminate N+1s (`DataLoader` / `WHERE IN`), keyset pagination | `100 → 5,000 RPS` |
| **2. Connection Pooling** | Process/thread exhaustion, snapshot contention | **PgBouncer (`transaction` mode)** / **ProxySQL** / **RDS Proxy**; keep active DB worker connections at `50–200` | Smooths 10k+ client conns |
| **3. Vertical Scaling + Tuning** | Working set > RAM, slow IOPS | Scale up to 64–128 vCPU, 512 GB–1 TB RAM, local/provisioned NVMe SSDs; tune `shared_buffers` / `innodb_buffer_pool_size`, `random_page_cost=1.1`, `autovacuum` | `15,000–40,000 write TPS` |
| **4. Caching Layer (Redis / CDN)** | Repetitive read hot-spots | Cache-aside with stampede single-flight locking + jittered TTLs; HTTP edge caching | `50,000–500,000+ read RPS` |
| **5. Read Replicas + OLAP Offload** | Read CPU saturation & heavy analytics | 2–5 async streaming/binlog read replicas (with causal RYOW routing!) + CDC (`Debezium`) to ClickHouse/BigQuery for analytics | Scales read SQL horizontally |
| **6. Table Partitioning & Cold Archiving** | Single table > 100–500 GB; B-tree eviction | Monthly `RANGE` or `HASH` partitioning; move >1yr cold partitions to S3 Parquet / archive DB | Multi-TB single node |
| **7. Functional Federation (Vertical Split)** | Unrelated domains competing for primary WAL/CPU | Split `auth_db`, `billing_db`, `telemetry_db`, `chat_db` onto separate independent DB clusters aligned with service boundaries! | Multiplies write ceiling 3–5× with **zero** sharding complexity |
| **8. Horizontal Sharding** | A **single table/domain** exceeds single-node write IOPS (~50k+ sustained write TPS or 10+ TB hot data) | Partition rows across $K$ independent primaries by **Shard Key** (`tenant_id` or `user_id`) via **Citus** (Postgres), **Vitess** (MySQL), or app-level directory/hash routing | **100,000 → 1,000,000+ TPS** |

### Read replicas & replication lag: how do you guarantee Read-Your-Own-Writes (RYOW) consistency? 🔥

Classic interview scenario: User updates their profile bio (`POST /profile` → Primary), the UI redirects to `GET /profile` (`15 ms` later → Read Replica with `80 ms` replication lag), and **the user sees their old bio and thinks the save failed!**

**Three clean solutions (mention #3 for staff-level points!):**
1. **Route critical user-self reads to Primary** (simple when self-reads are <5% of traffic).
2. **Short sticky Primary window in Redis/Cookie:** After a user mutates data, set a 3-second flag/cookie `last_write_ts` routing that user's `GET`s to Primary for 3 seconds, then back to Replicas.
3. **Causal LSN / GTID Token Tracking (Zero unnecessary Primary load, 100% exact!):**
   - On write `COMMIT`, Primary returns its current WAL **LSN** (`SELECT pg_current_wal_insert_lsn()` in Postgres) or **GTID** (`@@session.gtid_executed` in MySQL), stored in the user's session/JWT header (`X-Min-LSN: 0/16B3748`).
   - On subsequent read, check if the chosen replica's `pg_last_wal_replay_lsn() >= client_min_lsn` (or call MySQL's built-in **`SELECT WAIT_FOR_EXECUTED_GTID_SET('uuid:1-42', 0.2)`**, which waits up to 200 ms for the replica to catch up to that exact transaction, falling back to Primary only if timed out!).

```js
// Slotted Hot-Row Counter + Causal LSN Read-Your-Own-Writes (RYOW) Router Simulation
class SlottedCounter {
  constructor(numSlots = 16) {
    this.slots = new Array(numSlots).fill(0);
  }
  increment(workerId, delta = 1) {
    const slot = workerId % this.slots.length;
    this.slots[slot] += delta; // Only locks 1/16th of writers!
    return slot;
  }
  readTotal() {
    return this.slots.reduce((sum, v) => sum + v, 0);
  }
}

function routeReadWithCausalLsn({ requiredLsn = 0, primaryLsn, replicas }) {
  // Pick lowest-load caught-up replica where replayLsn >= requiredLsn; otherwise fall back safely to primary!
  const caughtUp = replicas
    .filter((r) => r.replayLsn >= requiredLsn)
    .sort((a, b) => a.activeQueries - b.activeQueries);
  if (caughtUp.length > 0) return { target: caughtUp[0].name, staleRisk: false };
  return { target: 'primary', staleRisk: false, primaryLsn };
}

const counter = new SlottedCounter(8);
for (let req = 0; req < 1000; req++) counter.increment(req, 1);

const replicas = [
  { name: 'replica-1', replayLsn: 1050, activeQueries: 4 },
  { name: 'replica-2', replayLsn: 1038, activeQueries: 1 }, // lagging behind write LSN 1045!
];

console.log('Slotted counter slots:', counter.slots, '-> total:', counter.readTotal());
console.log('Read right after write @ LSN 1045:', routeReadWithCausalLsn({ requiredLsn: 1045, primaryLsn: 1052, replicas }));
console.log('Read right after write @ LSN 1052:', routeReadWithCausalLsn({ requiredLsn: 1052, primaryLsn: 1052, replicas }));

test('Slotted counter distributes 1,000 increments evenly across 8 slots while preserving exact SUM', () => {
  expect(counter.readTotal()).toBe(1000);
  expect(Math.max(...counter.slots)).toBe(125); // Max 125 lock acquisitions per row instead of 1,000!
});

test('Causal LSN router avoids lagging replica-2 and falls back to primary only when no replica caught up', () => {
  expect(routeReadWithCausalLsn({ requiredLsn: 1045, primaryLsn: 1052, replicas }).target).toBe('replica-1');
  expect(routeReadWithCausalLsn({ requiredLsn: 1052, primaryLsn: 1052, replicas }).target).toBe('primary');
  expect(routeReadWithCausalLsn({ requiredLsn: 0, primaryLsn: 1052, replicas }).target).toBe('replica-2');
});
```

### Horizontal sharding in depth: picking a shard key, cross-shard queries, and resharding 🔥

- **How to pick the Shard Key (the most permanent decision in data engineering):**
  - Pick the entity that **co-locates 95%+ of joins and transactions onto a single shard**:
    - **B2B SaaS (Slack, Notion, Shopify):** `tenant_id` / `workspace_id` / `shop_id` → every query, join, and transaction for one company hits **one single shard**! *(For giant "whale" enterprise tenants like IBM, dedicate an isolated shard via a directory lookup table so they never become a noisy neighbour!)*
    - **Consumer Social / Messaging:** `user_id` or `conversation_id`.
- **Handling cross-shard lookups (e.g. searching an order by `order_id` when sharded by `user_id`, or `login(email)`):**
  1. **Embed shard ID inside the 64-bit Snowflake ID** (`[41b timestamp | 10b shard_id | 12b seq]`) so given *any* `order_id`, bitwise `(order_id >> 12) & 0x3FF` tells you its exact shard in $O(1)$ with zero lookup!
  2. **Global Secondary Index / Lookup Table** (`email_to_shard(email PRIMARY KEY, user_id, shard_id)` cached heavily in Redis).
- **Zero-downtime resharding (splitting Shard 3 into Shard 3A & 3B):**
  1. Stand up 3A and 3B as **logical / filtered binlog replicas** of Shard 3.
  2. Catch up to `<50 ms` lag and verify row checksums.
  3. Briefly pause writes to Shard 3 for ~1–2 seconds inside the proxy (`VTGate` / router), wait for final LSN/GTID sync, flip routing table atomically, and resume writes!

---

## High-signal live SQL coding challenges (PostgreSQL & MySQL 8+)

### 1. Rolling User Retention (D1, D7, D30) in a single pass 🔥

**Prompt:** *Given `users(id, signup_date)` and `activity(user_id, active_date)`, compute for each `signup_date` cohort: cohort size, Day-1, Day-7, and Day-30 retention percentages (only counting mature cohorts where enough days have elapsed!).*

```pgsql
-- PostgreSQL (single pass using conditional COUNT(DISTINCT ...) — avoids 3 separate self-joins!)
SELECT
  u.signup_date,
  COUNT(DISTINCT u.id) AS cohort_size,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN a.active_date = u.signup_date + 1 THEN u.id END)
    / NULLIF(COUNT(DISTINCT CASE WHEN u.signup_date <= CURRENT_DATE - 1 THEN u.id END), 0),
    2
  ) AS d1_pct,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN a.active_date = u.signup_date + 7 THEN u.id END)
    / NULLIF(COUNT(DISTINCT CASE WHEN u.signup_date <= CURRENT_DATE - 7 THEN u.id END), 0),
    2
  ) AS d7_pct,
  ROUND(
    100.0 * COUNT(DISTINCT CASE WHEN a.active_date = u.signup_date + 30 THEN u.id END)
    / NULLIF(COUNT(DISTINCT CASE WHEN u.signup_date <= CURRENT_DATE - 30 THEN u.id END), 0),
    2
  ) AS d30_pct
FROM users u
LEFT JOIN activity a
  ON a.user_id = u.id
 AND a.active_date IN (u.signup_date + 1, u.signup_date + 7, u.signup_date + 30)
GROUP BY u.signup_date
ORDER BY u.signup_date;
-- MySQL 8.0+ note: replace `u.signup_date + 7` with `DATE_ADD(u.signup_date, INTERVAL 7 DAY)` and `CURRENT_DATE - 7` with `DATE_SUB(CURDATE(), INTERVAL 7 DAY)`.
```
*Efficiency insight:* Notice `AND a.active_date IN (...)` inside the `LEFT JOIN ... ON` clause — with `INDEX (user_id, active_date)`, we probe at most 3 dates per user instead of scanning months of activity logs!

### 2. Multi-step Conversion Funnel without N self-joins 🔥

**Prompt:** *Given `events(user_id, event_name, occurred_at)` where steps are `'view_pricing' → 'start_trial' → 'add_card' → 'paid'` (each step only counts if it happened **at or after** the previous step!), compute user counts and step-to-step conversion in one scan.*

```sql
-- Works identically in BOTH PostgreSQL AND MySQL 8.0+!
WITH user_steps AS (
  SELECT
    user_id,
    MIN(CASE WHEN event_name = 'view_pricing' THEN occurred_at END) AS t_view,
    MIN(CASE WHEN event_name = 'start_trial'  THEN occurred_at END) AS t_trial,
    MIN(CASE WHEN event_name = 'add_card'     THEN occurred_at END) AS t_card,
    MIN(CASE WHEN event_name = 'paid'         THEN occurred_at END) AS t_paid
  FROM events
  WHERE occurred_at >= '2026-10-01' AND occurred_at < '2026-11-01'
    AND event_name IN ('view_pricing', 'start_trial', 'add_card', 'paid')
  GROUP BY user_id
),
funnel_counts AS (
  SELECT
    SUM(CASE WHEN t_view IS NOT NULL THEN 1 ELSE 0 END)                                                         AS s1_viewed,
    SUM(CASE WHEN t_view IS NOT NULL AND t_trial >= t_view THEN 1 ELSE 0 END)                                   AS s2_trial,
    SUM(CASE WHEN t_view IS NOT NULL AND t_trial >= t_view AND t_card >= t_trial THEN 1 ELSE 0 END)             AS s3_card,
    SUM(CASE WHEN t_view IS NOT NULL AND t_trial >= t_view AND t_card >= t_trial AND t_paid >= t_card THEN 1 ELSE 0 END) AS s4_paid
  FROM user_steps
)
SELECT
  s1_viewed,
  s2_trial, ROUND(100.0 * s2_trial / NULLIF(s1_viewed, 0), 2) AS view_to_trial_pct,
  s3_card,  ROUND(100.0 * s3_card  / NULLIF(s2_trial, 0),  2) AS trial_to_card_pct,
  s4_paid,  ROUND(100.0 * s4_paid  / NULLIF(s1_viewed, 0), 2) AS overall_conv_pct
FROM funnel_counts;
```
*(Note: if a user can view pricing late, start trial earlier, and view pricing again + start trial later, refine `t_trial` using sequential filtered passes or `MATCH_RECOGNIZE` — mention that edge case out loud to show senior awareness!)*

### 3. Merging Overlapping Time Intervals (Active Subscriptions / Session Islands) 🔥

**Prompt:** *Given `subscriptions(user_id, start_date, end_date)` where intervals can overlap or nest (e.g. `[Jan 1, Jan 20]`, `[Jan 5, Jan 10]` nested inside!, `[Jan 18, Feb 2]`, and `[Mar 1, Mar 15]`), merge overlapping intervals into clean continuous ranges per user.*

**Why naive `LAG(end_date)` FAILS:** On row 3 (`[Jan 18, Feb 2]`), `LAG(end_date)` looks only at row 2 (`Jan 10`) and falsely starts a new island — missing that row 1 (`Jan 20`) was **still active**! You **must** use the **running maximum `MAX(end_date) OVER (... ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)`**!

```sql
-- Works identically in BOTH PostgreSQL AND MySQL 8.0+ ($O(N \log N)$ single window sort — zero self-joins!)
WITH ordered AS (
  SELECT
    user_id,
    start_date,
    end_date,
    MAX(end_date) OVER (
      PARTITION BY user_id
      ORDER BY start_date, end_date
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ) AS prev_max_end
  FROM subscriptions
),
flagged AS (
  SELECT
    user_id,
    start_date,
    end_date,
    CASE WHEN prev_max_end IS NULL OR start_date > prev_max_end THEN 1 ELSE 0 END AS is_new_island
  FROM ordered
),
grouped AS (
  SELECT
    user_id,
    start_date,
    end_date,
    SUM(is_new_island) OVER (
      PARTITION BY user_id
      ORDER BY start_date, end_date
      ROWS UNBOUNDED PRECEDING
    ) AS island_id
  FROM flagged
)
SELECT
  user_id,
  MIN(start_date) AS merged_start,
  MAX(end_date)   AS merged_end
FROM grouped
GROUP BY user_id, island_id
ORDER BY user_id, merged_start;
```

Run the JS verification below to see why `LAG(end)` fails on nested intervals while `MAX(end) OVER (... 1 PRECEDING)` nails every case:

```js
// Exact SQL window algorithm for merging overlapping (including nested!) intervals
function mergeIntervalsSqlWindow(intervals) {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let prevMaxEnd = null;
  let islandId = 0;
  const groups = new Map();

  for (const [start, end] of sorted) {
    const isNewIsland = prevMaxEnd === null || start > prevMaxEnd ? 1 : 0;
    islandId += isNewIsland;
    const cur = groups.get(islandId) ?? { start, end };
    cur.start = Math.min(cur.start, start);
    cur.end = Math.max(cur.end, end);
    groups.set(islandId, cur);
    prevMaxEnd = prevMaxEnd === null ? end : Math.max(prevMaxEnd, end);
  }
  return [...groups.values()].map((g) => [g.start, g.end]);
}

// Tricky nested interval [5, 10] inside [1, 20], followed by [18, 25], then gap to [30, 40]
const raw = [[1, 20], [5, 10], [18, 25], [30, 40]];
console.log('Input intervals: ', raw);
console.log('Merged islands:  ', mergeIntervalsSqlWindow(raw));

test('Running-max window merges nested [5, 10] and overlapping [18, 25] into [1, 25]', () => {
  expect(mergeIntervalsSqlWindow(raw)).toEqual([[1, 25], [30, 40]]);
});

test('Touching intervals [1, 10] and [10, 15] merge cleanly when using > prevMaxEnd', () => {
  expect(mergeIntervalsSqlWindow([[1, 10], [10, 15], [16, 20]])).toEqual([[1, 15], [16, 20]]);
});
```

### 4. Sliding Time-Window Velocity / Fraud Detection (`RANGE BETWEEN INTERVAL`) 🔥

**Prompt:** *Flag every card payment where the same `card_id` has accumulated **more than 3 transactions OR over $5,000** in the **preceding 10 minutes** (rolling 10-minute lookback from each transaction's exact timestamp!).*

Many candidates write an expensive $O(N^2)$ range self-join (`JOIN payments p2 ON p2.card_id = p1.card_id AND p2.paid_at BETWEEN p1.paid_at - interval '10 min' AND p1.paid_at`). Both **PostgreSQL 11+** and **MySQL 8.0+** solve this in **$O(N \log N)$ linear sliding-pointer time** using **`RANGE BETWEEN INTERVAL ... PRECEDING AND CURRENT ROW`**!

```pgsql
-- PostgreSQL (for MySQL 8.0+, simply write `INTERVAL 10 MINUTE PRECEDING` without quotes!)
WITH rolling AS (
  SELECT
    id,
    card_id,
    amount,
    paid_at,
    COUNT(*)    OVER w AS tx_10m_count,
    SUM(amount) OVER w AS tx_10m_amount
  FROM card_payments
  WINDOW w AS (
    PARTITION BY card_id
    ORDER BY paid_at
    RANGE BETWEEN INTERVAL '10 minutes' PRECEDING AND CURRENT ROW
  )
)
SELECT *
FROM rolling
WHERE tx_10m_count > 3 OR tx_10m_amount > 5000.00;
```

### 5. Exact Median per Department in PostgreSQL (`PERCENTILE_CONT`) AND MySQL 8.0+ 🔥

MySQL 8.0/8.4 **does not implement `PERCENTILE_CONT(...) WITHIN GROUP (...)`**, so knowing the pure `ROW_NUMBER` + `COUNT` window formula saves you whenever the interview pad runs MySQL:

```pgsql
-- PostgreSQL: built-in ordered-set aggregate
SELECT
  dept_id,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY salary) AS median_salary,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY salary) AS p95_salary
FROM employees
WHERE dept_id IS NOT NULL
GROUP BY dept_id;
```

```mysql
-- MySQL 8.0+ (also works in PostgreSQL, Snowflake, BigQuery, SQLite!):
-- For odd N=5, row 3 lies in [2.5, 3.5]; for even N=4, BOTH rows 2 and 3 lie in [2.0, 3.0] and AVG averages them!
WITH ranked AS (
  SELECT
    dept_id,
    salary,
    ROW_NUMBER() OVER (PARTITION BY dept_id ORDER BY salary ASC, id ASC) AS rn,
    COUNT(*)     OVER (PARTITION BY dept_id)                             AS cnt
  FROM employees
  WHERE dept_id IS NOT NULL
)
SELECT
  dept_id,
  ROUND(AVG(salary), 2) AS median_salary
FROM ranked
WHERE rn BETWEEN cnt / 2.0 AND cnt / 2.0 + 1
GROUP BY dept_id;
```

### 6. Month-over-Month & Year-over-Year Growth with Zero-Filled Missing Months (Postgres & MySQL 8+) 🔥

**Why naive `LAG(revenue, 1)` and `LAG(revenue, 12)` silently return WRONG numbers:** If no orders occurred in April 2026, April has **no row** in `GROUP BY month`, so May's `LAG(revenue, 1)` compares May against **March** instead of `$0` in April! Always generate a **dense spine of months** first, then `LEFT JOIN` aggregated monthly revenue:

```pgsql
-- PostgreSQL: generate_series builds the dense monthly spine
WITH months AS (
  SELECT generate_series('2025-01-01'::date, '2026-12-01'::date, INTERVAL '1 month')::date AS month_start
),
monthly_rev AS (
  SELECT DATE_TRUNC('month', created_at)::date AS month_start, SUM(total) AS revenue
  FROM orders
  WHERE status IN ('paid', 'shipped')
    AND created_at >= '2025-01-01' AND created_at < '2027-01-01'
  GROUP BY 1
),
filled AS (
  SELECT m.month_start, COALESCE(r.revenue, 0) AS revenue
  FROM months m
  LEFT JOIN monthly_rev r ON r.month_start = m.month_start
)
SELECT
  month_start,
  revenue,
  LAG(revenue, 1)  OVER (ORDER BY month_start) AS prev_month_rev,
  LAG(revenue, 12) OVER (ORDER BY month_start) AS prev_year_rev,
  ROUND(100.0 * (revenue - LAG(revenue, 12) OVER (ORDER BY month_start))
        / NULLIF(LAG(revenue, 12) OVER (ORDER BY month_start), 0), 2) AS yoy_pct
FROM filled
ORDER BY month_start;
```

```mysql
-- MySQL 8.0+ equivalent monthly spine using WITH RECURSIVE:
WITH RECURSIVE months AS (
  SELECT DATE('2025-01-01') AS month_start
  UNION ALL
  SELECT DATE_ADD(month_start, INTERVAL 1 MONTH)
  FROM months
  WHERE month_start < '2026-12-01'
)
SELECT * FROM months; -- join monthly_rev + LAG(..., 1) / LAG(..., 12) identically!
```

### 7. Mutual Friends & 2nd-Degree "People You May Know" Recommendations 🔥

**Prompt:** *Given undirected friendships stored once per pair `friendships(user_a, user_b)` where `user_a < user_b`, recommend top 10 non-friends for `user_id = 42` ranked by mutual friend count.*

```sql
-- Normalise undirected edges into directed view in CTE, traverse 2 hops from user 42, exclude self & existing friends!
WITH edges AS (
  SELECT user_a AS u, user_b AS f FROM friendships
  UNION ALL
  SELECT user_b AS u, user_a AS f FROM friendships
),
my_friends AS (
  SELECT f AS friend_id FROM edges WHERE u = 42
)
SELECT
  e.f        AS candidate_user_id,
  COUNT(*)   AS mutual_friends_count
FROM my_friends mf
JOIN edges e ON e.u = mf.friend_id
WHERE e.f <> 42
  AND NOT EXISTS (
    SELECT 1 FROM my_friends existing WHERE existing.friend_id = e.f
  )
GROUP BY e.f
ORDER BY mutual_friends_count DESC, candidate_user_id ASC
LIMIT 10;
```

### The 12-point SQL interview self-review checklist before saying "I'm done" 🔥

Run your eyes down these 12 checks in 30 seconds before handing your query to the interviewer — catching even **one** of these yourself turns a good pass into a **"Strong Hire"**:

1. **Grain check:** Could any `JOIN` fan out `1:N` and silently inflate `SUM()` or `COUNT()`?
2. **`LEFT JOIN` preservation:** Did I accidentally filter a right-table column in `WHERE` instead of `ON`? And did I write `COUNT(right.id)` instead of `COUNT(*)`?
3. **`NULL` traps:** Did I use `NOT EXISTS` instead of `NOT IN`? Did I wrap nullable numerators in `COALESCE(..., 0)`?
4. **Division safety & integer truncation:** Did I guard denominators with `NULLIF(denom, 0)` and multiply by `100.0` / `1.0` so Postgres doesn't integer-truncate to `0`?
5. **Ties specification:** When asked for "top 3", did I clarify `ROW_NUMBER` (strictly 3 rows) vs `DENSE_RANK` (includes ties, no rank gaps) vs `RANK`?
6. **Window frame trap:** If I used `LAST_VALUE` or `NTH_VALUE`, did I specify `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`?
7. **Timestamp boundaries:** Did I use half-open `>= start AND < next_day` instead of `BETWEEN` on timestamps?
8. **Sparse timeline gaps:** If using `LAG(val, 1)` for MoM/DoD metrics, can a day/month have zero rows and shift offsets?
9. **Deterministic ordering:** Does `LIMIT` have a unique tie-breaker (`ORDER BY score DESC, id ASC`) so pagination never skips or duplicates tied rows?
10. **SARGability:** Is every indexed filter column bare on one side (`col >= ...`), free of `DATE(col)` / `YEAR(col)` / implicit string-int casts?
11. **Supporting index proposal:** Proactively state *"To run this efficiently at 100M rows, I'd add a composite index following ESR: `CREATE INDEX CONCURRENTLY ON orders (tenant_id, status, created_at DESC) INCLUDE (total)`."*
12. **Scale trade-off:** Mention when pre-computed rollups, materialised views, or CDC → OLAP beat running the query live on OLTP!
