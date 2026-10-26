# Databases: PostgreSQL & DynamoDB

Your resume lists **PostgreSQL**, and your ScaleCapacity projects ran on **DynamoDB** (Nebraska Draw, SCAI). Full-stack rounds often include **writing SQL queries** (joins, aggregates, window functions), **indexing and query plans**, **transactions and isolation**, and, for AWS-heavy roles, **DynamoDB key design**.

For the full dedicated SQL track from beginner to staff level, see [SQL Fundamentals (Core)](/docs/sql-fundamentals), [SQL Mastery (Advanced)](/docs/sql-mastery), [PostgreSQL Deep Dive (Expert)](/docs/postgresql-deep-dive), [MySQL & InnoDB Deep Dive (Expert)](/docs/mysql-deep-dive), and [SQL Scalability & Efficiency (Expert)](/docs/sql-scalability-efficiency).

> SQL isn't runnable in the playground. Each query lists its expected result in comments. Runnable JavaScript simulations show pagination and DynamoDB access-pattern concepts.

**Sample schema used in the examples:**

```sql
CREATE TABLE users (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE meetings (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id     BIGINT NOT NULL REFERENCES users(id),
  title       TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL,
  ended_at    TIMESTAMPTZ,
  settings    JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE participants (
  meeting_id  BIGINT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     BIGINT NOT NULL REFERENCES users(id),
  joined_at   TIMESTAMPTZ NOT NULL,
  left_at     TIMESTAMPTZ,
  role        TEXT NOT NULL CHECK (role IN ('host','cohost','presenter','participant','visitor')),
  PRIMARY KEY (meeting_id, user_id, joined_at)
);
```

## SQL querying

### SQL vs NoSQL: how do you choose? 🔥

| | Relational (PostgreSQL, MySQL) | NoSQL (DynamoDB, MongoDB, Cassandra, Redis) |
|---|---|---|
| Data model | Tables, rows, **schemas**, relations with foreign keys | Key-value, document, wide-column, graph; flexible schema |
| Queries | **Ad-hoc SQL**, joins, aggregates, complex reporting | **Access-pattern driven**: fast for designed queries, poor for ad-hoc ones |
| Consistency | **ACID transactions** across rows and tables | Varies: DynamoDB offers transactions and strong reads per item; many systems are eventually consistent |
| Scaling | Vertical + read replicas; sharding is harder (Citus, Aurora Limitless) | **Horizontal partitioning built in**, predictable latency at huge scale |
| Ops (serverless) | Connection management is an issue with Lambda (use RDS Proxy) | **Serverless-native** (DynamoDB HTTP API, on-demand capacity) |

**Rule of thumb:**

- **Postgres** for relational business data with evolving query needs (LoadOTR vendors, loads, payments).
- **DynamoDB** for well-known access patterns at scale with serverless back ends (document metadata, sessions, events).
- Many systems use both, plus search (OpenSearch) and caching (Redis).

### Explain the different JOIN types 🔥

