# Transactions, Isolation & Locking

Concurrency bugs are the bugs that pass every test and then lose money in production: a double charge, an oversold seat, two people booked into the same webinar slot, a counter that drifts.

Interviewers use this area to separate people who *use* databases from people who *understand* them. This doc covers:

- What ACID really guarantees, and how it's implemented.
- **Every isolation anomaly**, with timelines.
- How PostgreSQL and MySQL differ.
- Locking and deadlocks.
- Practical patterns: idempotency, no-oversell inventory, job queues.
- What to do when one transaction isn't enough: sagas and the outbox.

> The SQL isn't runnable here. **MVCC snapshots, lost updates, write skew, deadlock detection and sagas are simulated in runnable JavaScript with tests.** Change the interleavings and watch the anomalies appear and disappear.

## ACID and transactions

### What does ACID really guarantee, and how is each property implemented? 🔥

| Property | Guarantee | How it's implemented (Postgres / InnoDB) |
|---|---|---|
| **Atomicity** | All of the transaction's changes happen, or none do | MVCC row versions plus commit status (Postgres); the **undo log** for rollback (InnoDB). A crash before commit leaves the changes invisible or rolled back |
| **Consistency** | Every transaction moves the database from one **valid** state to another, as defined by **constraints** (PK, FK, UNIQUE, CHECK, EXCLUDE) | Constraint checks, some deferrable to commit (`DEFERRABLE INITIALLY DEFERRED`). **Application invariants are your job**, unless you encode them as constraints |
| **Isolation** | Concurrent transactions don't interfere *beyond what the isolation level allows* | **MVCC snapshots** plus **locks** (and predicate locks for SERIALIZABLE in Postgres) |
| **Durability** | Once COMMIT returns, the data survives a crash | **Write-ahead log (WAL / redo log)** is flushed with `fsync` at commit. Data pages are written later and recovered by replaying the WAL. **Group commit** batches fsyncs |

**Nuances that impress interviewers:**

- **The "C" is partly the application's responsibility.** "Balance never negative" is only guaranteed if it's a `CHECK (balance >= 0)` or your transaction logic is correct under the chosen isolation level.
- **Isolation is a dial, not a switch.** The default levels (Read Committed in Postgres, Repeatable Read in MySQL) **allow anomalies**.
- **Durability is configurable:**
  - `synchronous_commit = off` can lose the last few hundred milliseconds of commits on a crash, without corruption.
  - **Async replication** means a failover can lose transactions that were committed on the old primary.

### How do you run a transaction correctly from Node, Java and Python? 🔥

The most common bug in Node: **running `BEGIN` and `COMMIT` through a pool**, where each `pool.query()` may use a **different connection**. The statements aren't in one transaction at all.

```node
// ✗ WRONG: each pool.query can run on a different connection
await pool.query('BEGIN');
await pool.query('UPDATE accounts SET balance = balance - 100 WHERE id = 1');
await pool.query('UPDATE accounts SET balance = balance + 100 WHERE id = 2');
await pool.query('COMMIT');

// ✓ Check out ONE client, always release it, roll back on error
async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();                       // forgetting this leaks the connection: the pool slowly starves
  }
}

await withTransaction(pool, async (tx) => {
  await tx.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1]);
  await tx.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2]);
});
```

```java
// Spring: declarative. The proxy opens the transaction, commits, or rolls back on a RuntimeException
@Transactional
public void transfer(long from, long to, BigDecimal amount) {
    accountRepo.debit(from, amount);
    accountRepo.credit(to, amount);
}
```

```python
# Django
from django.db import transaction
with transaction.atomic():
    Account.objects.filter(id=1).update(balance=F("balance") - 100)
    Account.objects.filter(id=2).update(balance=F("balance") + 100)

# SQLAlchemy 2.0
with Session(engine) as session, session.begin():      # commits on exit, rolls back on exception
    session.execute(update(Account).where(Account.id == 1).values(balance=Account.balance - 100))
```

**What happens after an error inside a Postgres transaction:**

- The transaction enters an **aborted state**: `current transaction is aborted, commands ignored until end of transaction block`.
- You **must** `ROLLBACK` (or roll back to a savepoint).
- That's why the helper above always rolls back in `catch`.

### What are savepoints, and how do "nested transactions" work?

SQL has **no truly nested transactions**. **Savepoints** mark a point you can roll back to without aborting the whole transaction:

```sql
BEGIN;
INSERT INTO orders (customer_id, status, total) VALUES (1, 'pending', 500);
SAVEPOINT try_coupon;
UPDATE coupons SET used = used + 1 WHERE code = 'DIWALI' AND used < max_uses;   -- may violate a constraint
-- on error:
ROLLBACK TO SAVEPOINT try_coupon;     -- the order insert survives
COMMIT;
```

**Where savepoints show up in frameworks:**

- **Spring** `Propagation.NESTED` uses JDBC savepoints.
- **Django:** nested `atomic()` blocks create savepoints automatically.
- **SQLAlchemy:** `session.begin_nested()`.

**Cost:** each savepoint costs a subtransaction. Hundreds per transaction (for example a savepoint per row in a loop) degrade Postgres performance, through **subtransaction SLRU overflow**. Avoid that pattern on hot paths.

### Why are long transactions dangerous? 🔥

A transaction that stays open for minutes, even an idle one, harms everyone else:

1. **It holds locks**, blocking writers and DDL. A queued `ALTER TABLE` then blocks *everyone*.
2. **It holds back VACUUM.** Dead rows newer than its snapshot can't be removed, so tables and indexes **bloat** and queries slow down.
3. **On MySQL it grows the undo history** (history list length), which slows reads.
4. **It ties up a pooled connection**, so the pool starves.
5. **It raises conflict and deadlock probability.**

**Rules:**

- **Never make HTTP calls, send emails, or wait for user input inside a database transaction.** Do the external work before or after, or use the outbox pattern.
- Set `idle_in_transaction_session_timeout` and `statement_timeout`.
- Batch huge updates into chunks, each in its own transaction.

### What does `now()` return inside a transaction?

