# Indexing, Query Plans & Performance Tuning

"The dashboard is slow. What do you do?" is one of the most common full-stack interview questions. The real answer is usually **in the database**.

This doc covers:

- How indexes are physically built.
- Why the planner uses or ignores them.
- How to read `EXPLAIN ANALYZE`.
- How the three join algorithms work.
- Operational causes of slowness: pagination, connection pools, locks, VACUUM, partitioning.

Examples are **PostgreSQL**, with MySQL/InnoDB differences called out.

> SQL and plan output aren't runnable here. The algorithms behind them (binary search vs scan, composite-index prefixes, nested-loop vs hash vs merge join, keyset pagination) are implemented in **runnable JavaScript with tests**, so you can see why each behaves as it does.

## How storage and indexes work

### How does a database physically store a table, and why does `SELECT *` cost more? 🔥

**PostgreSQL storage basics:**

- A table (the **heap**) is a file of **8 KB pages**. Each page holds a header, an array of line pointers, and the row versions (**tuples**).
- A row is addressed by its **TID/ctid** `(page, slot)`. Index entries store `(key → ctid)`.
- **Large values** (long text, JSONB > ~2 KB) are compressed and/or moved out of line into a **TOAST** table. Reading them costs extra I/O and decompression.
- **Updates write a new row version** (MVCC). The old one becomes a **dead tuple** until VACUUM reclaims it. An update-heavy table grows unless VACUUM keeps up.
- **Disk vs cache:** the database caches pages in **shared_buffers**, and the OS page cache sits underneath. "Fast" queries are often just "fully cached" queries. That's why the `Buffers: shared hit / read` numbers in EXPLAIN matter.

**Why `SELECT *` is a performance smell, not just a style issue:**

1. **It prevents index-only scans.** If you select only indexed columns, the database can answer from the index without touching the heap.
2. It forces **de-TOASTing** of big columns you don't use (a `body TEXT` or `settings JSONB`).
3. More bytes go over the network and into ORM object hydration, which is often the real cost in Node or Java.
4. It breaks silently when columns are added or reordered (`INSERT … SELECT *`, positional mapping).

**MySQL InnoDB is different:** rows are stored **inside the primary-key B-tree** (a clustered index), in 16 KB pages, and old versions live in the **undo log**. See the clustered-index question below.

### How does a B-tree index work, and why is it the default? 🔥

A **B+tree** is a balanced, wide, shallow tree:

```text
                         [ root: 1000 | 2000 ]
                /                 |                  \
     [ 100 | 400 | 700 ]   [ 1200 | 1500 ]     [ 2300 | 2800 ]      ← internal pages (keys + child pointers)
       /    |    |    \        …                    …
  [leaf: 1..99] ⇄ [100..399] ⇄ [400..699] ⇄ …                          ← leaf pages: sorted keys → ctid, doubly linked
```

**Key properties:**

- **Very high fan-out.** One 8 KB page holds **hundreds** of keys, so the height is tiny. With ~400 entries per page, 3 levels address 400³ ≈ **64 million** rows and 4 levels ≈ **25 billion**. A lookup is **3–4 page reads**, and the top levels are almost always cached.
- **Leaves are sorted and linked**, so **range scans** and **ORDER BY** walk the leaf chain without re-descending.
- **Balanced on every insert and delete** (page splits and merges), so lookups stay O(log n).

**What a B-tree can serve:**

- `=`, `<`, `<=`, `>`, `>=`, `BETWEEN`, `IN`, `IS NULL`.
- Prefix `LIKE 'abc%'` (with the C collation or `text_pattern_ops`).
- `ORDER BY` (in either direction) and `MIN`/`MAX`.

**What it can't serve efficiently:** `LIKE '%abc'`, functions on the column (unless you have an expression index), full-text search, "contains" on arrays or JSONB.

**The cost:**

- **Every insert, update of an indexed column, and delete touches every index on the table.** Ten indexes means roughly ten extra page writes plus WAL.
- Random keys (UUID v4) cause **page splits all over the tree** and poor cache locality.

This simulation counts comparisons for a sequential scan vs a binary search on sorted keys (what one leaf-level search does):

```js
// Why an index helps: O(n) scan vs O(log n) search on sorted keys
function seqScan(rows, key) {
  let comparisons = 0;
  for (const r of rows) { comparisons++; if (r === key) return { found: true, comparisons }; }
  return { found: false, comparisons };
}
function indexSearch(sorted, key) {
  let lo = 0, hi = sorted.length - 1, comparisons = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    comparisons++;
    if (sorted[mid] === key) return { found: true, comparisons };
    if (sorted[mid] < key) lo = mid + 1; else hi = mid - 1;
  }
  return { found: false, comparisons };
}
// B+tree height needed for n keys with a given fan-out
const btreeHeight = (n, fanout) => Math.max(1, Math.ceil(Math.log(n) / Math.log(fanout)));

const N = 1_000_000;
const sorted = Array.from({ length: N }, (_, i) => i * 2);   // even numbers
console.log('scan  :', seqScan(sorted, 1_999_998));
console.log('index :', indexSearch(sorted, 1_999_998));
console.log('B+tree height for 25 billion rows, fan-out 400:', btreeHeight(25e9, 400));

test('binary search needs ~log2(n) comparisons', () => {
  expect(indexSearch(sorted, 1_999_998).comparisons).toBeLessThanOrEqual(20);
  expect(seqScan(sorted, 1_999_998).comparisons).toBe(N);
});
test('a wide B+tree stays shallow', () => {
  expect(btreeHeight(64e6, 400)).toBe(3);
  expect(btreeHeight(25e9, 400)).toBe(4);
});
```

### Which index types does PostgreSQL offer, and when do you use each? 🔥

| Type | Structure | Best for | Example |
|---|---|---|---|
| **B-tree** (default) | Balanced sorted tree | Equality, ranges, sorting, uniqueness | `CREATE INDEX ON orders (customer_id, created_at DESC)` |
| **Hash** | Hash buckets | Pure equality on large keys. WAL-logged since PG10, but B-tree is usually just as good | `USING hash (session_token)` |
| **GIN** (Generalized Inverted) | key → posting list of rows | **Many values per row**: JSONB (`@>`, `?`), arrays (`@>`, `&&`), full-text `tsvector`, trigrams | `USING gin (settings jsonb_path_ops)` |
| **GiST** | Balanced tree of bounding predicates | Geometry (PostGIS), **ranges and overlaps** (`&&`), exclusion constraints, nearest-neighbour (`<->`) | `USING gist (tstzrange(start_at, end_at))` |
| **SP-GiST** | Space-partitioned (quad-trees, tries) | Non-balanced data: IP ranges, phone-number prefixes, points | `USING spgist (ip inet_ops)` |
| **BRIN** (Block Range) | min/max per range of pages | **Huge append-only tables** whose values correlate with physical order (time-series `created_at`). Tiny index, coarse filtering | `USING brin (created_at)` |
| **pgvector HNSW / IVFFlat** | Approximate nearest-neighbour graphs or lists | **Embeddings similarity search** (RAG, semantic search) | `USING hnsw (embedding vector_cosine_ops)` |