| Join | Returns |
|---|---|
| **INNER JOIN** | Rows with matches in **both** tables |
| **LEFT (OUTER) JOIN** | **All** rows from the left table, plus matches from the right (NULLs where there's no match) |
| RIGHT JOIN | The mirror of LEFT (rarely used; swap the tables instead) |
| **FULL OUTER JOIN** | All rows from both; NULLs where there's no match on either side |
| CROSS JOIN | The Cartesian product (every combination) |
| **Self join** | A table joined to itself (e.g. participants in the same meeting) |
| **Anti-join** | Rows **without** a match: `LEFT JOIN … WHERE right.id IS NULL`, or `NOT EXISTS` |
| Semi-join | Rows **with** at least one match, without duplicating them: `EXISTS` / `IN` |

```sql
-- Meetings with host name and participant count (meetings with 0 participants included)
SELECT m.id, m.title, u.name AS host, COUNT(p.user_id) AS participant_count
FROM meetings m
JOIN users u            ON u.id = m.host_id               -- inner: every meeting has a host
LEFT JOIN participants p ON p.meeting_id = m.id           -- left: keep meetings without participants
GROUP BY m.id, m.title, u.name
ORDER BY participant_count DESC;

-- Users who have never joined any meeting (anti-join)
SELECT u.id, u.email
FROM users u
WHERE NOT EXISTS (SELECT 1 FROM participants p WHERE p.user_id = u.id);

-- Pairs of users who were in the same meeting (self join)
SELECT DISTINCT a.user_id AS user_a, b.user_id AS user_b
FROM participants a
JOIN participants b ON a.meeting_id = b.meeting_id AND a.user_id < b.user_id;
```

**Gotcha:** putting a condition on the **right table in `WHERE`** turns a LEFT JOIN into an INNER JOIN (`WHERE p.role = 'host'` drops rows with NULLs). Put it in the **`ON` clause** to keep unmatched left rows.

### `WHERE` vs `HAVING`, and the logical order of SQL execution 🔥

**Logical evaluation order:**

1. `FROM`/`JOIN`
2. **`WHERE`** (filters rows)
3. `GROUP BY`
4. **`HAVING`** (filters groups)
5. `SELECT` (including window functions)
6. `DISTINCT`
7. `ORDER BY`
8. `LIMIT`/`OFFSET`

**Consequences:**

- `WHERE` can't use aggregates. **`HAVING` can.**
- Column aliases defined in `SELECT` generally can't be used in `WHERE` (Postgres allows them in `ORDER BY`, and in `GROUP BY` as an extension).
- **Filter early in `WHERE`** for performance; use `HAVING` only for aggregate conditions.

```sql
-- Hosts who ran more than 5 meetings longer than an hour in 2025
SELECT host_id, COUNT(*) AS long_meetings
FROM meetings
WHERE started_at >= '2025-01-01' AND started_at < '2026-01-01'
  AND ended_at - started_at > INTERVAL '1 hour'              -- row filter
GROUP BY host_id
HAVING COUNT(*) > 5                                          -- group filter
ORDER BY long_meetings DESC;
```

### Explain window functions with examples 🔥

**Window functions** compute values **across a set of related rows** (the "window") **without collapsing them** like `GROUP BY` does.

- Syntax: `func() OVER (PARTITION BY … ORDER BY … [frame])`.
- **Ranking:** `ROW_NUMBER()` (always unique: 1, 2, 3), `RANK()` (ties share a rank, then gaps: 1, 1, 3), `DENSE_RANK()` (ties without gaps: 1, 1, 2), `NTILE(n)`.
- **Offsets:** `LAG()`/`LEAD()` read the previous or next row. `FIRST_VALUE`/`LAST_VALUE`.
- **Aggregates over windows:** `SUM() OVER (ORDER BY …)` gives **running totals**; moving averages with frames (`ROWS BETWEEN 6 PRECEDING AND CURRENT ROW`).

```sql
-- Top 3 longest meetings per host (top-N per group)
SELECT *
FROM (
  SELECT m.*, ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY ended_at - started_at DESC) AS rn
  FROM meetings m
  WHERE ended_at IS NOT NULL
) ranked
WHERE rn <= 3;

-- Daily meeting counts with a running total and the change vs the previous day
SELECT day,
       meetings,
       SUM(meetings) OVER (ORDER BY day)                      AS running_total,
       meetings - LAG(meetings) OVER (ORDER BY day)          AS change_vs_prev_day,
       AVG(meetings) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS moving_avg_7d
FROM (
  SELECT date_trunc('day', started_at)::date AS day, COUNT(*) AS meetings
  FROM meetings GROUP BY 1
) daily
ORDER BY day;
```

### Solve the classic interview queries: second-highest value, duplicates, consecutive days 🔥

```sql
-- 1) Second-longest meeting duration (ties handled with DENSE_RANK)
SELECT DISTINCT duration
FROM (
  SELECT ended_at - started_at AS duration,
         DENSE_RANK() OVER (ORDER BY ended_at - started_at DESC) AS r
  FROM meetings WHERE ended_at IS NOT NULL
) t
WHERE r = 2;
-- Alternative: SELECT MAX(d) FROM durations WHERE d < (SELECT MAX(d) FROM durations);

-- 2) Find duplicate emails (case-insensitive) and how many times they occur
SELECT lower(email) AS email, COUNT(*) AS n
FROM users
GROUP BY lower(email)
HAVING COUNT(*) > 1;

-- 3) Delete duplicates, keeping the oldest row per email
DELETE FROM users u
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS rn
  FROM users
) d
WHERE u.id = d.id AND d.rn > 1;

-- 4) Users who joined meetings on 3+ consecutive days ("gaps and islands")
WITH days AS (
  SELECT DISTINCT user_id, joined_at::date AS d FROM participants
), grp AS (
  SELECT user_id, d, d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS island
  FROM days
)
SELECT user_id, MIN(d) AS streak_start, MAX(d) AS streak_end, COUNT(*) AS streak_days
FROM grp
GROUP BY user_id, island
HAVING COUNT(*) >= 3;

-- 5) Each participant's time in a meeting, and the % of the meeting they attended
SELECT p.meeting_id, p.user_id,
       SUM(COALESCE(p.left_at, m.ended_at) - p.joined_at) AS time_in_meeting,
       ROUND(100 * EXTRACT(EPOCH FROM SUM(COALESCE(p.left_at, m.ended_at) - p.joined_at))
                 / NULLIF(EXTRACT(EPOCH FROM m.ended_at - m.started_at), 0), 1) AS pct_attended
FROM participants p JOIN meetings m ON m.id = p.meeting_id
WHERE m.ended_at IS NOT NULL
GROUP BY p.meeting_id, p.user_id, m.ended_at, m.started_at;
```

### What are CTEs and recursive CTEs?

- A **CTE** (`WITH name AS (…)`) is a **named subquery** that makes complex queries readable. In Postgres 12+, CTEs are **inlined** by the optimiser unless `MATERIALIZED` is specified (before 12 they were always optimisation fences).
- **Recursive CTEs** walk **hierarchies or graphs**: org charts, folder trees (Nebraska Draw folders), threaded comments, bill of materials.

```sql
-- Folder tree: all descendants of folder 1 with their depth and path
WITH RECURSIVE tree AS (
  SELECT id, parent_id, name, 0 AS depth, name::text AS path
  FROM folders WHERE id = 1
  UNION ALL
  SELECT f.id, f.parent_id, f.name, t.depth + 1, t.path || ' / ' || f.name
  FROM folders f JOIN tree t ON f.parent_id = t.id
)
SELECT * FROM tree ORDER BY path;
```

## Performance

### How do indexes work, and which types does PostgreSQL offer? 🔥

An **index** is a separate data structure that lets the database **find rows without scanning the whole table**. The trade-offs: **faster reads**, **slower writes** (every insert or update maintains the indexes), and extra storage.

| Type | Structure | Good for |
|---|---|---|
| **B-tree** (default) | Balanced tree, sorted | Equality and **range** queries, `ORDER BY`, `LIKE 'abc%'` prefix matches |
| Hash | Hash table | Equality only (rarely better than B-tree) |
| **GIN** (Generalized Inverted Index) | Inverted index | **JSONB** containment (`@>`), **arrays**, **full-text search** (`tsvector`), `pg_trgm` for `ILIKE '%term%'` |
| GiST / SP-GiST | Generalised search trees | Geometric and spatial data (PostGIS), ranges, nearest neighbour, full text |
| **BRIN** | Block-range summaries | **Huge, naturally ordered** tables (time-series logs by timestamp), tiny index size |

**Techniques:**

- **Composite indexes** follow the **leftmost-prefix rule**. An index on `(host_id, started_at)` serves `WHERE host_id = ?` and `WHERE host_id = ? AND started_at > ?`, plus `ORDER BY started_at` for a given host. It does **not** serve `WHERE started_at > ?` alone. **Column order:** equality columns first, then range or sort columns.
- **Covering indexes / index-only scans:** `CREATE INDEX … ON meetings (host_id) INCLUDE (title)` answers queries from the index alone (with a visibility-map check).
- **Partial indexes:** `CREATE INDEX … ON meetings (started_at) WHERE ended_at IS NULL` (only live meetings): smaller and faster.
- **Expression indexes:** `CREATE UNIQUE INDEX ON users (lower(email))` for case-insensitive uniqueness.

**Why an index isn't used:**

- a function applied to the column (`WHERE lower(email) = …` without an expression index)
- implicit casts, leading wildcards (`LIKE '%x'`)
- low selectivity (the planner prefers a sequential scan when many rows match)
- outdated statistics (run `ANALYZE`)
- `OR` across columns, mismatched collations

### How do you read `EXPLAIN ANALYZE` and optimise a slow query? 🔥

`EXPLAIN` shows the **planner's chosen plan** with estimated costs and rows. **`EXPLAIN (ANALYZE, BUFFERS)`** actually **executes** the query and shows **real timings, row counts and buffer hits/reads**. (Be careful running it on writes; wrap it in a transaction and roll back.)

**What to look for:**

1. **Seq Scan** on a large table with a selective filter → a missing or unusable index.
2. **Estimated vs actual rows** differing wildly (e.g. estimated 10, actual 100,000) → stale statistics or correlated columns. Run `ANALYZE`, raise the statistics target, or create extended statistics. A bad estimate leads to a bad join strategy.
3. **Join algorithms:**
   - **Nested Loop:** good for small outer sets with indexed inner lookups
   - **Hash Join:** larger unsorted sets (watch for memory spilling to disk, `work_mem`)
   - **Merge Join:** both sides sorted
4. **Sort / Hash spilling to disk** ("external merge") → increase `work_mem` for that query, or add an index that provides the order.
5. **Index Scan vs Bitmap Heap Scan vs Index Only Scan.** "Rows Removed by Filter" being high means the index isn't selective enough; consider a composite or partial index.

**Optimisation workflow:**

1. Find slow queries with **`pg_stat_statements`** (total time, calls, mean).
2. Run `EXPLAIN ANALYZE`.
3. Add or adjust indexes, rewrite the query (avoid `SELECT *`, push filters down, replace correlated subqueries with joins or lateral joins, use keyset pagination), denormalise or cache if needed.
4. Re-measure.

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title FROM meetings
WHERE host_id = 42 AND started_at >= now() - interval '30 days'
ORDER BY started_at DESC
LIMIT 20;
-- Before: Seq Scan on meetings (rows removed by filter: 1.2M) + Sort  → ~350 ms
CREATE INDEX CONCURRENTLY idx_meetings_host_started ON meetings (host_id, started_at DESC) INCLUDE (title);
-- After: Index Only Scan using idx_meetings_host_started (rows=20) → ~0.3 ms, no sort needed
```

**`CREATE INDEX CONCURRENTLY`** avoids locking out writes on production tables. It takes longer, can't run inside a transaction, and can leave an invalid index if it fails.

### Offset pagination vs keyset (cursor) pagination 🔥

- **`LIMIT 20 OFFSET 10000`:** the database must **read and discard 10,000 rows**, so it gets **slower for deep pages**. Results **shift** when rows are inserted or deleted between requests, causing duplicates or skipped items.
- **Keyset / seek pagination:** `WHERE (started_at, id) < ($lastStartedAt, $lastId) ORDER BY started_at DESC, id DESC LIMIT 20`. It uses the index directly: **constant time** at any depth and **stable** under inserts. Include a **unique tie-breaker** (`id`). The trade-off: no "jump to page 57", only next and previous. It's what infinite scroll and APIs with `nextCursor` should use.

```js
// Why offset pagination duplicates items when new rows arrive, and keyset doesn't
let rows = Array.from({ length: 10 }, (_, i) => ({ id: 10 - i, startedAt: 1000 - i * 10 }));   // newest first
const byNewest = (a, b) => b.startedAt - a.startedAt || b.id - a.id;

const offsetPage = (offset, limit) => rows.slice().sort(byNewest).slice(offset, offset + limit);
const keysetPage = (cursor, limit) =>
  rows.slice().sort(byNewest)
    .filter((r) => !cursor || r.startedAt < cursor.startedAt || (r.startedAt === cursor.startedAt && r.id < cursor.id))
    .slice(0, limit);

const offsetP1 = offsetPage(0, 4);
const keysetP1 = keysetPage(null, 4);
rows.push({ id: 11, startedAt: 1005 }, { id: 12, startedAt: 1010 });     // two new meetings arrive
const offsetP2 = offsetPage(4, 4);
const keysetP2 = keysetPage(keysetP1.at(-1), 4);

const ids = (page) => page.map((r) => r.id);
console.log('offset page1', ids(offsetP1), 'page2', ids(offsetP2), '← duplicates!');
console.log('keyset page1', ids(keysetP1), 'page2', ids(keysetP2));

test('keyset pagination is stable under inserts', () => {
  expect(ids(offsetP2).some((id) => ids(offsetP1).includes(id))).toBe(true);
  expect(ids(keysetP2).some((id) => ids(keysetP1).includes(id))).toBe(false);
  expect(ids(keysetP2)).toEqual([6, 5, 4, 3]);
});
```

### How do you scale a PostgreSQL database?

1. **Query and index optimisation** first. That's usually the biggest win.
2. **Connection pooling:** Postgres uses a **process per connection**, which is expensive. Use **PgBouncer** (transaction pooling) or **RDS Proxy** for serverless and Lambda.
3. **Caching:** Redis for hot reads; materialised views for expensive aggregates (refresh concurrently).
4. **Read replicas** for read-heavy workloads (with replication lag, so route read-your-own-writes to the primary).
5. **Vertical scaling** (CPU, RAM for the cache, IOPS).
6. **Partitioning** (declarative range, list or hash partitioning) for huge tables, e.g. participants or events by month. Enables partition pruning and cheap retention (drop old partitions).
7. **Sharding** across nodes (Citus, application-level by tenant) when a single primary can't handle the writes. Adds complexity: cross-shard queries and transactions.
8. **Maintenance:** autovacuum tuning (MVCC bloat), monitoring (`pg_stat_*`), and archiving cold data.

## Transactions & consistency

### What is ACID, and what are the isolation levels and their anomalies? 🔥

**ACID:**

- **Atomicity:** all or nothing.
- **Consistency:** constraints and invariants hold after the transaction.
- **Isolation:** concurrent transactions don't interfere (to the configured level).
- **Durability:** committed data survives crashes (WAL).

| Isolation level | Dirty read | Non-repeatable read | Phantom read | Notes (PostgreSQL) |
|---|---|---|---|---|
| Read Uncommitted | Possible (in theory) | Possible | Possible | Postgres treats it as Read Committed |
| **Read Committed** (**PG default**) | ✗ | Possible | Possible | Each **statement** sees a fresh snapshot |
| **Repeatable Read** | ✗ | ✗ | ✗ in PG (snapshot isolation) | The whole **transaction** sees one snapshot; concurrent update conflicts raise **serialization errors**; write skew is still possible |
| **Serializable** | ✗ | ✗ | ✗ | **SSI** detects dangerous patterns, including **write skew**, and aborts; **retry** the transaction |

**The anomalies:**

- **Dirty read:** reading uncommitted data.
- **Non-repeatable read:** re-reading a row returns a different value.
- **Phantom:** re-running a query returns new or missing rows.
- **Lost update:** two read-modify-write transactions overwrite each other.
- **Write skew:** two transactions read overlapping data and make disjoint writes that together violate an invariant, e.g. "at least one host must remain".

**Application-level fixes for lost updates:** `SELECT … FOR UPDATE` (pessimistic), **optimistic locking** with a version column, atomic updates (`UPDATE … SET count = count + 1`), or SERIALIZABLE with retries.

### How does MVCC work in PostgreSQL?

**Multi-Version Concurrency Control:**

- Updates **create new row versions** instead of overwriting in place. Each version has `xmin` (the creating transaction) and `xmax` (the deleting or updating transaction).
- Each transaction or statement reads from a **snapshot** and sees only versions visible to it.
- **Readers don't block writers and writers don't block readers.** Only writer-writer conflicts on the same row wait.
- **Consequences:**
  - dead tuples accumulate and are cleaned by **VACUUM** (autovacuum)
  - table and index **bloat** if vacuum can't keep up
  - long-running transactions **prevent cleanup**, a classic production problem
  - transaction ID wraparound protection (anti-wraparound vacuum)
- **HOT updates** (Heap-Only Tuples) avoid index updates when no indexed column changes and there's space on the page.

### How do you implement a reliable job queue in Postgres?

Use **`SELECT … FOR UPDATE SKIP LOCKED`**: multiple workers safely claim different rows without blocking each other. It's ideal for "process recordings", "send emails" and outbox processing, without adding a separate queue system.

```sql
-- Worker loop: claim one pending job atomically
BEGIN;
SELECT id, payload FROM jobs
WHERE status = 'pending' AND run_at <= now()
ORDER BY run_at
FOR UPDATE SKIP LOCKED
LIMIT 1;
-- process, then:
UPDATE jobs SET status = 'done', finished_at = now() WHERE id = $1;
COMMIT;
```

**Related patterns:**

- **Transactional outbox:** write domain changes and an "event to publish" row in the **same transaction**. A relay then publishes events to SNS, SQS or Kafka. This avoids the dual-write problem.
- **Advisory locks** (`pg_try_advisory_lock`) for app-level mutual exclusion, such as a single scheduler instance.

### Optimistic vs pessimistic locking 🔥

- **Pessimistic:** lock the row first (`SELECT … FOR UPDATE`) so others wait. It's safe for high-contention, short operations, but locks reduce concurrency and risk deadlocks.
- **Optimistic:** read freely and **check at write time** that nobody changed the data:

```sql
UPDATE loads SET status = 'delivered', version = version + 1
WHERE id = $1 AND version = $2;   -- 0 rows updated → someone else changed it → reload & retry / show conflict
```

Optimistic locking suits **low-contention** web apps (two dispatchers rarely edit the same load). It maps directly to **HTTP `ETag` + `If-Match`** (412 Precondition Failed) and to **DynamoDB conditional writes**.

### Normalisation vs denormalisation

- **Normalise** (1NF → 2NF → 3NF/BCNF) to remove redundancy and update anomalies:
  - **1NF:** atomic values, no repeating groups.
  - **2NF:** no partial dependency on a composite key.
  - **3NF:** no transitive dependencies; non-key columns depend on "the key, the whole key and nothing but the key".
- **Denormalise deliberately** for read performance: cached counts (`participant_count`), materialised views, JSONB snapshots of rarely changing data, reporting tables. Keep them consistent with triggers, transactions or async jobs, and accept some staleness where it's fine.
- **Postgres JSONB:** flexible attributes (meeting `settings`) with GIN indexes. Don't put relational, queryable core data in JSON.

```sql
-- JSONB: meetings with recording enabled and 'webinar' mode
SELECT id, title FROM meetings
WHERE settings @> '{"recording": {"enabled": true}, "mode": "webinar"}';   -- uses a GIN index on settings
CREATE INDEX idx_meetings_settings ON meetings USING GIN (settings jsonb_path_ops);
SELECT settings->>'mode' AS mode, settings->'recording'->>'storage' AS storage FROM meetings WHERE id = 1;
```

### Which primary keys should you use: serial/identity, UUID v4 or UUID v7?

- **Identity/BIGSERIAL:** compact (8 bytes), sequential (good B-tree locality). But IDs are **guessable** (enumeration risks if exposed) and hard to generate outside the DB or merge across shards.
- **UUID v4:** random, so it can be generated anywhere and isn't guessable. Inserts land **randomly** in the index (page splits, poor cache locality), and it takes 16 bytes.
- **UUID v7** (RFC 9562, 2024): **time-ordered** (a millisecond timestamp prefix plus randomness). You get globally unique, client-generatable IDs **with sequential index locality**, and they sort by creation time. **It's a great default for new systems.** PostgreSQL 18 adds a built-in `uuidv7()` function.
- **Expose opaque IDs externally.** Don't leak sequential IDs if enumeration matters (IDOR still needs authorisation checks either way).

## DynamoDB

### Explain DynamoDB's data model and capacity 🔥

- **Table → items** (max **400 KB** each) → attributes. Schemaless, except for the **key**.
- **Primary key:**
  - **partition key (PK)** only, or
  - **PK + sort key (SK)** (a composite key)
  
  The PK is hashed to choose a **partition** (each partition supports about 3,000 RCU and 1,000 WCU, and roughly 10 GB). Items with the same PK are stored **sorted by SK**, so you can **query ranges** within a partition (`begins_with`, `between`, `>`).
- **Capacity:**
  - **On-demand:** pay per request; scales automatically. Good for spiky or unknown traffic, and the usual default.
  - **Provisioned:** RCU/WCU, with auto-scaling. Cheaper for steady load.
  - **1 RCU** = one strongly consistent read per second of up to 4 KB (or **two** eventually consistent reads). **1 WCU** = one write per second of up to 1 KB. Transactional reads and writes cost **double**.
- **Consistency:** reads are **eventually consistent by default**. **Strongly consistent** reads are available on the table and LSIs, **not on GSIs**.
- **Features:**
  - **Streams** (change data capture → Lambda)
  - **TTL** (automatic expiry)
  - **transactions** (`TransactWriteItems`, up to 100 items, all or nothing)
  - **conditional writes**
  - PITR backups, global tables (multi-region)
  - **DAX** (an in-memory cache)
  - PartiQL

### Query vs Scan, and GSI vs LSI 🔥

- **`Query`:** requires the **partition key** (plus optional SK conditions). It reads only that item collection, so it's **efficient**. Results are paginated at **1 MB per call** (follow `LastEvaluatedKey`).
- **`Scan`:** reads **the entire table** (then filters). **Expensive and slow.** Avoid it on hot paths; use it for exports, migrations and analytics (or parallel scans).
- **`FilterExpression` is applied after reading**, so you still **pay for the read capacity** of filtered-out items. Design keys so queries return exactly what you need.

| | Global Secondary Index (GSI) | Local Secondary Index (LSI) |
|---|---|---|
| Key | **Different PK and SK** | **Same PK**, different SK |
| When created | **Any time** | **Only at table creation** |
| Consistency | **Eventually consistent only** | Strongly consistent reads possible |
| Capacity | Its own capacity (it can throttle the table's writes if under-provisioned) | Shares the table's capacity |
| Limits | 20 per table (default) | 5 per table; **10 GB per partition-key value** (item collection limit) |
| Use | **New access patterns** (by owner, by status) | Alternative sort orders within the same partition |

**Projections:** `KEYS_ONLY`, `INCLUDE` or `ALL`. Project only what the access pattern needs, to save cost.

### What is single-table design? Model the Nebraska Draw / meetings domain 🔥

**Single-table design:** store **multiple entity types in one table**, with **generic, overloaded keys** (`PK`, `SK`, `GSI1PK`, `GSI1SK`). Related items share a partition, so **one Query returns an entity and its children**. This replaces joins.

**Method:**

1. **List the access patterns first.**
2. Design keys to satisfy each pattern with a Query (or GetItem).
3. Add GSIs for the rest.

| Access pattern | Key condition |
|---|---|
| Get document metadata | `PK = DOC#<id>, SK = META` |
| Get a document with all its versions | `PK = DOC#<id>, SK begins_with VERSION#` (+ META) |
| List a folder's documents, newest first | `PK = FOLDER#<id>, SK begins_with DOC#` (SK = `DOC#<createdAt>#<id>`), `ScanIndexForward=false` |
| A user's documents by last update | GSI1: `GSI1PK = OWNER#<userId>`, `GSI1SK = <updatedAt>` |
| Documents pending review | GSI2: `GSI2PK = STATUS#pending`, `GSI2SK = <updatedAt>` (watch for a hot partition; shard as `STATUS#pending#<0-9>` if it's huge) |

```js
// A tiny in-memory model of DynamoDB Query semantics over a single table + GSI
const table = [];
const put = (item) => table.push(item);
const query = ({ index, pk, skBeginsWith, newestFirst = false }) => {
  const [pkName, skName] = index ? [`${index}PK`, `${index}SK`] : ['PK', 'SK'];
  return table
    .filter((i) => i[pkName] === pk && (!skBeginsWith || String(i[skName]).startsWith(skBeginsWith)))
    .sort((a, b) => (newestFirst ? -1 : 1) * String(a[skName]).localeCompare(String(b[skName])));
};

put({ PK: 'DOC#d1', SK: 'META', title: 'Contract.pdf', GSI1PK: 'OWNER#u1', GSI1SK: '2025-06-03', status: 'pending', GSI2PK: 'STATUS#pending', GSI2SK: '2025-06-03' });
put({ PK: 'DOC#d1', SK: 'VERSION#0001', size: 1200 });
put({ PK: 'DOC#d1', SK: 'VERSION#0002', size: 1350 });
put({ PK: 'FOLDER#f9', SK: 'DOC#2025-06-03#d1', title: 'Contract.pdf' });
put({ PK: 'FOLDER#f9', SK: 'DOC#2025-06-05#d2', title: 'Invoice.pdf' });
put({ PK: 'DOC#d2', SK: 'META', title: 'Invoice.pdf', GSI1PK: 'OWNER#u1', GSI1SK: '2025-06-05' });

console.log('versions of d1:', query({ pk: 'DOC#d1', skBeginsWith: 'VERSION#' }).map((i) => i.SK));
console.log('folder f9 newest first:', query({ pk: 'FOLDER#f9', skBeginsWith: 'DOC#', newestFirst: true }).map((i) => i.title));
console.log("u1's docs by update:", query({ index: 'GSI1', pk: 'OWNER#u1', newestFirst: true }).map((i) => i.title));
console.log('pending review:', query({ index: 'GSI2', pk: 'STATUS#pending' }).map((i) => i.title));

test('every access pattern is a single Query', () => {
  expect(query({ pk: 'DOC#d1' })).toHaveLength(3);                       // item collection: meta + versions
  expect(query({ pk: 'FOLDER#f9', skBeginsWith: 'DOC#', newestFirst: true })[0].title).toBe('Invoice.pdf');
});
```

**Trade-offs:**

- Single-table design gives excellent performance and cost for known patterns, and fewer round trips.
- It's **harder to evolve** for new ad-hoc queries, harder to read, and analytics need exports (S3 + Athena) or streams into OpenSearch or Redshift.
- Many teams use a **moderately single-table** approach per bounded context.

### How do you avoid hot partitions and handle concurrency in DynamoDB? 🔥

- **Hot partitions:** traffic concentrated on one partition-key value (a celebrity user, a global "status#pending" key, today's date as PK) gets throttled. **Adaptive capacity** helps, but the fix is design:
  - **high-cardinality keys**
  - **write sharding** (append a random or calculated suffix `#0–9`, and query all shards in parallel)
  - avoid a sequential or time-only PK
- **Optimistic locking:** a `version` attribute plus a **`ConditionExpression`** (`#v = :expected`). The write fails with `ConditionalCheckFailedException` if someone else updated the item, and the client retries or shows a conflict.
- **Uniqueness and idempotency:** `attribute_not_exists(PK)` on create prevents duplicates. Store idempotency keys with a TTL.
- **Transactions:** `TransactWriteItems` for multi-item invariants, e.g. create a document **and** increment the folder count **and** write an audit item. They cost 2× and can conflict.
- **Atomic counters:** `UpdateExpression: "ADD views :one"`.
- **Batch operations:** `BatchGetItem` / `BatchWriteItem` (up to 100 and 25 items). Handle **`UnprocessedItems`** with backoff.
- **Pagination:** return `LastEvaluatedKey` as an **opaque, encoded cursor** to the frontend, and pass it back as `ExclusiveStartKey`.

### What are DynamoDB Streams and TTL used for?

- **Streams** give an ordered (per item) change log of inserts, updates and deletes, retained for **24 hours**, consumed by **Lambda** (event source mapping) or Kinesis. Uses:
  - **maintain search indexes** (OpenSearch) and aggregates and counters
  - **fan out events** (notify when a document is approved)
  - replicate data, write audit trails
  - trigger workflows (start the IDP pipeline when a document is uploaded)
- **TTL:** set an epoch-seconds attribute and DynamoDB **deletes the item automatically** (typically within a few days of expiry, at no write cost). Expiry deletes also appear in Streams. Uses: sessions, temporary upload records, idempotency keys, old WebSocket connection IDs, rate-limit windows.