In Postgres, `now()` (= `transaction_timestamp()`) is **frozen at the start of the transaction**. Every statement in it sees the same value.

| Function | Value |
|---|---|
| `now()` / `transaction_timestamp()` | Start of the transaction |
| `statement_timestamp()` | Start of the current statement |
| `clock_timestamp()` | Actual wall-clock time; changes even within a statement |

**Consequences:**

- Rows inserted in one long transaction all share a `created_at`, which is good for consistency.
- Measuring duration with `now()` inside a transaction gives 0. Use `clock_timestamp()`.

## Isolation levels and anomalies

### Explain each read and write anomaly with a timeline 🔥

**Dirty read:** you read another transaction's **uncommitted** data, which it may then roll back.

```text
T1: UPDATE accounts SET balance = 0 WHERE id = 1;      (not committed)
T2:                                   SELECT balance → 0   ← dirty
T1: ROLLBACK;                                            (balance was never really 0)
```

**Non-repeatable read:** the **same row**, read twice in one transaction, returns different values.

```text
T1: SELECT balance → 100
T2:                 UPDATE … SET balance = 50; COMMIT;
T1: SELECT balance → 50                                   ← changed under you
```

**Phantom read:** the **same query** returns a **different set of rows**.

```text
T1: SELECT COUNT(*) FROM bookings WHERE room = 'A' AND day = 'Mon' → 0
T2:                 INSERT INTO bookings (room, day) VALUES ('A','Mon'); COMMIT;
T1: SELECT COUNT(*) …  → 1                                ← a phantom row appeared
```

**Lost update:** two read-modify-write cycles interleave, and one write overwrites the other.

```text
T1: SELECT stock → 10                T2: SELECT stock → 10
T1: UPDATE stock = 9; COMMIT         T2: UPDATE stock = 9; COMMIT     ← two sales, stock only dropped by 1
```

**Read skew:** you see **parts of two different states**. For example, you read account A before a transfer and account B after it, so the total looks wrong.

**Write skew:** two transactions read an **overlapping set**, each makes a **disjoint** write that is valid alone, and together they **violate an invariant**.

```text
Invariant: at least one doctor on call.  On call: Alice, Bob.
T1 (Alice): SELECT COUNT(*) WHERE on_call → 2  → UPDATE doctors SET on_call=false WHERE name='Alice'
T2 (Bob):   SELECT COUNT(*) WHERE on_call → 2  → UPDATE doctors SET on_call=false WHERE name='Bob'
Both commit → nobody is on call.  No row was written twice, so row locks never conflicted.
```

Write skew is the anomaly that **snapshot isolation (Postgres REPEATABLE READ) still allows**. It's behind real double-booking bugs.

### Which anomalies does each isolation level allow, in Postgres vs MySQL? 🔥

**The SQL standard's definitions:**

| Level | Dirty read | Non-repeatable read | Phantom |
|---|---|---|---|
| Read Uncommitted | possible | possible | possible |
| Read Committed | ✗ | possible | possible |
| Repeatable Read | ✗ | ✗ | possible |
| Serializable | ✗ | ✗ | ✗ |

**What real engines do:**

| Level | PostgreSQL | MySQL InnoDB |
|---|---|---|
| Read Uncommitted | Behaves as **Read Committed** (no dirty reads, ever) | Dirty reads possible |
| **Read Committed** | **Default.** A **new snapshot per statement**. Lost updates and write skew are possible | No gap locks. A new snapshot per statement |
| **Repeatable Read** | **Snapshot isolation:** one snapshot for the whole transaction. **No phantoms** either. Concurrent updates of the same row → *"could not serialize access due to concurrent update"* (so lost updates are **prevented**). **Write skew is still possible** | **Default.** Plain `SELECT`s read a consistent snapshot, **but locking reads and UPDATE/DELETE see the latest committed data** and take **next-key locks**. Lost updates in read-then-write code are **not detected** |
| **Serializable** | **SSI (Serializable Snapshot Isolation):** snapshot isolation plus tracking of read-write dependencies; aborts dangerous patterns. **No anomalies; you must retry `40001` errors** | Lock-based: plain SELECTs become `FOR SHARE` (with autocommit off). Lots of blocking and deadlocks |

**Elsewhere:**

- **SQL Server:** defaults to locking Read Committed, with an optional `READ_COMMITTED_SNAPSHOT`.
- **Oracle:** "SERIALIZABLE" is actually **snapshot isolation**.

**A strong closing line:** "The default level of most databases allows lost updates or write skew, so any read-then-write logic needs either an atomic statement, a lock, a version check, or SERIALIZABLE with retries."

### How does MVCC give each transaction its own snapshot? 🔥

**Multi-Version Concurrency Control:** writers create **new row versions** instead of overwriting, and every reader sees the versions that were committed as of **its snapshot**.

**In PostgreSQL:**

- Each tuple has **`xmin`** (the transaction that created it) and **`xmax`** (the transaction that deleted or updated it, or 0).
- A **snapshot** records which transactions were committed when it was taken: `xmin`, `xmax`, and the list of in-progress transaction IDs.
- A row version is **visible** if its creator is committed in the snapshot (or is you), **and** its deleter is not.
- **Readers never block writers, and writers never block readers.** Only writer vs writer on the **same row** blocks.
- **Read Committed** takes a snapshot **per statement**. **Repeatable Read/Serializable** take one **at the first statement** of the transaction.
- **The cost:** dead versions accumulate, and **VACUUM** must clean them up.

**InnoDB** keeps only the latest version in the table, plus **undo records** to reconstruct older versions for snapshots (a "read view").

This runnable mini-MVCC store shows exactly why Read Committed sees a concurrent commit and Repeatable Read doesn't:

```js
// Minimal MVCC: row versions with xmin/xmax; a snapshot = the set of committed tx ids
class MVCC {
  constructor() { this.versions = new Map(); this.nextTx = 1; this.committed = new Set(); }
  begin(isolation = 'read committed') {
    const tx = { id: this.nextTx++, isolation, snapshot: null };
    if (isolation === 'repeatable read') tx.snapshot = new Set(this.committed);   // one snapshot per transaction
    return tx;
  }
  snap(tx) { return tx.isolation === 'repeatable read' ? tx.snapshot : new Set(this.committed); } // RC: per statement
  visible(v, tx, snap) {
    const created = v.xmin === tx.id || snap.has(v.xmin);
    const deleted = v.xmax !== null && (v.xmax === tx.id || snap.has(v.xmax));
    return created && !deleted;
  }
  read(tx, key) {
    const s = this.snap(tx);
    return (this.versions.get(key) ?? []).find((v) => this.visible(v, tx, s))?.value;
  }
  write(tx, key, value) {
    const s = this.snap(tx);
    const list = this.versions.get(key) ?? [];
    const current = list.find((v) => this.visible(v, tx, s));
    if (current) current.xmax = tx.id;                 // old version "deleted" by this tx (invisible until commit)
    list.unshift({ xmin: tx.id, xmax: null, value });  // new version, invisible to others until commit
    this.versions.set(key, list);
  }
  commit(tx) { this.committed.add(tx.id); }
  // rollback = simply never commit: versions with an uncommitted xmin are never visible
}

const db = new MVCC();
const setup = db.begin(); db.write(setup, 'balance', 100); db.commit(setup);

const rc = db.begin('read committed');
const rr = db.begin('repeatable read');
const w = db.begin();

const reads = { rcBefore: db.read(rc, 'balance'), rrBefore: db.read(rr, 'balance') };
db.write(w, 'balance', 50);
reads.rcDuringUncommitted = db.read(rc, 'balance');   // no dirty read
db.commit(w);
reads.rcAfter = db.read(rc, 'balance');               // non-repeatable read
reads.rrAfter = db.read(rr, 'balance');               // stable snapshot
reads.writerSees = db.read(db.begin(), 'balance');
console.log(reads);

test('no isolation level in Postgres shows uncommitted data', () => {
  expect(reads.rcDuringUncommitted).toBe(100);
});
test('Read Committed sees the concurrent commit; Repeatable Read does not', () => {
  expect(reads.rcBefore).toBe(100);
  expect(reads.rcAfter).toBe(50);
  expect(reads.rrBefore).toBe(100);
  expect(reads.rrAfter).toBe(100);
  expect(reads.writerSees).toBe(50);
});
```

### What does Read Committed do when two transactions update the same row?

In Postgres Read Committed:

1. If T2 tries to `UPDATE` a row that T1 has updated but not committed, **T2 waits** for T1.
2. After T1 commits, T2 **re-reads the newest version of that row** and **re-evaluates its WHERE clause** on it (the "EvalPlanQual" recheck). If the row still matches, T2 applies its update **on top of T1's**.
3. That's why `UPDATE accounts SET balance = balance - 100 WHERE id = 1` is safe under Read Committed: the expression is recomputed from the latest version.

**The subtle anomaly:**

- The recheck only looks at **that row**.
- A statement like `UPDATE … WHERE id IN (SELECT … aggregate over other rows)` can act on a stale view of the other rows.
- If T1 changed a row so that it **now** matches T2's WHERE, T2 **won't** pick it up, because it wasn't in T2's original scan.

For complex read-then-write logic, use explicit locks or higher isolation.

### What is write skew, and how do you prevent it? 🔥

Write skew happens under **snapshot isolation** (Postgres REPEATABLE READ, Oracle "SERIALIZABLE", many NoSQL "transactions"):

- The two transactions write **different rows**, so no row-level conflict is detected.
- But each one's decision was based on data the other changed.

**Real examples:**

- Double-booking a meeting room (each checks "no overlapping booking", each inserts one).
- Two admins demoting each other.
- Overspending a shared budget across two line items.
- Usernames claimed concurrently without a unique index.

**Fixes, from most to least robust:**

1. **Make the database enforce it:** a UNIQUE or **EXCLUDE** constraint (no overlapping ranges), CHECK, or FK. This is race-proof by design.
2. **`SERIALIZABLE`** with a **retry loop**. Postgres SSI detects the read-write dependency cycle and aborts one transaction.
3. **Lock what you read:** `SELECT … FOR UPDATE` on the rows the decision depends on (here, the on-call doctors).
4. **Materialise the conflict:** if the "rows" don't exist yet (phantoms), lock a **parent row** both transactions must touch (for example `SELECT … FROM rooms WHERE id = $1 FOR UPDATE`), or take an advisory lock on the room/day key.

The simulation shows snapshot isolation letting write skew through, and a serializable validation catching it. The validation is a simplified optimistic check: "did anything I read change since my snapshot?"

```js
// Write skew: invariant "at least one doctor on call"
function makeDb() {
  return { data: { alice: true, bob: true }, versions: { alice: 1, bob: 1 } };
}
function begin(db) {
  return { snapshot: structuredClone(db.data), readVersions: {}, writes: {} };
}
function read(db, tx, key) { tx.readVersions[key] = db.versions[key]; return tx.snapshot[key]; }
function goOffCall(db, tx, me) {
  const onCall = ['alice', 'bob'].filter((d) => read(db, tx, d)).length;
  if (onCall >= 2) tx.writes[me] = false;               // valid decision *in my snapshot*
}
function commit(db, tx, mode) {
  if (mode === 'serializable') {
    for (const [k, v] of Object.entries(tx.readVersions)) {
      if (db.versions[k] !== v) throw new Error('could not serialize access (40001): retry');
    }
  }
  for (const [k, v] of Object.entries(tx.writes)) { db.data[k] = v; db.versions[k]++; }
}

function scenario(mode) {
  const db = makeDb();
  const t1 = begin(db), t2 = begin(db);                 // both start before either commits
  goOffCall(db, t1, 'alice');
  goOffCall(db, t2, 'bob');
  const errors = [];
  for (const t of [t1, t2]) { try { commit(db, t, mode); } catch (e) { errors.push(e.message); } }
  return { onCall: Object.values(db.data).filter(Boolean).length, errors };
}

console.log('snapshot isolation:', scenario('snapshot'));
console.log('serializable      :', scenario('serializable'));

test('snapshot isolation allows write skew (nobody on call)', () => {
  expect(scenario('snapshot').onCall).toBe(0);
});
test('serializable aborts the second transaction', () => {
  const r = scenario('serializable');
  expect(r.onCall).toBe(1);
  expect(r.errors).toHaveLength(1);
});
```