**GIN trade-off:** fast reads but **slower writes**. GIN uses a "pending list" (`fastupdate`) to batch insertions, which can make some reads slower until it's merged. For write-heavy tables with JSONB, index only the paths you query, for example with an **expression B-tree** on `(settings->>'roomType')`.

**BRIN in one sentence:** "For a 2-billion-row events table that is always inserted in time order, a BRIN index on `created_at` is a few MB instead of tens of GB, and still skips almost all blocks for a date-range query."

### Clustered vs non-clustered indexes, and why random UUID keys hurt 🔥

| | MySQL InnoDB | PostgreSQL |
|---|---|---|
| Table storage | **Clustered**: the table *is* the primary-key B-tree; rows are stored in PK order in the leaves | **Heap**: rows in insertion/free-space order. Every index (PK included) points to a ctid |
| Secondary index entries | `(secondary key → primary key value)`. A lookup is a **double traversal**: secondary B-tree, then the PK B-tree | `(key → ctid)`: direct to the heap page |
| Range scan by PK | Very fast: rows are physically contiguous | Rows may be scattered. `CLUSTER` reorders once, but it isn't maintained |
| Wide PKs | Expensive: **the PK is copied into every secondary index** | Less critical |

**Random UUID v4 primary keys:**

- **InnoDB:** each insert goes to a random leaf page of the clustered index, causing **page splits**, half-empty pages, poor buffer-pool locality, and many more disk writes. The same happens in every secondary index.
- **Postgres:** the heap is fine (append), but the **PK index** suffers the same random inserts and poor locality, plus more **full-page writes** in the WAL after checkpoints.
- **Fix:** time-ordered IDs. **UUID v7** (native `uuidv7()` in PostgreSQL 18), ULID, Snowflake IDs, or a `bigint` identity with a separate public UUID. Inserts become append-mostly, like an auto-increment.

### How should you order the columns of a composite index? (leftmost-prefix rule) 🔥

A composite B-tree on `(a, b, c)` is sorted by `a`, then by `b` within `a`, then by `c`. It's like a phone book sorted by last name, then first name.

| Query | Can it use `(a, b, c)`? |
|---|---|
| `WHERE a = 1` | ✅ prefix |
| `WHERE a = 1 AND b = 2` | ✅ |
| `WHERE a = 1 AND b = 2 AND c > 5` | ✅ all three |
| `WHERE a = 1 ORDER BY b` | ✅ **no sort needed**: rows come out ordered by b |
| `WHERE a = 1 AND c = 3` | ⚠️ uses `a` only; `c` is filtered inside the `a = 1` range |
| `WHERE b = 2` | ❌ traditionally no (no leading `a`). **PostgreSQL 18 and MySQL 8.0.13+ can "skip scan"** when `a` has few distinct values |
| `WHERE a > 1 AND b = 2` | ⚠️ the range on `a` stops `b` being used as an index-range condition |

**Rules of thumb:**

1. **Equality columns first, then range or sort columns.** For `WHERE customer_id = ? AND created_at > ? ORDER BY created_at`, use `(customer_id, created_at)`.
2. Among equality columns, order by **how many queries share the prefix**, not by "most selective first". Selectivity matters less than reuse.
3. **One composite index often replaces several single-column ones.** `(a, b)` also serves queries on `a` alone, so drop a redundant `(a)` index.
4. Match **sort directions** for multi-column ORDER BY: `ORDER BY a ASC, b DESC` needs `(a, b DESC)` (or the fully reversed order).

```sql
-- Supports: a customer's orders by date, filtering by status, newest first, without a sort step
CREATE INDEX orders_customer_status_created ON orders (customer_id, status, created_at DESC);

-- ✓ index range scan, no sort
SELECT id, total, created_at FROM orders
WHERE customer_id = 42 AND status = 'paid'
ORDER BY created_at DESC LIMIT 20;
```

The simulation sorts tuples like a composite index and shows which predicates map to a **contiguous range** of it:

```js
// A composite index is just entries sorted lexicographically by (a, b, c)
const rows = [];
for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = 1; c <= 2; c++) rows.push([a, b, c]);
const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
const index = rows.slice().sort(cmp);

// Positions of matching entries; a usable index condition is a CONTIGUOUS range of positions
function positions(pred) {
  return index.map((r, i) => (pred(r) ? i : -1)).filter((i) => i >= 0);
}
const contiguous = (pos) => pos.length > 0 && pos.every((p, i) => i === 0 || p === pos[i - 1] + 1);

const q1 = positions(([a]) => a === 2);                 // WHERE a = 2
const q2 = positions(([a, b]) => a === 2 && b === 3);   // WHERE a = 2 AND b = 3
const q3 = positions(([, b]) => b === 3);               // WHERE b = 3        (no leading column)
const q4 = positions(([a, , c]) => a === 2 && c === 1); // WHERE a = 2 AND c = 1 (skips b)

console.log({ q1, q2, q3, q4 });

test('leftmost prefixes are contiguous ranges of the index', () => {
  expect(contiguous(q1)).toBe(true);
  expect(contiguous(q2)).toBe(true);
});
test('skipping the leading column scatters the matches', () => {
  expect(contiguous(q3)).toBe(false);   // needs a full scan (or a skip scan)
  expect(contiguous(q4)).toBe(false);   // only a = 2 is a range; c is a filter inside it
});
```

### What are covering indexes and index-only scans? 🔥

An **index-only scan** answers the query **from the index alone**, never visiting the heap.

**It needs two things:**

1. **Every column the query uses** (`SELECT`, `WHERE`, `ORDER BY`) is in the index.
2. **(Postgres)** The heap pages are marked **all-visible** in the **visibility map**. Postgres must know the index entry's row is visible to your snapshot, and the index doesn't store visibility information. `VACUUM` sets these bits. On a freshly bulk-loaded or heavily updated table, EXPLAIN shows `Heap Fetches: N` until vacuum runs.

```sql
-- INCLUDE adds payload columns to the leaf pages only (not part of the key or sort order). Postgres 11+, SQL Server
CREATE INDEX orders_customer_created_incl ON orders (customer_id, created_at DESC) INCLUDE (total, status);

EXPLAIN (ANALYZE, BUFFERS)
SELECT created_at, total, status FROM orders WHERE customer_id = 42 ORDER BY created_at DESC LIMIT 20;
-- Index Only Scan using orders_customer_created_incl on orders …
--   Heap Fetches: 0        ← perfect: no heap access at all
```

**Why `INCLUDE` rather than adding columns to the key?**

- The included columns don't bloat the internal pages.
- They don't affect uniqueness: `UNIQUE (email) INCLUDE (name)` keeps uniqueness on email only.

In MySQL InnoDB, **every secondary index implicitly includes the PK**, and `EXPLAIN` shows `Using index` for a covering read.

### What are partial and expression indexes? Give real use cases 🔥

```sql
-- Partial index: only index the rows you query. Tiny, and cheap to maintain
CREATE INDEX jobs_pending_idx ON jobs (run_at) WHERE status = 'pending';
-- serves: SELECT … FROM jobs WHERE status = 'pending' AND run_at <= now() ORDER BY run_at LIMIT 10

-- Partial UNIQUE index: soft delete without blocking re-registration
CREATE UNIQUE INDEX users_email_active_uq ON users (lower(email)) WHERE deleted_at IS NULL;

-- Expression index: the query must use the *same expression*
CREATE INDEX customers_email_lower_idx ON customers (lower(email));
SELECT * FROM customers WHERE lower(email) = lower($1);        -- ✓ uses it
SELECT * FROM customers WHERE email ILIKE $1;                  -- ✗ different expression

-- Index one JSONB key you filter on constantly
CREATE INDEX meetings_room_type_idx ON meetings ((settings ->> 'roomType'));
```

**Typical partial-index cases:**

- **Queues and states:** `WHERE status IN ('pending','processing')`, which is a few thousand rows out of millions.
- **Soft deletes:** `WHERE deleted_at IS NULL`.
- **Sparse flags:** `WHERE is_flagged`.
- **Hot recent data:** a partial index with a **constant** cutoff date, recreated periodically. `now()` isn't allowed in an index predicate, because it must be immutable.

**Planner caveat:** a partial index is used only if the planner can **prove** the query's WHERE implies the index predicate. With prepared statements, `WHERE status = $1` can't match `WHERE status = 'pending'` in a generic plan, so write the literal.

### Why would the planner ignore my index? 🔥

This is the single most useful diagnostic list:

| Cause | Example | Fix |
|---|---|---|
| **Low selectivity** | `WHERE status = 'paid'` matches 70% of rows; a seq scan is genuinely cheaper | Normal. Index a more selective combination, or use a partial index |
| **Function or cast on the column** | `WHERE date(created_at) = '2026-10-09'`, `WHERE lower(email) = …` | Range predicate or expression index |
| **Implicit type conversion** | MySQL: `WHERE phone = 9876543210` on a VARCHAR column converts every row | Compare with the correct type (`'9876543210'`) |
| **Leading wildcard** | `LIKE '%son'` | Trigram GIN index, or an index on `reverse(name)` |
| **Leading column missing** from a composite index | Index `(a, b)`, query `WHERE b = ?` | Add an index on `(b)`, reorder, or rely on skip scan (PG18) |
| **OR across different columns** | `WHERE a = 1 OR b = 2` | Index both (Postgres can do **BitmapOr**), or rewrite as `UNION` |
| **Stale statistics** | After a bulk load the planner thinks the table has 1,000 rows | `ANALYZE table` (autovacuum does this eventually) |
| **Correlated columns** misestimated | `city = 'Hyderabad' AND state = 'Telangana'` is estimated as independent | `CREATE STATISTICS … (dependencies) ON city, state` |
| **Small table** | 200 rows fit in 2 pages | A seq scan is optimal. Don't worry |
| **Generic plan for prepared statements** | `WHERE tenant_id = $1` with a huge skew between tenants | `plan_cache_mode = force_custom_plan` for that query, or a different index design |
| **Cost settings tuned for spinning disks** | `random_page_cost = 4` on SSD/NVMe overprices index scans | Set **`random_page_cost = 1.1`** on SSD |
| **`NOT`, `<>`, `NOT IN`** | Low selectivity by nature | Usually fine as is, or invert the logic with a partial index |

**Interview phrasing:** "An index is a tool the planner *may* use. It decides on cost, using estimates from statistics. So when an index isn't used, I check whether the predicate is sargable, whether the estimates match reality in EXPLAIN ANALYZE, and whether the index matches the query shape."

### What does "sargable" mean? Rewrite non-sargable predicates 🔥

**SARGable** (Search ARGument-able) means the database can turn the predicate into an **index range**. The column must stand alone on one side of the operator.

```sql
-- ✗ function wraps the column            → ✓ half-open range on the bare column
WHERE date(created_at) = '2026-10-09'      → WHERE created_at >= '2026-10-09' AND created_at < '2026-10-10'
WHERE EXTRACT(YEAR FROM created_at) = 2026 → WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'

-- ✗ arithmetic on the column             → ✓ move it to the constant side
WHERE total * 1.18 > 1000                  → WHERE total > 1000 / 1.18

-- ✗ COALESCE hides the column            → ✓ explicit OR (or a partial index)
WHERE COALESCE(deleted_at, 'infinity') > now() → WHERE deleted_at IS NULL OR deleted_at > now()

-- ✗ concatenation                        → ✓ compare the columns separately
WHERE first_name || ' ' || last_name = 'Syed Zakiuddin' → WHERE first_name = 'Syed' AND last_name = 'Zakiuddin'

-- ✗ case-insensitive compare             → ✓ expression index on lower(email), or the citext type
WHERE lower(email) = 'a@b.com'             -- fine only WITH an index on (lower(email))
```

**Half-open ranges (`>= start AND < end`)** are also **correct** for timestamps. `BETWEEN '2026-10-09' AND '2026-10-09 23:59:59'` misses the last fractional second.

### What does an index cost, and how do you find useless ones?

**Costs:**

- **Write amplification:** every index is updated on INSERT and DELETE, and on UPDATE of its columns.
- **Disk, RAM and WAL:** each index competes for buffer cache.
- **Planning time and lock contention** on very hot tables.
- **HOT updates are blocked.** Postgres can do a **heap-only tuple (HOT)** update, with no index writes at all, only if **no indexed column changed** *and* the new version fits **on the same page**. Indexing a frequently updated column (`last_seen_at`) disables HOT for those updates. Lowering `fillfactor` (for example to 85) leaves room on pages for HOT.