### How does SERIALIZABLE work in Postgres, and how do you use it safely? 🔥

**SSI (Serializable Snapshot Isolation), Postgres 9.1+:**

- Transactions still run on snapshots, so **reads don't block writes**.
- Postgres also tracks **SIRead (predicate) locks** on what each transaction **read**: rows, pages, or whole relations for sequential scans.
- If it finds a **dangerous structure**, two consecutive read-write anti-dependencies (T1 → T2 → T3) that could form a cycle, it **aborts** one transaction with **`SQLSTATE 40001`** (`could not serialize access due to read/write dependencies among transactions`).

**Using it safely:**

1. **Always retry** on `40001`, and on deadlock `40P01`. Rerun the **whole transaction** from the beginning, not just the last statement.
2. **Keep transactions short.** Long ones increase conflicts.
3. Declare **`READ ONLY`** for reporting transactions. `SERIALIZABLE READ ONLY DEFERRABLE` waits for a safe snapshot and then never aborts.
4. **Good indexes reduce false positives.** Sequential scans take relation-level SIRead locks, so they conflict with any write to the table.

```node
// Generic retry wrapper for serialization failures and deadlocks
const RETRYABLE = new Set(['40001', '40P01']);

async function serializable(pool, fn, { attempts = 5 } = {}) {
  for (let i = 1; ; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (!RETRYABLE.has(err.code) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, Math.random() * 20 * 2 ** i));   // jittered backoff
    } finally {
      client.release();
    }
  }
}
```

**When to choose SERIALIZABLE:** complex invariants spanning many rows, where reasoning about locks is error-prone (financial ledgers, scheduling). Cost: some throughput and retries. **When not to:** simple counters or single-row updates, where atomic statements are cheaper.

## Locking

### How do you prevent lost updates? Compare the four techniques 🔥

| Technique | How | Pros | Cons |
|---|---|---|---|
| **Atomic update** | `UPDATE products SET stock = stock - 1 WHERE id = $1 AND stock >= 1` | One statement, no app-side race, fastest | Only for logic expressible in SQL |
| **Pessimistic lock** | `SELECT … FOR UPDATE`, compute in the app, `UPDATE`, `COMMIT` | Simple reasoning; the second writer waits | Holds locks across app logic; deadlock risk; bad for long work |
| **Optimistic lock** (version column) | `UPDATE … SET …, version = version + 1 WHERE id = $1 AND version = $2`; 0 rows means conflict, so retry or report | No locks held; great for **user edits** (forms, documents) and low contention | Retries under high contention; the app must handle conflicts |
| **Isolation level** | Postgres REPEATABLE READ or SERIALIZABLE aborts the second updater | Covers complex logic | Retries; MySQL RR does *not* detect this |

**Optimistic locking in frameworks:**

- JPA `@Version` throws `OptimisticLockException`.
- Mongoose `optimisticConcurrency: true`.
- In HTTP APIs, **ETag + `If-Match`** gives **412 Precondition Failed** on conflict. This is how collaborative editors and REST APIs prevent overwrites. It's useful for scQuill-style document editing.

The simulation runs two concurrent "buy 1 item" requests with an `await` between read and write, exactly like real async I/O:

```js
const tick = () => new Promise((r) => setTimeout(r, 1));

function makeDb() {
  const row = { id: 1, stock: 10, version: 1 };
  return {
    row,
    async select() { await tick(); return { ...row }; },
    async update(fields) { await tick(); Object.assign(row, fields); return 1; },
    async updateIfVersion(fields, version) {           // UPDATE … WHERE id = 1 AND version = $v
      await tick();
      if (row.version !== version) return 0;
      Object.assign(row, fields, { version: version + 1 });
      return 1;
    },
    async atomicDecrement(qty) {                       // UPDATE … SET stock = stock - $1 WHERE stock >= $1
      await tick();
      if (row.stock < qty) return 0;
      row.stock -= qty;                                // read + write inside one "statement"
      return 1;
    },
  };
}

async function buyNaive(db) {
  const { stock } = await db.select();
  await db.update({ stock: stock - 1 });               // overwrites a concurrent sale
}
async function buyOptimistic(db) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const { stock, version } = await db.select();
    if (stock < 1) throw new Error('sold out');
    if (await db.updateIfVersion({ stock: stock - 1 }, version)) return attempt;
  }
  throw new Error('too much contention');
}

test('naive read-modify-write loses an update', async () => {
  const db = makeDb();
  await Promise.all([buyNaive(db), buyNaive(db)]);
  expect(db.row.stock).toBe(9);                        // two sales, but stock only dropped by one
});
test('optimistic locking retries the loser and keeps both sales', async () => {
  const db = makeDb();
  const attempts = await Promise.all([buyOptimistic(db), buyOptimistic(db)]);
  expect(db.row.stock).toBe(8);
  expect(attempts.sort()).toEqual([1, 2]);             // one request needed a retry
});
test('atomic conditional update never oversells', async () => {
  const db = makeDb();
  db.row.stock = 3;
  const results = await Promise.all(Array.from({ length: 5 }, () => db.atomicDecrement(1)));
  expect(results.filter(Boolean)).toHaveLength(3);
  expect(db.row.stock).toBe(0);
});
```

### What row-level lock modes exist? Explain `NOWAIT` and `SKIP LOCKED`

**Postgres row locks:**

| Lock | Taken by | Blocks |
|---|---|---|
| `FOR UPDATE` | `SELECT … FOR UPDATE`, `DELETE`, `UPDATE` of key columns | All other row locks |
| `FOR NO KEY UPDATE` | Ordinary `UPDATE` (not changing key columns) | Everything except `FOR KEY SHARE` |
| `FOR SHARE` | `SELECT … FOR SHARE` | Updates and deletes |
| `FOR KEY SHARE` | **Foreign-key checks** on the referenced row | Deletes and key updates only |

The `NO KEY` / `KEY SHARE` split exists so that **inserting a child row (an FK check) doesn't block ordinary updates of the parent**.

**Modifiers:**

- **`NOWAIT`**: fail immediately (`55P03 lock_not_available`) instead of waiting. Good for "someone else is editing this, try later" UX.
- **`SKIP LOCKED`**: silently skip locked rows. It's the foundation of **job queues** and **seat allocation**. Workers grab different rows without blocking each other.

```sql
-- Job queue worker: claim up to 10 jobs; concurrent workers get different rows
WITH claimed AS (
  SELECT id FROM jobs
  WHERE status = 'pending' AND run_at <= now()
  ORDER BY run_at
  LIMIT 10
  FOR UPDATE SKIP LOCKED
)
UPDATE jobs j SET status = 'running', locked_at = now(), attempts = attempts + 1
FROM claimed WHERE j.id = claimed.id
RETURNING j.*;
```

`SKIP LOCKED` gives an **inconsistent view on purpose**. Use it for work distribution, never for reports.

### Which table-level locks does DDL take, and how do you migrate safely? 🔥

| Lock mode | Taken by | Conflicts with |
|---|---|---|
| `ACCESS SHARE` | `SELECT` | Only `ACCESS EXCLUSIVE` |
| `ROW EXCLUSIVE` | `INSERT`, `UPDATE`, `DELETE` | `SHARE` and stronger |
| `SHARE UPDATE EXCLUSIVE` | `VACUUM`, `ANALYZE`, **`CREATE INDEX CONCURRENTLY`**, `VALIDATE CONSTRAINT` | Itself and stronger; **allows reads and writes** |
| `SHARE` | `CREATE INDEX` (non-concurrent) | **Writes** |
| `ACCESS EXCLUSIVE` | Most `ALTER TABLE`, `DROP`, `TRUNCATE`, `VACUUM FULL`, `REFRESH MATERIALIZED VIEW` (non-concurrent) | **Everything, including SELECT** |

**Safe migration patterns (Postgres):**

- **Add a column with a constant default:** instant since PG11 (metadata only). A **volatile** default (`random()`, or `now()` on older versions) rewrites the table.
- **Add a FK or CHECK constraint:**
  1. `ADD CONSTRAINT … NOT VALID` (short lock; new rows are checked).
  2. Then `VALIDATE CONSTRAINT` (weaker lock; scans existing rows without blocking writes).
- **`SET NOT NULL`:** first add `CHECK (col IS NOT NULL) NOT VALID` and validate it. Then `SET NOT NULL` skips the full scan (PG12+).
- **Indexes:** `CREATE INDEX CONCURRENTLY`.
- **Always set `lock_timeout`** so a migration fails fast rather than queueing the whole application behind it.
- **Rename or drop columns** with expand/contract across deploys (see [Schema Design](/docs/db-schema-design)).

### What is a deadlock, how do databases detect it, and how do you prevent it? 🔥

A **deadlock** is a cycle of transactions each waiting for a lock another holds:

```text
T1: UPDATE accounts … WHERE id = 1   (locks row 1)
T2: UPDATE accounts … WHERE id = 2   (locks row 2)
T1: UPDATE accounts … WHERE id = 2   (waits for T2)
T2: UPDATE accounts … WHERE id = 1   (waits for T1)   → cycle
```

**Detection:**

- **Postgres:** waits `deadlock_timeout` (1 s by default), then searches the **wait-for graph** for a cycle. It aborts one transaction with **`40P01 deadlock detected`**.
- **InnoDB:** detects immediately (`innodb_deadlock_detect`) and rolls back the transaction with the fewest changes. Without detection, `innodb_lock_wait_timeout` (50 s) applies.

**Prevention:**

1. **Lock in a consistent global order.** For transfers, update the **lower account id first**, whatever the transfer direction. This removes the cycle entirely.
2. **Keep transactions short** and touch as few rows as possible.
3. **Lock everything up front:** `SELECT … WHERE id IN (1, 2) ORDER BY id FOR UPDATE`.
4. **Index your foreign keys and WHERE columns.** Unindexed scans lock or wait on more rows than needed, especially with InnoDB gap locks.
5. **Retry on deadlock errors.** They're expected under concurrency. Log them and alert on rates, not individual occurrences.

```js
// Deadlock detection = cycle detection in the wait-for graph (txA waits for txB  →  edge A→B)
function findDeadlock(waitsFor) {
  const state = new Map();                       // undefined = unvisited, 1 = on stack, 2 = done
  const stack = [];
  function dfs(tx) {
    state.set(tx, 1); stack.push(tx);
    for (const next of waitsFor[tx] ?? []) {
      if (state.get(next) === 1) return stack.slice(stack.indexOf(next));   // back edge: cycle found
      if (!state.has(next)) { const c = dfs(next); if (c) return c; }
    }
    state.set(tx, 2); stack.pop();
    return null;
  }
  for (const tx of Object.keys(waitsFor)) if (!state.has(tx)) { const c = dfs(tx); if (c) return c; }
  return null;
}
// Pick a victim: the youngest transaction (highest id) does the least wasted work
const victim = (cycle) => cycle.reduce((a, b) => (Number(a.slice(1)) > Number(b.slice(1)) ? a : b));

const graph = { T1: ['T2'], T2: ['T3'], T3: ['T1'], T4: ['T1'] };
const cycle = findDeadlock(graph);
console.log('cycle:', cycle, 'victim:', cycle && victim(cycle));

test('detects the cycle and picks a victim', () => {
  expect(cycle).toEqual(['T1', 'T2', 'T3']);
  expect(victim(cycle)).toBe('T3');
});
test('a chain of waits without a cycle is not a deadlock', () => {
  expect(findDeadlock({ T1: ['T2'], T2: ['T3'], T3: [] })).toBeNull();
});
```

### What are InnoDB record, gap and next-key locks? 🔥

MySQL's REPEATABLE READ prevents phantoms for **locking reads** by locking **ranges**, not just rows:

| Lock | Locks | Purpose |
|---|---|---|
| **Record lock** | One index record | Normal row lock |
| **Gap lock** | The **gap between** index records (no record itself) | Stops inserts into a range |
| **Next-key lock** | Record plus the gap before it | Default for range scans in RR; prevents phantoms |
| **Insert intention lock** | A special gap lock taken by INSERT | Concurrent inserts into the same gap at different positions don't block each other |

**Consequences:**

- `SELECT … WHERE amount > 100 FOR UPDATE` locks the **range**, so other sessions **can't insert** a row with amount 150 until you commit.
- **Locks are taken on index records you scan, not just rows you return.** With no usable index, an `UPDATE … WHERE unindexed_col = ?` effectively locks the **whole table**.
- Gap locks are a common source of **deadlocks** with concurrent inserts. Switching to **READ COMMITTED** (with row-based binlog) removes most gap locking, which many high-concurrency MySQL shops do.

Postgres has **no gap locks**. It prevents phantoms through snapshots (RR) or predicate locks (SERIALIZABLE).

### What are advisory locks, and when would you use them?

**Advisory locks** are application-defined mutexes **managed by Postgres** and keyed by a number. The database attaches no meaning to them.

```sql
-- Ensure only one instance of a cron job runs, across all app servers
SELECT pg_try_advisory_lock(hashtext('nightly-invoice-job'));   -- true → you got it; false → another node runs it
-- … do the work …
SELECT pg_advisory_unlock(hashtext('nightly-invoice-job'));

-- Transaction-scoped: released automatically at COMMIT/ROLLBACK (safe with PgBouncer transaction mode)
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('room:' || $1 || ':' || $2));   -- serialise bookings per room/day
-- check for overlaps, insert the booking
COMMIT;
```

**Use cases:**

- Singleton schedulers.
- Serialising work per entity (per tenant, per room-day) when there's no row to lock.
- Coordinating schema migrations.

**Caveats:**

- Session-level locks stay held if you forget to unlock, until the connection closes, and **pooled connections don't close**.
- `hashtext` collisions are possible but harmless (over-serialisation).
- For cross-database or cross-service locks, use Redis or etcd. See [Redis & Caching](/docs/redis-caching).

## Practical patterns

### Design a booking or inventory flow that never oversells 🔥

**Fungible stock** (N identical tickets): one atomic conditional update:

```sql
UPDATE ticket_inventory
SET available = available - $2
WHERE event_id = $1 AND available >= $2
RETURNING available;                           -- 0 rows → sold out; no race possible

ALTER TABLE ticket_inventory ADD CONSTRAINT available_non_negative CHECK (available >= 0);  -- backstop
```

**Specific seats** (seat 14C): hold with `SKIP LOCKED` and expire the holds:

```sql
BEGIN;
WITH picked AS (
  SELECT id FROM seats
  WHERE event_id = $1 AND status = 'free'
  ORDER BY row_no, seat_no
  LIMIT $2
  FOR UPDATE SKIP LOCKED                       -- concurrent buyers get different seats, no waiting
)
UPDATE seats s SET status = 'held', held_by = $3, held_until = now() + interval '10 minutes'
FROM picked WHERE s.id = picked.id
RETURNING s.id;
COMMIT;

-- Payment succeeds → status = 'sold'.  A sweeper releases expired holds:
UPDATE seats SET status = 'free', held_by = NULL WHERE status = 'held' AND held_until < now();
```

**Time slots** (a webinar room or meeting room): an **exclusion constraint**, so overlapping bookings are impossible:

```sql
ALTER TABLE bookings ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&);
```

**At massive scale (flash sales):**

1. Pre-split the inventory into **N shard rows**, or decrement in **Redis** (`DECRBY` with a Lua check).
2. Reconcile asynchronously.
3. Queue the requests.

The principle is the same: **the check and the decrement must be one atomic operation.**

### How do you implement idempotency keys for a payment or order API? 🔥

**The problem:** the client times out and retries, or the user double-clicks, so you charge twice. **The fix:** the client sends an `Idempotency-Key` header (a UUID per logical operation), and the server **remembers the result**.

```sql
CREATE TABLE idempotency_keys (
  key           text        NOT NULL,
  user_id       bigint      NOT NULL,
  request_hash  text        NOT NULL,            -- detects the same key reused with a different body
  status        text        NOT NULL DEFAULT 'processing',   -- processing | completed
  response_code int,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
```

**Flow:**

1. **Claim the key:**
   ```sql
   INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES (…)
   ON CONFLICT DO NOTHING
   RETURNING key;
   ```
2. **If the insert happened**, do the work **and store the response in the same transaction** as the business effect (the order row). Commit.
3. **If the key already existed:**
   - `completed` with the same hash: **replay the stored response** (same status code and body).
   - `processing`: return **409 Conflict** ("request in progress"), so the client retries later.
   - Different `request_hash`: return **422**. The key was reused for a different request.
4. Expire keys after 24–72 hours with a cleanup job.

**External side effects** (calling Stripe) can't join your database transaction:

- Pass **your idempotency key on to the provider**. Stripe supports `Idempotency-Key`.
- Record progress with **recovery points**, so a retry resumes rather than repeats.

The same idea applies to **message consumers**: store processed message IDs (an "inbox" table with a unique constraint), so redelivered messages are ignored.

### How do you handle a hot counter (likes, views, seats left) without lock contention?

**The problem:** `UPDATE posts SET likes = likes + 1 WHERE id = 42` serialises **every** like on that one row's lock. A viral post means thousands of transactions queue up.

| Approach | How | Trade-off |
|---|---|---|
| **Append-only plus aggregate** | `INSERT INTO likes (post_id, user_id)` (unique per user); compute counts periodically into a summary table or materialised view | Writes never contend; the count is slightly stale. Also gives "who liked" and prevents double likes |
| **Sharded counter rows** | N rows per post, `UPDATE … WHERE post_id = 42 AND shard = floor(random()*N)`; read `SUM(count)` | N× less contention; reads sum N rows |
| **Redis `INCR`** | Increment in memory, flush to the DB every few seconds | Very fast; a crash may lose a few seconds of increments unless persisted |
| **Batching in the app** | Accumulate increments in memory and flush `+k` once per second | Few writes; lost on a crash |