```sql
-- Indexes never used since stats were reset (check replicas too before dropping!)
SELECT schemaname, relname AS table, indexrelname AS index, idx_scan,
       pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE '%_pkey'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Tables read mostly by sequential scans (candidates for an index)
SELECT relname, seq_scan, seq_tup_read, idx_scan, n_live_tup
FROM pg_stat_user_tables
ORDER BY seq_tup_read DESC LIMIT 20;
```

**Also look for:**

- **Duplicate or redundant indexes:** `(a)` when `(a, b)` exists.
- **Unique constraints duplicated by a plain index.**
- **Bloated indexes:** rebuild with `REINDEX INDEX CONCURRENTLY`.

## Reading query plans

### How do you read `EXPLAIN (ANALYZE, BUFFERS)` output? 🔥

- `EXPLAIN` shows the **estimated** plan.
- `EXPLAIN ANALYZE` **runs** the query and adds **actual** numbers. Wrap writes in `BEGIN; … ROLLBACK;`.
- `BUFFERS` adds I/O. It's on by default with ANALYZE in PostgreSQL 18.

```text
Limit  (cost=0.43..12.31 rows=20 width=40) (actual time=0.041..0.093 rows=20 loops=1)
  Buffers: shared hit=24
  ->  Index Scan using orders_customer_created on orders  (cost=0.43..2140.55 rows=3603 width=40)
                                                          (actual time=0.040..0.089 rows=20 loops=1)
        Index Cond: (customer_id = 42)
        Buffers: shared hit=24
Planning Time: 0.120 ms
Execution Time: 0.112 ms
```

| Field | Meaning |
|---|---|
| `cost=0.43..12.31` | Planner units: **startup cost .. total cost**. Only comparable within one plan |
| `rows=20` (estimate) vs `actual … rows=20` | **The most important comparison.** A 100× mismatch means bad statistics, which leads to a bad join choice |
| `width=40` | Average row size in bytes |
| `actual time=0.040..0.089` | Milliseconds **per loop**: time to first row .. time to last row |
| `loops=1` | How many times this node ran. Total time ≈ time × loops (inner side of a nested loop!) |
| `Buffers: shared hit=24 read=0` | Pages from cache vs from disk/OS. `read` is what makes things slow |
| `Rows Removed by Filter` | Rows read and then thrown away. A large number means a missing or poorly matching index |
| `Sort Method: external merge Disk: 120MB` | The sort spilled to disk: increase `work_mem` for this query, or avoid the sort with an index |
| `Heap Fetches` | For index-only scans: how often the heap had to be checked (VACUUM reduces it) |

**How to read it:**