For **user-visible exactness** (bank balances), use a **ledger**: append-only transactions, with the balance as the sum (plus snapshots). Don't use a mutable counter.

## Distributed transactions

### Why don't we use two-phase commit (2PC) across microservices? 🔥

**2PC** coordinates an atomic commit across multiple resources:

1. **Prepare phase:** the coordinator asks every participant to durably prepare (`PREPARE TRANSACTION 'tx-1'` in Postgres; XA in Java). Each votes yes or no while **holding its locks**.
2. **Commit phase:** if everyone voted yes, the coordinator says commit (`COMMIT PREPARED 'tx-1'`), otherwise rollback.

**Problems:**

- **Blocking:** if the coordinator crashes after prepare, participants **hold locks indefinitely** until it recovers ("in-doubt" transactions).
- **Latency:** two network round trips while holding locks. Throughput is bounded by the slowest participant.
- **Availability:** every participant must be up. Availability multiplies down.
- **Poor support** in the modern stack: message brokers, SaaS APIs (Stripe), DynamoDB and HTTP services don't speak XA.
- **Operations:** Postgres `max_prepared_transactions` defaults to 0, and orphaned prepared transactions block VACUUM.

**So microservices use** **sagas** (a sequence of local transactions plus compensations), the **outbox pattern** (reliable events), and **idempotent consumers**. They accept **eventual consistency** with explicit failure handling.

### What is the saga pattern? Orchestration vs choreography 🔥

A **saga** splits a business transaction into **local transactions**. If step k fails, it runs **compensating actions** for steps k−1 … 1 in reverse order. Compensation is **semantic undo**: refund the charge, release the seat. It isn't a rollback; the intermediate states were visible.

| | **Orchestration** | **Choreography** |
|---|---|---|
| Control | A central **orchestrator** (a workflow) tells each service what to do | Services **react to each other's events** |
| Pros | Explicit flow, easy to reason about, monitor and change; timeouts in one place | Loose coupling, no central component |
| Cons | The orchestrator is a component to build and run | The flow is implicit and spread out; hard to debug; cyclic dependencies |
| Tools | **AWS Step Functions**, Temporal, Camunda, a hand-rolled state machine plus DB | SNS/SQS, EventBridge, Kafka topics |

**Design rules:**

- Every step and every compensation must be **idempotent** (they will be retried).
- Order the steps so **hard-to-compensate actions come last**. Send the ticket email only after payment.
- Use **pivot transactions**, after which the saga only moves forward.
- Handle **semantic locks** ("pending" states) so other requests see in-flight data correctly.

```js
// Orchestrated saga with compensation in reverse order
async function runSaga(steps, ctx) {
  const completed = [];
  for (const step of steps) {
    try {
      await step.action(ctx);
      completed.push(step);
    } catch (err) {
      ctx.log.push(`✗ ${step.name}: ${err.message}`);
      for (const done of completed.reverse()) {
        await done.compensate(ctx);                 // must be idempotent and retried until it succeeds
      }
      return { ok: false, failedAt: step.name };
    }
  }
  return { ok: true };
}

function webinarRegistration({ paymentFails = false } = {}) {
  return [
    { name: 'reserveSeat', action: async (c) => { c.seats--; c.log.push('seat reserved'); },
      compensate: async (c) => { c.seats++; c.log.push('seat released'); } },
    { name: 'chargeCard', action: async (c) => { if (paymentFails) throw new Error('card declined'); c.charged = true; c.log.push('charged'); },
      compensate: async (c) => { c.charged = false; c.log.push('refunded'); } },
    { name: 'issueTicket', action: async (c) => { c.ticket = 'TCK-1'; c.log.push('ticket issued'); },
      compensate: async (c) => { c.ticket = null; c.log.push('ticket voided'); } },
  ];
}

test('happy path completes every step', async () => {
  const ctx = { seats: 10, log: [] };
  const r = await runSaga(webinarRegistration(), ctx);
  expect(r.ok).toBe(true);
  expect(ctx).toMatchObject({ seats: 9, charged: true, ticket: 'TCK-1' });
});
test('payment failure compensates the earlier steps in reverse order', async () => {
  const ctx = { seats: 10, log: [] };
  const r = await runSaga(webinarRegistration({ paymentFails: true }), ctx);
  expect(r).toEqual({ ok: false, failedAt: 'chargeCard' });
  expect(ctx.seats).toBe(10);
  expect(ctx.log).toEqual(['seat reserved', '✗ chargeCard: card declined', 'seat released']);
});
```

### What is the transactional outbox pattern, and why do you need it? 🔥

**The dual-write problem:**

```node
await db.query('INSERT INTO orders …');          // 1. commit to the DB
await kafka.send({ topic: 'order-created', … }); // 2. publish an event   ← crash here = DB has the order, nobody is told
```

Swapping the order doesn't help: you'd publish an event for an order that then fails to commit. **You can't atomically write to two systems.**

**The outbox fix:**

1. In the **same local transaction** as the business change, insert the event into an **`outbox` table**.
2. A **relay** publishes outbox rows to the broker. It's either a poller using `SELECT … FOR UPDATE SKIP LOCKED`, or **CDC**: Debezium reading the WAL, or DynamoDB Streams.
3. Each row is marked as sent after the broker acknowledges it.

```sql
BEGIN;
INSERT INTO orders (id, customer_id, total, status) VALUES ($1, $2, $3, 'pending');
INSERT INTO outbox (id, aggregate_type, aggregate_id, event_type, payload)
VALUES (gen_random_uuid(), 'order', $1, 'OrderCreated', jsonb_build_object('orderId', $1, 'total', $3));
COMMIT;
```

**Guarantees and requirements:**

- **At-least-once** delivery: the relay can crash after publishing but before marking the row as sent.
- So **consumers must be idempotent**, typically by deduplicating on the event id with an inbox table.
- **Ordering:** publish per aggregate in order (a Kafka partition key of `aggregate_id`).

**Related patterns:**

- **Inbox pattern:** a consumer-side dedupe table, written in the same transaction as the consumer's effect.
- **Listen to yourself:** the service updates its own state only by consuming its own event.