1. **Read the plan inside-out:** the most indented nodes run first and feed their parents.
2. Find the node with the **largest actual time** (subtract the children's time).
3. Then look for **misestimates**: actual rows ≫ estimated rows.

[explain.dalibo.com](https://explain.dalibo.com) and **pgMustard** visualise plans. That's handy to mention.

### Seq Scan vs Index Scan vs Index Only Scan vs Bitmap Heap Scan 🔥

| Node | What happens | Chosen when |
|---|---|---|
| **Seq Scan** | Read every page in physical order (fast sequential I/O; parallel workers possible) | A large fraction of the table matches, or the table is small |
| **Index Scan** | Walk the B-tree, then fetch each matching heap tuple (random I/O per row) | **Few rows** match, or **ORDER BY / LIMIT** can follow the index order |
| **Index Only Scan** | Walk the index only; the heap is checked only for pages not all-visible | All needed columns are in the index |
| **Bitmap Index Scan → Bitmap Heap Scan** | Collect all matching TIDs into a bitmap (can **AND/OR several indexes**), then visit heap pages **in physical order**, each page once | A **medium** number of rows: too many for random index fetches, too few for a seq scan. Also `a = 1 OR b = 2` |

`Recheck Cond` on a bitmap heap scan appears when the bitmap became **lossy** (page-level, not tuple-level) because it exceeded `work_mem`. Every row on those pages is rechecked.

**The intuition:** the crossover between an index scan and a seq scan is often around **5–10% of the table**, much lower than people expect, because random page reads are expensive relative to sequential ones.

### Explain the three join algorithms: nested loop, hash join, merge join 🔥

| Algorithm | How it works | Cost | Best when | Limits |
|---|---|---|---|---|
| **Nested Loop** | For each outer row, look up matches in the inner input (ideally **via an index**) | O(N × log M) with an index; O(N × M) without | **Outer side is small** (e.g. after LIMIT or a selective filter) and the inner has an index | Explodes when the outer is unexpectedly large: the classic **misestimate disaster** |
| **Hash Join** | **Build** a hash table on the smaller input's join key, then **probe** it with each row of the other | O(N + M) | Large unsorted inputs, **equi-joins** | Equality only. Needs memory (`work_mem` × `hash_mem_multiplier`), else it spills in batches |
| **Merge Join** | Both inputs **sorted** on the key; walk them together like merging two sorted lists | O(N + M) + sort cost | Both sides already sorted (indexes) or very large; also suits FULL joins | Needs sorted input; equi-joins |

**MySQL** only had nested-loop variants until **8.0.18**, which added hash joins.

All three algorithms in JavaScript, producing identical results:

```js
// Three physical join algorithms for:  SELECT … FROM orders o JOIN customers c ON c.id = o.customerId
const customers = [{ id: 1, name: 'Asha' }, { id: 2, name: 'Ravi' }, { id: 3, name: 'Meera' }];
const orders = [
  { id: 10, customerId: 2, total: 50 }, { id: 11, customerId: 1, total: 20 },
  { id: 12, customerId: 2, total: 75 }, { id: 13, customerId: 9, total: 99 },   // 9: no such customer
];
let work = {};

function nestedLoop(outer, inner) {           // O(N*M) without an index on inner
  work.nested = 0;
  const out = [];
  for (const o of outer) for (const c of inner) { work.nested++; if (c.id === o.customerId) out.push([o.id, c.name]); }
  return out;
}
function hashJoin(probe, build) {             // build a hash table on the smaller side: O(N+M)
  work.hash = 0;
  const table = new Map();
  for (const c of build) { work.hash++; table.set(c.id, [...(table.get(c.id) ?? []), c]); }
  const out = [];
  for (const o of probe) { work.hash++; for (const c of table.get(o.customerId) ?? []) out.push([o.id, c.name]); }
  return out;
}
function mergeJoin(left, right) {             // inputs sorted on the join key, walk both once
  work.merge = 0;
  const L = left.slice().sort((a, b) => a.customerId - b.customerId);
  const R = right.slice().sort((a, b) => a.id - b.id);
  const out = [];
  let i = 0, j = 0;
  while (i < L.length && j < R.length) {
    work.merge++;
    if (L[i].customerId < R[j].id) i++;
    else if (L[i].customerId > R[j].id) j++;
    else {                                    // emit all left rows with this key against the matching right row
      let k = i;
      while (k < L.length && L[k].customerId === R[j].id) { out.push([L[k].id, R[j].name]); k++; }
      j++;
    }
  }
  return out;
}

const norm = (rows) => rows.slice().sort((a, b) => a[0] - b[0]);
const a = norm(nestedLoop(orders, customers));
const b = norm(hashJoin(orders, customers));
const c = norm(mergeJoin(orders, customers));
console.log(a, work);

test('all three algorithms return the same rows', () => {
  expect(a).toEqual([[10, 'Ravi'], [11, 'Asha'], [12, 'Ravi']]);
  expect(b).toEqual(a);
  expect(c).toEqual(a);
});
test('nested loop without an index does N*M comparisons', () => {
  expect(work.nested).toBe(orders.length * customers.length);
  expect(work.hash).toBe(orders.length + customers.length);
});
```

### The planner's estimates are wrong. How do you fix them?

**Why estimates go wrong:**

- **Stale statistics** after big data changes.
- **Correlated columns**: the planner assumes independence, so `city AND zip` is underestimated.
- **Skewed data** that isn't captured by the most-common-values list.
- **Functions and expressions** with default selectivity guesses.
- **Join estimates multiplying errors.**

**Fixes, in order:**

```sql
ANALYZE orders;                                                   -- refresh statistics now

ALTER TABLE orders ALTER COLUMN status SET STATISTICS 1000;       -- a bigger sample for a skewed column (default 100)
ANALYZE orders;

CREATE STATISTICS addr_city_zip (dependencies, ndistinct, mcv)    -- teach the planner the correlation
  ON city, zip FROM addresses;
ANALYZE addresses;

-- Expression indexes also gather statistics on the expression (helps lower(email) estimates)
```

**Last resorts:**

- Rewrite the query, for example materialising a step in a CTE.
- Session-level `SET enable_nestloop = off` **only to diagnose**, never in production code.
- The `pg_hint_plan` extension, if the team accepts hints.

### Sorting, grouping and `work_mem`: why did my query spill to disk?

**What `work_mem` is:** the **per-operation** memory budget for sorts, hash tables, hash aggregates and bitmap heaps. Default 4 MB.

**Symptoms of too little:**

- `Sort Method: external merge  Disk: 512000kB`.
- Hash join `Batches: 16` (more than 1 means it spilled).
- Slow `GROUP BY` with many groups.

**Fixes:**

- **Avoid the sort with an index** that already provides the order: `ORDER BY created_at DESC LIMIT 20` with an index on `created_at` stops after 20 rows. It's a **top-N heapsort**, or no sort at all.
- Raise it **per session or role** for reporting queries: `SET LOCAL work_mem = '256MB'` inside the transaction.
- **Don't raise it globally to a huge value.** One query can use `work_mem` **several times** (once per sort or hash node), times parallel workers, times connections. That's how databases run out of memory.

**Related plan features:**

- **Incremental Sort** (PG13+): if the data is already sorted by a prefix of the keys, only sort within groups.
- **HashAggregate vs GroupAggregate:** a hash table vs grouping over pre-sorted input.

## Query optimisation in practice

### Walk me through how you would fix a slow endpoint end-to-end 🔥

A structured answer, using a LoadOTR-style "vendor dashboard takes 4 s" story:

1. **Measure where the time goes:**
   - APM traces or OpenTelemetry spans show **DB time vs app time**. Often it's 40 queries (N+1), not one slow one.
2. **Find the expensive queries:**
   - **`pg_stat_statements`**, sorted by `total_exec_time`, gives total impact. A 5 ms query called 100,000 times matters more than one 2 s report.
   ```sql
   SELECT calls, round(total_exec_time) AS total_ms, round(mean_exec_time, 2) AS mean_ms, rows,
          round(100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0), 1) AS hit_pct,
          left(query, 120) AS query
   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 15;
   ```
3. **`EXPLAIN (ANALYZE, BUFFERS)`** the top offender **with realistic parameters on production-like data**. Plans differ on a 1,000-row dev database.
4. **Diagnose:**
   - Seq Scan with a large `Rows Removed by Filter`.
   - A misestimate leading to a nested loop with `loops=50000`.
   - A sort spilling to disk.
   - A non-sargable predicate.
5. **Fix the cheapest thing first:**
   1. A missing or wrong composite index (`CREATE INDEX CONCURRENTLY`).
   2. A query rewrite: sargable range, pre-aggregate before join, `EXISTS` instead of `DISTINCT`, keyset pagination.
   3. Fewer columns (an index-only scan).
   4. Batch the N+1 into one query.
   5. Cache or materialise if the data can be slightly stale.
   6. Only then hardware or replicas.
6. **Verify:** compare EXPLAIN before and after, p95 latency in APM, and the **write cost** of a new index.
7. **Prevent regressions:**
   - `auto_explain` for slow queries.
   - Alerts on p95.
   - Review migrations for index needs.

**Placeholder for your real story:** *[Which query was slow, what the plan showed, what you changed, and the before/after numbers.]*

### How do you detect and fix the N+1 query problem? 🔥

**N+1 means** one query fetches a list, then **one more query per item** fetches related data. 1 + 50 round trips, each paying network latency, parsing and planning. It's invisible in development and deadly in production.

**How to detect it:**

- **ORM query logging in development:** Prisma `log: ['query']`, Hibernate `spring.jpa.show-sql` plus statistics, Django Debug Toolbar.
- **`pg_stat_statements`:** the same query shape with a huge `calls` count and a tiny mean time.
- **APM traces** showing a waterfall of identical spans.
- **Tests that assert the query count** (Django `assertNumQueries`, Hibernate statistics).

**How to fix it:**

| Approach | Example |
|---|---|
| **Join / eager fetch** | `SELECT … FROM orders JOIN customers …`; JPA `JOIN FETCH` / `@EntityGraph`; Prisma `include`; Django `select_related` (FK) |
| **Batch load with `IN`/`ANY`** | `SELECT * FROM order_items WHERE order_id = ANY($1)`; Django `prefetch_related`; Hibernate `@BatchSize` |
| **DataLoader** (GraphQL, Node) | Collects all keys requested in one tick, then issues one batched query |
| **Return nested JSON from SQL** | `json_agg` in one query (see [SQL Mastery](/docs/sql-mastery)) |
| **Denormalise or cache** | When reads massively outnumber writes |

**Watch out:** eager-joining **two collections** at once creates a **Cartesian product** (Hibernate's `MultipleBagFetchException` exists because of this). Load the second collection in a separate batched query.

### Keyset pagination with ties, in depth 🔥

`OFFSET 100000 LIMIT 20` makes the database **produce and discard 100,000 rows**. It gets slower page by page, and rows shift when data changes. **Keyset (seek) pagination** remembers the last row's sort key and seeks past it. Every page is an index range scan.

```sql
-- Index matching the sort, including a unique tiebreaker
CREATE INDEX orders_created_id ON orders (created_at DESC, id DESC);

-- Page 1
SELECT id, created_at, total FROM orders ORDER BY created_at DESC, id DESC LIMIT 20;

-- Next page: row-value comparison (Postgres and MySQL 8 support it); the planner turns it into one index range
SELECT id, created_at, total FROM orders
WHERE (created_at, id) < ($1, $2)                 -- values from the last row of the previous page
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

**The tiebreaker is mandatory:**

- If many rows share a `created_at`, paginating on `created_at` alone **skips or duplicates rows**.
- Always add a **unique column** to the sort and the cursor.

**API design:**

- Return an opaque cursor such as `base64({"c":"2026-10-09T10:00:00Z","id":981})` together with `hasNextPage`.
- Fetch `LIMIT + 1` rows to know whether there is a next page.

**Trade-offs:**

- No "jump to page 37". Fine for infinite scroll and feeds.
- **Total counts are expensive.** Show an estimate ("10,000+"), or count asynchronously.

```js
// Keyset pagination over (createdAt DESC, id DESC) — ties on createdAt must not lose rows
const rows = [
  { id: 1, createdAt: 100 }, { id: 2, createdAt: 100 }, { id: 3, createdAt: 100 },
  { id: 4, createdAt: 90 }, { id: 5, createdAt: 90 }, { id: 6, createdAt: 80 },
];
const order = (a, b) => b.createdAt - a.createdAt || b.id - a.id;             // ORDER BY created_at DESC, id DESC
const before = (r, cur) => r.createdAt < cur.createdAt || (r.createdAt === cur.createdAt && r.id < cur.id); // (c, id) < (c0, id0)

function page(cursor, limit) {
  const sorted = rows.slice().sort(order);
  const candidates = cursor ? sorted.filter((r) => before(r, cursor)) : sorted;
  const items = candidates.slice(0, limit + 1);                               // LIMIT + 1 to detect hasNext
  const hasNext = items.length > limit;
  const pageItems = items.slice(0, limit);
  const last = pageItems[pageItems.length - 1];
  return { ids: pageItems.map((r) => r.id), hasNext, next: hasNext ? { createdAt: last.createdAt, id: last.id } : null };
}

// Walk every page
const seen = [];
let cursor = null, p;
do { p = page(cursor, 2); seen.push(...p.ids); cursor = p.next; } while (cursor);
console.log('pages walked:', seen);

// A broken cursor on created_at only (no tiebreaker)
const brokenNext = (cur) => rows.slice().sort(order).filter((r) => r.createdAt < cur.createdAt);

test('keyset with a unique tiebreaker visits every row exactly once', () => {
  expect(seen).toEqual([3, 2, 1, 5, 4, 6]);
});
test('a cursor on a non-unique column skips tied rows', () => {
  const first = page(null, 2);                                   // ids 3, 2  (createdAt 100)
  const next = brokenNext({ createdAt: 100 }).slice(0, 2).map((r) => r.id);
  expect(first.ids).toEqual([3, 2]);
  expect(next).toEqual([5, 4]);                                  // id 1 (also createdAt 100) was skipped!
});
```

### How do you do bulk inserts, updates and deletes efficiently?

**Inserts, fastest first:**

1. **`COPY`** (`COPY … FROM STDIN` via the driver: `pg-copy-streams`, psycopg `copy`, JDBC `CopyManager`). It's the fastest by far.
2. **Multi-row `INSERT … VALUES (…), (…), …`** in batches of 500–5,000 rows.
3. **`INSERT … SELECT * FROM unnest($1::text[], $2::numeric[])`**: one round trip with array parameters.
4. **JDBC:** `addBatch()` plus **`reWriteBatchedInserts=true`** on the PostgreSQL driver, which rewrites the batch into multi-row inserts.

**For an initial load:** create indexes **after** loading, and run `ANALYZE` afterwards.

```sql
-- Batched delete: avoids one giant transaction (long locks, huge WAL spike, replica lag, bloat)
DELETE FROM events
WHERE id IN (SELECT id FROM events WHERE created_at < now() - interval '90 days' LIMIT 10000);
-- repeat from a job until 0 rows are affected, sleeping briefly between batches

-- Bulk update from a VALUES list in one statement
UPDATE products p SET price = v.price
FROM (VALUES ('CAM-01', 49.00), ('MIC-02', 89.00)) AS v(sku, price)
WHERE p.sku = v.sku;
```

**For time-based retention, partition and DROP.** Dropping a partition is instant and creates no bloat.

### When and how should you partition a table? 🔥

**Declarative partitioning** (PG10+) splits one logical table into child tables:

| Strategy | Example | Typical use |
|---|---|---|
| **RANGE** | `created_at` by month | Time-series: events, logs, meeting analytics |
| **LIST** | `region IN ('IN','US')` | Data residency, tenants by tier |
| **HASH** | `hash(customer_id) % 16` | Spreading write load evenly (rarely needed for single-node Postgres) |

```sql
CREATE TABLE meeting_events (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  meeting_id bigint NOT NULL,
  type       text NOT NULL,
  payload    jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (id, created_at)                 -- the PK/unique keys must include the partition key
) PARTITION BY RANGE (created_at);

CREATE TABLE meeting_events_2026_10 PARTITION OF meeting_events
  FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');

-- Retention: instant, no VACUUM debt
ALTER TABLE meeting_events DETACH PARTITION meeting_events_2026_01 CONCURRENTLY;
DROP TABLE meeting_events_2026_01;
```

**Benefits:**

- **Partition pruning:** a query with `created_at` in the WHERE scans only the relevant partitions.
- **Instant retention:** detach or drop old partitions.
- Smaller per-partition indexes and faster VACUUM.
- Old partitions can move to cheaper storage.

**Pitfalls:**

- **Queries without the partition key scan every partition.**
- **Unique constraints must include the partition key.** There are no global unique indexes in Postgres.
- **Thousands of partitions** slow planning.
- You must **create future partitions** ahead of time (`pg_partman` or a cron job).

**When not to partition:** "the table has 10 million rows" is **not** a reason. Partition for **retention**, for **pruning on a dominant filter**, or for maintenance at hundreds of GB or more.

### Why do you need connection pooling, and how do you size the pool? 🔥

**Why connections are expensive:**

- **Each PostgreSQL connection is a separate OS process** with several MB of memory. Creating one costs a fork plus authentication (and TLS).
- Hundreds of mostly idle connections waste RAM and hurt performance through **contention and context switching**.
- The default `max_connections` is 100.

**Two layers of pooling:**

1. **In-process pools:**
   - Node `pg.Pool`, Java **HikariCP**, Python SQLAlchemy pool.
   - They reuse connections within one app instance.
2. **External poolers:**
   - **PgBouncer**, **RDS Proxy**, or Supavisor/pgcat.
   - They multiplex many client connections over a few server connections. This is essential with **many app instances or serverless functions**, where each Lambda would otherwise open its own connection.

**PgBouncer pool modes:**

| Mode | Server connection is held for | Caveats |
|---|---|---|
| Session | The client's whole session | Safest, least multiplexing |
| **Transaction** | One transaction | The popular choice. **Breaks session state:** `SET` (use `SET LOCAL`), session advisory locks, `LISTEN/NOTIFY`, temp tables. Protocol-level prepared statements are supported since PgBouncer **1.21** (`max_prepared_statements`) |
| Statement | One statement | No multi-statement transactions |

**Sizing.** Bigger isn't better: past a point, throughput **drops**.

- **HikariCP's formula** as a starting point: `connections ≈ (CPU cores × 2) + effective spindles`. That's often **10–30 for the whole database**, not per instance.
- **Little's law:** `pool size ≈ throughput (queries/s) × average query time (s)`. 500 queries/s × 0.01 s means about 5 busy connections.
- **Total across instances:** `instances × pool size ≤ max_connections − headroom`. Ten pods × 20 = 200 already exceeds the default 100.
- **Set timeouts:** acquire timeout, `statement_timeout`, `idle_in_transaction_session_timeout`. A leaked or stuck connection then fails fast instead of starving the pool.

**Serverless:**

- Use **RDS Proxy**, the **Data API**, or an HTTP-based driver (Neon/Supabase serverless drivers).
- Create the pool **outside the handler**, so warm invocations reuse it.

### Queries are suddenly slow and nothing changed. Could it be locks? 🔥

Very often, yes:

- A **long-running transaction** holding locks.
- A **migration waiting for a lock**, with everything queuing behind it.

**The lock-queue trap:**

1. `ALTER TABLE orders ADD COLUMN …` needs an `ACCESS EXCLUSIVE` lock.
2. It waits behind one long-running `SELECT`.
3. Every new query on `orders` now **queues behind the ALTER**.
4. The site goes down even though the ALTER itself would take milliseconds.

```sql
-- Who is running what, for how long, and waiting on what?
SELECT pid, usename, state, wait_event_type, wait_event,
       now() - xact_start AS xact_age, now() - query_start AS query_age, left(query, 100) AS query
FROM pg_stat_activity
WHERE state <> 'idle'
ORDER BY xact_start NULLS LAST;

-- Who blocks whom
SELECT blocked.pid AS blocked_pid, left(blocked.query, 60) AS blocked_query,
       blocking.pid AS blocking_pid, left(blocking.query, 60) AS blocking_query
FROM pg_stat_activity blocked
JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) AS b(pid) ON true
JOIN pg_stat_activity blocking ON blocking.pid = b.pid;

-- Safe migrations: give up quickly instead of queueing the whole app, then retry
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN note text;
```

**Guardrails:**

| Setting / practice | What it prevents |
|---|---|
| `statement_timeout` (per role or app) | Runaway queries holding locks for minutes |
| `idle_in_transaction_session_timeout` | A request that crashed mid-transaction keeping locks |
| `log_lock_waits = on` | Lock waits going unnoticed. Waits longer than `deadlock_timeout` are logged |
| Keep transactions short | Locks held across slow work. Never call external APIs inside a DB transaction |

### What are VACUUM, autovacuum and bloat? Why does transaction ID wraparound matter? 🔥

Because of MVCC, `UPDATE` and `DELETE` leave **dead tuples**. **VACUUM** has four jobs:

1. **Marks dead tuples' space reusable**, which limits table and index bloat. It doesn't return space to the OS. `VACUUM FULL` (or `pg_repack`) rewrites the table: `VACUUM FULL` takes an **ACCESS EXCLUSIVE lock**, while `pg_repack` works mostly online.
2. **Updates the visibility map**, which enables index-only scans and faster later vacuums.
3. **Freezes old transaction IDs.** XIDs are 32-bit (about 4 billion, compared modulo 2³²). Without freezing, after about 2 billion transactions old rows would appear to be "in the future". Postgres refuses writes before that happens: the **wraparound emergency**.
4. **Updates statistics**, via autovacuum's `ANALYZE` step.

**Autovacuum tuning for big, hot tables:**

- The default trigger is `50 rows + 20% of the table` dead. On a 500-million-row table that's 100 million dead rows before cleanup, which is far too late.
- Lower it per table:

```sql
ALTER TABLE meeting_events SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
```

**What stops VACUUM from cleaning up:**

- **Long-running transactions.**
- **Idle-in-transaction sessions.**
- **Abandoned replication slots.**
- **`hot_standby_feedback`** on replicas with long queries.

All of these hold back the "xmin horizon", so dead rows can't be removed. Monitor `n_dead_tup` and `last_autovacuum` in `pg_stat_user_tables`, and `age(datfrozenxid)`.

**MySQL** doesn't need VACUUM. It has a **purge thread** for undo logs, but a long transaction there causes **history list length** growth, which is the analogous problem.

### Which PostgreSQL settings should a developer know?

| Setting | Typical guidance | Why |
|---|---|---|
| `shared_buffers` | ~25% of RAM | The database's page cache |
| `effective_cache_size` | ~50–75% of RAM | **Planner hint** for the OS cache size (allocates nothing) |
| `work_mem` | 4–64 MB globally; more per session for reports | Per sort or hash **node**, so it multiplies |
| `maintenance_work_mem` | 256 MB – 2 GB | Faster `CREATE INDEX`, VACUUM |
| `random_page_cost` | **1.1 on SSD** (the default 4.0 assumes spinning disks) | Index scans are priced realistically |
| `max_connections` | Low hundreds at most; use a pooler | Each connection is a process |
| `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` | Set per role or app | Guardrails |
| `max_wal_size`, `checkpoint_timeout` | Larger for write-heavy workloads | Fewer checkpoint spikes |
| `log_min_duration_statement` | e.g. 500 ms | Logs slow queries |
| `io_method` (PG18) | `worker` (default) or `io_uring` | The new asynchronous I/O subsystem speeds up seq scans and VACUUM |

On managed services (RDS/Aurora, Cloud SQL) most of these are in **parameter groups**. Know where to change them and that some need a restart.

### How do you monitor database performance in production?

**PostgreSQL:**

| Tool | What it tells you |
|---|---|
| **`pg_stat_statements`** | Normalised queries with calls, total and mean time, rows, buffer hits and reads. **Enable this first** |
| **`auto_explain`** | Logs plans of slow queries automatically (`auto_explain.log_min_duration = '500ms'`) |
| `log_min_duration_statement`, `log_lock_waits`, `log_temp_files` | Slow queries, lock waits, disk spills |
| `pg_stat_activity` | Live sessions, wait events, transaction age |
| `pg_stat_user_tables` / `pg_stat_user_indexes` | Seq vs index scans, dead tuples, vacuum times, unused indexes |
| `pg_statio_*` | Cache hit ratio. It should be above about 99% for OLTP |

**MySQL:** the slow query log, `performance_schema`, the `sys` schema views, and `EXPLAIN ANALYZE` (8.0.18+).

**Cloud and APM:**

- **AWS RDS Performance Insights / Database Insights:** DB load by wait event and by SQL.
- **CloudWatch metrics:** CPU, IOPS, connections, replica lag.
- **APM tools** (Datadog, New Relic, OpenTelemetry) correlate endpoints with queries.

**Golden signals for databases:**

- Query latency p95/p99.
- Throughput.
- Connection usage.
- Replication lag.
- Disk and IOPS saturation.
- Lock waits and deadlocks.
- Bloat and dead tuples.

### How do you add an index to a large production table safely? 🔥

```sql
-- ✗ Blocks writes on the table for the whole build (a SHARE lock)
CREATE INDEX orders_status_idx ON orders (status);

-- ✓ Builds without blocking writes (two table scans, waits for older transactions; slower overall)
CREATE INDEX CONCURRENTLY orders_status_idx ON orders (status);
```

**Rules:**

- `CONCURRENTLY` **can't run inside a transaction block**. Many migration tools wrap migrations in transactions, so you must disable that for this migration. Examples: Flyway `executeInTransaction=false`, Rails `disable_ddl_transaction!`, a Prisma raw migration step.
- If it fails (a deadlock, a unique violation), it leaves an **INVALID index**. Check `pg_index.indisvalid`, then `DROP INDEX CONCURRENTLY` and retry.
- Use `REINDEX INDEX CONCURRENTLY` (PG12+) to rebuild bloated indexes online.
- For **unique** constraints: `CREATE UNIQUE INDEX CONCURRENTLY …`, then `ALTER TABLE … ADD CONSTRAINT … UNIQUE USING INDEX …`.
- Schedule big builds off-peak and watch I/O and replication lag.

**MySQL:** InnoDB online DDL (`ALGORITHM=INPLACE, LOCK=NONE`) allows concurrent DML for most index builds. For huge tables, use **gh-ost** or **pt-online-schema-change**.

### How do you read MySQL's EXPLAIN?

| `type` column (best → worst) | Meaning |
|---|---|
| `system` / `const` | At most one row (PK or unique lookup with a constant) |
| `eq_ref` | One row per previous-table row (a PK join) |
| `ref` | Non-unique index lookup |
| `range` | Index range scan (`BETWEEN`, `>`, `IN`) |
| `index` | **Full index scan** (reads the whole index) |
| `ALL` | **Full table scan** |

| `Extra` | Meaning |
|---|---|
| `Using index` | Covering index (index-only) ✅ |
| `Using index condition` | Index Condition Pushdown: filters evaluated in the storage engine |
| `Using where` | Filter applied after reading rows |
| `Using filesort` | An extra sort step (not necessarily on disk) ⚠️ |
| `Using temporary` | A temporary table for GROUP BY or DISTINCT ⚠️ |

`EXPLAIN ANALYZE` (8.0.18+) and `EXPLAIN FORMAT=TREE` give Postgres-like actual timings.

### What is vector search in Postgres (pgvector), and how is it indexed?

This is relevant for LLM features like RBF and SCAI: storing **embeddings** to find semantically similar chunks (RAG).

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE doc_chunks (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL,
  content text NOT NULL,
  embedding vector(1024) NOT NULL
);
CREATE INDEX doc_chunks_embedding_hnsw ON doc_chunks USING hnsw (embedding vector_cosine_ops);

-- Top-5 most similar chunks to a query embedding, scoped to one tenant's documents
SELECT id, content, 1 - (embedding <=> $1) AS cosine_similarity
FROM doc_chunks
WHERE document_id = ANY ($2)
ORDER BY embedding <=> $1
LIMIT 5;
```

| Index | How it works | Trade-off |
|---|---|---|
| **HNSW** | A multi-layer proximity graph | Best recall/speed, but slower to build and uses more memory. Can be built on an empty table |
| **IVFFlat** | Clusters vectors into `lists`; searches the nearest `probes` lists | Faster build and less memory, but needs representative data **before** building. Recall depends on `probes` |

**Distance operators:** `<->` (L2), `<=>` (cosine distance), `<#>` (negative inner product).

**Gotcha:** approximate indexes plus a selective `WHERE` filter can return **fewer than LIMIT rows**. Raise `hnsw.ef_search`, or use iterative scans (pgvector 0.8+). Pre-filtering by tenant at scale may need partitioning.

### OLTP vs OLAP: when is Postgres the wrong tool for analytics?

| | OLTP (Postgres, MySQL) | OLAP (ClickHouse, Redshift, BigQuery, Snowflake, DuckDB) |
|---|---|---|
| Workload | Many small reads and writes by key | Few huge scans and aggregates over billions of rows |
| Storage | **Row-oriented**: a whole row together | **Column-oriented**: a column together, compressed |
| Indexing | B-trees for point lookups | Sorting keys, zone maps, compression, vectorised execution |
| Latency target | Milliseconds per request | Seconds per analytical query |

**Signals that you need OLAP:**

- Dashboards aggregating 100M+ rows.
- Reporting queries hurting OLTP latency.
- Wide ad-hoc analysis.

**Pattern:**

1. Stream changes with **CDC** (Debezium, DMS) to a warehouse, or use read replicas for light reporting.
2. Keep the OLTP database lean.

**Postgres stretches further with:**

- Materialised views and BRIN indexes.
- Partitioning.
- Extensions such as TimescaleDB (time-series) and Citus (distributed).