### At-most-once, at-least-once, exactly-once: what's really achievable?

| Semantics | Meaning | How |
|---|---|---|
| At-most-once | May lose messages, never duplicates | Ack before processing |
| **At-least-once** | Never lose, may duplicate | Ack **after** processing; retries. **The practical default** (SQS, most Kafka consumers, webhooks) |
| "Exactly-once" | Each message's **effect** happens once | **At-least-once delivery plus idempotent processing.** Kafka's exactly-once covers Kafka-to-Kafka read-process-write via transactions; once you touch an external DB you need idempotency again |

**Interview line:** "Exactly-once *delivery* is impossible in general. Exactly-once *processing* is achieved with at-least-once delivery and idempotent consumers: dedupe keys, upserts, or conditional writes."

### How do transactions work in DynamoDB, MongoDB and Redis? 🔥

| Store | Transactions | Details |
|---|---|---|
| **DynamoDB** | `TransactWriteItems` / `TransactGetItems` | Up to **100 items** across tables, all-or-nothing, **2× the capacity cost**. `ConditionExpression` per item for invariants. `ClientRequestToken` makes it idempotent for 10 minutes. Single-item `ConditionExpression` (`attribute_not_exists(pk)`, `version = :v`) is the usual optimistic lock |
| **MongoDB** | Multi-document ACID transactions (4.0 replica sets, 4.2 sharded) | Snapshot isolation inside a session. 60 s default lifetime. Performance cost: prefer **single-document atomicity** by embedding related data (single-document writes are always atomic) |
| **Redis** | `MULTI` … `EXEC` | Commands are queued and executed **atomically and in isolation**, but there's **no rollback** if one command fails at runtime. **`WATCH key`** gives optimistic check-and-set (`EXEC` returns null if the key changed). **Lua scripts / Functions** run atomically for read-modify-write logic |

```node
// DynamoDB optimistic locking with a condition expression (AWS SDK v3)
await ddb.send(new UpdateCommand({
  TableName: 'Documents',
  Key: { pk: 'DOC#42', sk: 'META' },
  UpdateExpression: 'SET title = :t, version = version + :one',
  ConditionExpression: 'version = :expected',            // fails with ConditionalCheckFailedException on conflict
  ExpressionAttributeValues: { ':t': 'New title', ':one': 1, ':expected': 7 },
}));
```

### How do ORMs handle transactions, and what are the common pitfalls? 🔥

| ORM / framework | API | Pitfalls |
|---|---|---|
| **Spring / JPA** | `@Transactional` | **Self-invocation** bypasses the proxy, so there's no transaction. Only **RuntimeExceptions** roll back by default. `readOnly = true` is a hint. Lazy loading outside the transaction throws `LazyInitializationException`. See [Spring Boot & Hibernate](/docs/spring-boot-deep-dive) |
| **Prisma** | `prisma.$transaction([q1, q2])` (batch) or `$transaction(async (tx) => {…})` (interactive; default timeout 5 s) | Using the global `prisma` instead of `tx` inside the callback **escapes the transaction**. Long interactive transactions hold connections |
| **TypeORM / Sequelize** | `dataSource.transaction(async (manager) => …)` / `sequelize.transaction(async (t) => …)` | You must pass `manager`/`{ transaction: t }` to **every** query. Forgetting it runs that query outside the transaction |
| **Django** | `transaction.atomic()`, `select_for_update()`, `transaction.on_commit(fn)` | `select_for_update` outside `atomic` raises an error. Send emails and enqueue Celery tasks in **`on_commit`**, otherwise the worker may run before the commit and not find the row |
| **SQLAlchemy** | `with session.begin():` | Session lifetime: one session per request. Detached instances after commit (`expire_on_commit`) |

**The universal rule:** **side effects after commit.**

- Enqueue jobs, publish events and send emails only once the data is durable. Use `on_commit` hooks, Spring's `@TransactionalEventListener(phase = AFTER_COMMIT)`, or the outbox.
- A worker that runs **before** the commit sees nothing. A side effect for a transaction that **rolls back** is a phantom email.

### What does "committed" mean with replication, and can you lose committed data?

- **Async replication** is the default for Postgres streaming replication, MySQL and RDS read replicas. The primary commits locally and the replicas catch up later. **If the primary dies, a failover can lose the last committed transactions.**
- **Synchronous replication** (`synchronous_commit = on` plus `synchronous_standby_names`, or MySQL semi-sync) waits for one or more replicas to persist the WAL. Committed means durable on N nodes, at the cost of latency.
- **Aurora** writes to **6 copies across 3 AZs** with a quorum of 4/6 for writes, so durability doesn't depend on replica lag. Read replicas still lag slightly for reads.
- **Read-your-writes problem:** a user saves a profile, the next request reads a lagging replica, and they see old data. Fixes:
  - Read from the primary for a short window after a write.
  - Route by session.
  - Wait for the replica to reach the write's LSN.

  See [Replication & Sharding](/docs/distributed-data).

### Summarise: which concurrency tool do you reach for? 🔥

| Situation | Tool |
|---|---|
| Single-row arithmetic (stock, balance, counter) | **Atomic `UPDATE … SET x = x - n WHERE x >= n`** |
| A rule that can be a constraint (unique email, no overlapping bookings, non-negative stock) | **Constraint**: UNIQUE, EXCLUDE, CHECK, FK |
| A user editing a record for minutes | **Optimistic lock** (version column / ETag + `If-Match`) |
| Short read-compute-write on a few known rows | **`SELECT … FOR UPDATE`** in a short transaction |
| Work distribution (queues, seat allocation) | **`FOR UPDATE SKIP LOCKED`** |
| Complex multi-row invariants | **SERIALIZABLE + retry** |
| A per-key mutex with no row to lock | **Advisory lock** (or a Redis lock across systems) |
| Retries from clients or networks | **Idempotency keys** / dedupe tables |
| Spanning services | **Saga + outbox + idempotent consumers** |

*[Add a real example from your projects: e.g. how Nebraska Draw's DynamoDB writes used conditional expressions, or how a MeetHour scheduling flow avoided double booking. Use only what you actually built.]*
