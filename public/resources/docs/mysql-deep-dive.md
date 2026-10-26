# MySQL & InnoDB Deep Dive: Internals, Locking, Tuning & PG Comparison

MySQL powers massive OLTP workloads at Uber, GitHub, YouTube/PlanetScale (Vitess), Shopify, Netflix, and Booking.com. Even if PostgreSQL is your daily driver, interviewers frequently test **MySQL / InnoDB internals** — or ask you to **contrast PostgreSQL and MySQL** on storage layout, MVCC, locking, replication, and schema migrations. Saying *"they're basically the same SQL"* misses the exact architectural differences senior rounds probe!

This guide covers **MySQL 8.0 & 8.4 LTS (InnoDB)** from architecture and clustered B+Trees to undo-log MVCC, redo/binlog two-phase commit, gap and next-key locking, `EXPLAIN` `key_len` math, `utf8mb4` & implicit-cast index traps, online DDL (`INSTANT` / `gh-ost`), horizontal sharding with **Vitess**, and a complete **PostgreSQL ↔ MySQL decision & syntax matrix**.

> Two core InnoDB mechanisms — **Next-Key / Gap / Record Lock interval rules under `REPEATABLE READ`** and **Clustered PK bloat across secondary indexes + MySQL `EXPLAIN key_len` calculation** — are modelled in **runnable JavaScript with tests** below.

---

## MySQL architecture & the InnoDB storage engine

### Walk through MySQL's two-layer architecture (Server layer vs Storage Engine layer) and InnoDB vs MyISAM 🔥

Unlike PostgreSQL's monolithic storage engine, MySQL cleanly separates the **Server Layer** from a **Pluggable Storage Engine API**:

```text
+-------------------------------------------------------------------------+
| Client Connections -> Connection / Thread Handling (Thread-per-conn /   |
| Enterprise/Percona Thread Pool — lighter per idle conn than PG forks!)  |
+-------------------------------------------------------------------------+
| MYSQL SERVER LAYER (Engine-agnostic)                                    |
|   SQL Parser -> Preprocessor -> Cost-Based Optimizer -> Execution Engine|
|   Built-in functions, Views, Stored Procs, Triggers, BINARY LOG (binlog)|
|   (Note: the old mutex-contended Query Cache was REMOVED in MySQL 8.0!) |
+-------------------------------------------------------------------------+
| PLUGGABLE STORAGE ENGINE API (Handler interface: read/write row/index)  |
+----------------------+------------------------+-------------------------+
| InnoDB (Default!)    | MyISAM (Legacy)        | MEMORY / TempTable      |
| ACID, MVCC, Row lock,| NO transactions,       | RAM-backed hash/B-tree  |
| Clustered PK, FKs,   | Table-level locks only,| for internal intermediate|
| Crash-safe Redo/Undo | Crash-corruptible      | query temp tables       |
+----------------------+------------------------+-------------------------+
```

- **Why MySQL 8.0 removed the Query Cache:** A single `INSERT`/`UPDATE`/`DELETE` on `orders` invalidated *every* cached query touching `orders` behind a global mutex — making high-write servers slower with Query Cache ON than OFF! Use Redis or ProxySQL caching instead.
- **InnoDB vs MyISAM (classic interview comparison):** InnoDB (default since MySQL 5.5) gives full **ACID transactions, row-level locking, MVCC via undo logs, foreign keys, and automatic crash recovery** via redo logs. MyISAM only supported **table-level locks** (one `UPDATE` blocked all readers/writers on the entire table!) and lacked crash recovery — never use MyISAM in modern systems.

### Why does InnoDB store every table as a Clustered Index on the Primary Key, and what if you omit a PK? 🔥

In PostgreSQL, a table is an unordered **heap**, and the primary key is just a separate B-tree pointing to `(block, offset)`. In **InnoDB, the table *IS* the Primary Key B+Tree (`PRIMARY`)**:

- **Internal (non-leaf) nodes** hold `(PK_key → child_page_number)`.
- **Leaf nodes (16 KB pages by default, `innodb_page_size = 16384`)** hold the **entire row** (`PK columns + hidden DB_TRX_ID (6B) + DB_ROLL_PTR (7B) + all remaining columns`), linked in a **doubly linked list in Primary Key sort order**!
- **Consequences:**
  1. **Primary key lookups (`WHERE id = 42`) and PK range scans (`WHERE id BETWEEN 100 AND 200`) are unbeatable:** a single B+Tree traversal lands directly on the full row with **zero extra heap hop**!
  2. **What if a table has NO `PRIMARY KEY`?**
     - First, InnoDB promotes the first `UNIQUE` key whose columns are all `NOT NULL`.
     - If none exists, InnoDB silently creates a hidden **6-byte `GEN_CLUST_INDEX` (`DB_ROW_ID`)** incremented under a **single global mutex shared across all such tables** (a severe write bottleneck, and prevents tools like `gh-ost` or row-based replication from scaling cleanly!). **Always define an explicit `PRIMARY KEY` in InnoDB (`sql_require_primary_key = ON`)!**

### Why are InnoDB secondary index lookups "double lookups", and why do random `UUIDv4` PKs wreck MySQL? 🔥

Because rows move between 16 KB pages whenever a B+Tree page splits, **InnoDB secondary indexes NEVER store physical page pointers** — instead, every secondary index leaf entry stores **`(indexed_columns, PRIMARY_KEY_value)`**!

```text
Secondary Index idx_email:   'asha@co.com'  ---> stores PK id = 1042  (Tree traversal #1: ~3 hops)
                                                       |
Clustered Index PRIMARY:     id = 1042      ---> full row data        (Tree traversal #2: ~3 hops = "Bookmark Lookup"!)
```

*(Exception: if the query only selects `id, email`, the secondary index already holds both `email` and `id`, giving a single-pass **Covering Index (`Using index`)** with zero bookmark lookup!)*

**Why random `UUIDv4` (especially `VARCHAR(36)`) is a disaster as an InnoDB Primary Key:**
1. **Random mid-tree page splits & 50% page fill fragmentation:** Monotonic keys (`BIGINT AUTO_INCREMENT` or time-ordered `UUIDv7`) always append cleanly to the **rightmost leaf page** (~15/16 = 93% page fill, sequential I/O). Random `UUIDv4` inserts into random middle pages already in disk/RAM — forcing constant **16 KB page splits**, random disk reads to fetch cold leaf pages into the Buffer Pool, and ~50–65% fragmented pages!
2. **Multiplies EVERY secondary index's size:** `VARCHAR(36)` in `utf8mb4` takes **up to 145 bytes per entry** vs **8 bytes** for `BIGINT`! If your table has 5 secondary indexes and 100M rows, a wide PK bloats RAM and disk by **tens of gigabytes**!
- **MySQL UUID solution:** Use **time-ordered `UUIDv7`** stored in **`BINARY(16)`** (or MySQL 8's built-in `UUID_TO_BIN(uuid, 1)` + `BIN_TO_UUID(bin, 1)`, where the `, 1` flag swaps timestamp bits to the front for monotonic B+Tree insertion!).

### Inside InnoDB's memory & disk structures: Buffer Pool (midpoint LRU), Change Buffer, Adaptive Hash Index and Doublewrite Buffer 🔥

Four InnoDB components that immediately separate senior candidates from surface-level answers:

1. **InnoDB Buffer Pool (`innodb_buffer_pool_size` — set to ~70–80% of RAM on a dedicated MySQL host!):**
   - Unlike PostgreSQL (which gives 25% to `shared_buffers` and relies on OS page cache), InnoDB uses `O_DIRECT` (`innodb_flush_method = O_DIRECT`) to bypass double-buffering in the OS cache and manages almost all caching itself.
   - **Scan-resistant Midpoint Insertion LRU:** If someone runs an accidental full-table `mysqldump` or `SELECT *` on a 200 GB table, why doesn't it evict all your hot cached user/order pages? Because InnoDB splits the LRU list into a **Young ("new", 5/8)** sublist and an **Old (3/8)** sublist! Newly read pages enter at the **midpoint (head of Old)** and are only promoted to **Young** if accessed *again* after surviving `innodb_old_blocks_time` (default `1000 ms`)!
2. **Change Buffer:**
   - When an `INSERT`/`UPDATE`/`DELETE` modifies a **non-unique secondary index** whose leaf page is **not currently in the Buffer Pool**, InnoDB avoids a slow random disk read! Instead, it records the pending index delta in the **Change Buffer** (persisted in system tablespace & redo-logged) and merges deltas lazily when that page is eventually read into RAM or by background purge! *(Unique secondary indexes cannot use the Change Buffer on insert because InnoDB must read the page immediately to check uniqueness!)*
3. **Adaptive Hash Index (AHI):**
   - InnoDB monitors hot B+Tree pages and automatically builds an in-memory **$O(1)$ hash index** directly to frequently accessed leaf pages. (Note: on extreme multi-core concurrency with rapid DDL/scans, AHI rw-locks can contend — monitor `SEMAPHORES` and disable `innodb_adaptive_hash_index = OFF` if latch contention spikes.)
4. **Doublewrite Buffer (InnoDB's answer to torn pages vs Postgres `full_page_writes`):**
   - InnoDB pages are **16 KB** while OS/SSD blocks are **4 KB**. Before flushing dirty 16 KB pages to their scattered `.ibd` table files, InnoDB writes them **sequentially in one batch to the Doublewrite Buffer** (`#ib_16384_*.dblwr`), `fsync`s once, and then writes to the `.ibd` data files. If power fails mid-write and tears a `.ibd` page, crash recovery restores the intact 16 KB image from the Doublewrite Buffer before replaying Redo Log records! (Bonus: keeps Redo Log much leaner than Postgres FPIs!)

---

## InnoDB MVCC, undo log, redo log & binlog

### How does InnoDB implement MVCC using undo logs and `ReadView`, vs PostgreSQL's heap tuples? 🔥

Every InnoDB clustered-index row carries two hidden MVCC system columns:
- **`DB_TRX_ID` (6 bytes):** Transaction ID that last inserted or updated this row.
- **`DB_ROLL_PTR` (7 bytes):** Rollback pointer to the **Undo Log record** containing the prior before-image — forming a backward linked list of historical row versions!

```text
Current Row in Clustered Leaf Page:
[ id=42 | status='shipped' | DB_TRX_ID=205 | DB_ROLL_PTR ]
                                                  |
                  +-------------------------------+
                  v
Undo Log v2: [ status='paid'    | DB_TRX_ID=180 | DB_ROLL_PTR ] ---> Undo Log v1: [ status='pending' | DB_TRX_ID=120 ]
```

- **How `ReadView` works:**
  - Under **`REPEATABLE READ`** (MySQL default), a transaction creates **ONE `ReadView` on its very first `SELECT`** and **reuses it until `COMMIT`**.
  - Under **`READ COMMITTED`**, InnoDB creates a **fresh `ReadView` at the start of EVERY individual `SELECT`**!
  - If the row's `DB_TRX_ID` is newer than the `ReadView` (or was still uncommitted when the `ReadView` opened), InnoDB follows `DB_ROLL_PTR` backward through the Undo Log chain until it finds the version visible to that `ReadView`!
- **InnoDB Undo vs Postgres Heap MVCC trade-off (interview gold!):**
  - **InnoDB wins on heavy `UPDATE`s:** Updating an unindexed column mutates the clustered leaf **in place**, secondary indexes **never change**, and there is **no table heap bloat or XID wraparound** (background purge threads clean undo segments).
  - **InnoDB loses on long-running queries reading heavily updated rows + slow `ROLLBACK`s:** Reconstructing an old snapshot requires chasing a 500-step Undo Log chain, and rolling back a 10M-row `UPDATE` in InnoDB takes **longer than the `UPDATE` itself** because InnoDB must physically undo every row change (whereas in Postgres, `ROLLBACK` just marks `xid` aborted in `pg_xact` in $O(1)$ milliseconds!).

### Redo Log vs Undo Log vs Binary Log (`binlog`): what each does, and what is Two-Phase Commit ("Twin-1")? 🔥

| Log | Layer | Format & Lifecycle | Purpose |
|---|---|---|---|
| **Undo Log** | InnoDB engine | Logical before-images in undo tablespaces | **Atomicity** (`ROLLBACK`) + **MVCC** snapshot reads for concurrent transactions |
| **Redo Log** (`#ib_redo*`) | InnoDB engine | Fixed-size **circular** physical-logical log ("on page 94, offset 128, write bytes X") | **Crash-safe Durability** (WAL): replays committed changes not yet flushed from Buffer Pool to `.ibd` files |
| **Binary Log (`binlog`)** | **MySQL Server layer** | Append-only numbered event files (`binlog.000042`) retained per `binlog_expire_logs_seconds` | **Replication** to read replicas, **CDC** (Debezium / Maxwell), and **Point-in-Time Recovery (PITR)** |

**How InnoDB keeps Redo Log and Binlog 100% consistent across a crash (Internal Two-Phase Commit):**
If `binlog` had a transaction that Redo rolled back (or vice versa), **every replica would permanently diverge from the primary**! So every `COMMIT` executes:
1. **Prepare phase:** InnoDB writes the Redo Log record marked `PREPARE` (with `XID`) and flushes per `innodb_flush_log_at_trx_commit`.
2. **Binlog phase:** Server layer writes the event to `binlog` and `fsync`s per `sync_binlog`.
3. **Commit phase:** InnoDB marks the transaction `COMMIT` in Redo Log. *(On crash recovery, if Redo is in `PREPARE` state and its `XID` IS present in `binlog`, MySQL commits it; if missing from `binlog`, MySQL rolls it back!)*

**The famous "Twin-1" (`1 / 1`) production durability setting:**
- `innodb_flush_log_at_trx_commit = 1` (default): `fsync` Redo Log at every `COMMIT`. (`2` writes to OS cache and `fsync`s every 1s — survives `mysqld` crash, risks 1s loss on OS/power loss; `0` leaves buffer in MySQL user RAM — loses 1s even on `mysqld` crash!).
- `sync_binlog = 1` (default since MySQL 8.0!): `fsync` `binlog` per commit group (InnoDB Group Commit batches concurrent `fsync`s together so throughput stays high on NVMe!).

### `binlog_format`: `STATEMENT` vs `ROW` vs `MIXED`, and GTID replication 🔥

- **`STATEMENT` (legacy):** Logs raw SQL strings (`DELETE FROM sessions WHERE created_at < NOW()`). Compact, **dangerous** with non-deterministic functions (`UUID()`, `NOW()`, `LIMIT` without `ORDER BY`), causing silent primary/replica drift!
- **`ROW` (Default & Production Standard!):** Logs exact before/after column values of every modified row (`binlog_row_image = FULL` or `MINIMAL`). **100% deterministic**, required for **CDC (Debezium)** and **`gh-ost`**. *(Watch out: a single `DELETE FROM logs WHERE year = 2022` touching 20M rows generates gigabytes of row events and spikes replication lag — batch large deletes!)*
- **GTID (`gtid_mode = ON`):** Assigns every transaction a globally unique ID (`<server_uuid>:<sequence_no>`). Eliminates fragile `binlog.000042 + byte_pos` math during failover — a replica can automatically repoint (`SOURCE_AUTO_POSITION = 1`) to a newly promoted primary without losing or duplicating transactions!

---

## InnoDB isolation, gap locks & deadlocks

### Why is `REPEATABLE READ` MySQL's default, and what is the Consistent Read vs Locking Read phantom trap? 🔥

MySQL originally defaulted to **`REPEATABLE READ`** because historical statement-based `binlog` replication produced out-of-order data corruption under `READ COMMITTED`! Today with `binlog_format = ROW`, many giant MySQL fleets (Booking, Meta, GitHub) actually switch OLTP services to `READ COMMITTED` to eliminate gap-lock deadlocks — **so interviewers test both!**

**Subtle interview trap — *"Does MySQL `REPEATABLE READ` prevent phantom reads?"***
Give the **two-part nuanced answer** that blows interviewers away:
1. **Pure `SELECT` (Consistent Nonlocking Read):** Uses the fixed `ReadView` taken at the first `SELECT` → **no phantom rows appear**.
2. **Locking Read (`SELECT ... FOR UPDATE` / `FOR SHARE`) or `UPDATE`/`DELETE`:** Reads the **latest committed state ("current read")** and uses **Next-Key Locks** to block concurrent phantom `INSERT`s!
   - **HOWEVER (the famous mixed-read phantom edge case!):** If Transaction A runs plain `SELECT * FROM items WHERE id = 5` (0 rows, opens `ReadView`), Transaction B `INSERT`s `id = 5` and commits, and then Transaction A runs `UPDATE items SET name = 'x' WHERE id = 5` — the `UPDATE` modifies B's committed row and stamps A's own `DB_TRX_ID` onto `id = 5`! A subsequent plain `SELECT` in Transaction A **suddenly sees `id = 5`** because its `DB_TRX_ID` belongs to A itself!

### Record Locks, Gap Locks, Next-Key Locks and Insert Intention Locks: trace the exact locked intervals! 🔥

InnoDB locks **index records and the gaps between index records**! Suppose `orders` has `id PRIMARY KEY` and non-unique `idx_amount (amount)` containing existing rows with `amount` values **`10, 20, 30`**:

The B+Tree defines 4 open gaps and 3 records: $(-\infty, 10)$, $[10]$, $(10, 20)$, $[20]$, $(20, 30)$, $[30]$, $(30, +\infty)$.

| Lock Type | Notation | What it locks | Compatibility gotcha! |
|---|---|---|---|
| **Record Lock** | `[20]` | Single existing index entry | Conflicts with concurrent `X`/`S` locks on `[20]` |
| **Gap Lock** | `(10, 20)` | Strictly the **empty space between** `10` and `20` (prevents `INSERT` of `11..19`!) | **SURPRISE RULE: Two Gap Locks DO NOT conflict with each other!** Tx A and Tx B can **both** hold exclusive Gap Locks on `(10, 20)` simultaneously — because both share the same goal ("nobody insert here yet")! |
| **Next-Key Lock** | `(10, 20]` | Gap Lock `(10, 20)` **+** Record Lock on `[20]` (InnoDB's default under `REPEATABLE READ`!) | Blocks both modifying `20` and inserting into `(10, 20)` |
| **Insert Intention Lock** | `II on (10, 20)` | Acquired by `INSERT` right before inserting `15` | **Blocked by an existing Gap / Next-Key Lock on `(10, 20)`**, **_but_** two concurrent `INSERT`s (`14` and `16`) into the same unlocked gap **do NOT block each other**! |

**Three golden InnoDB locking rules under `REPEATABLE READ`:**
1. **Unique / PK equality HIT (`WHERE id = 20 FOR UPDATE`):** Downgrades Next-Key Lock to a **pure Record Lock `[20]`** — zero gap locked!
2. **Unique / PK equality MISS (`WHERE id = 15 FOR UPDATE` where `15` does NOT exist):** Locks the **Gap `(10, 20)`**!
3. **Non-unique secondary index equality (`WHERE amount = 20 FOR UPDATE`):** Locks Next-Key `(10, 20]` (+ clustered PK record) **AND** the **following Gap `(20, 30)`** so no phantom `amount = 20` can slip in on either side!
4. *(If you use an **unindexed column** in `WHERE ... FOR UPDATE`, InnoDB scans the entire clustered index and **Next-Key locks EVERY row and EVERY gap in the entire table**!)*

### Why do two concurrent `SELECT ... FOR UPDATE` + `INSERT` transactions on missing rows ALWAYS deadlock in InnoDB? 🔥

This is a real production incident almost every MySQL team hits ("check-then-insert under `FOR UPDATE`"):
1. Table currently has `id = 10` and `id = 20`.
2. **Tx 1:** `SELECT * FROM accounts WHERE id = 15 FOR UPDATE;` → `15` doesn't exist → acquires **Gap Lock `(10, 20)`**.
3. **Tx 2:** `SELECT * FROM accounts WHERE id = 16 FOR UPDATE;` → `16` doesn't exist → **ALSO acquires Gap Lock `(10, 20)`** (remember: Gap Locks are mutually compatible!).
4. **Tx 1:** `INSERT INTO accounts (id) VALUES (15);` → requests **Insert Intention Lock on `(10, 20)`** → **BLOCKED** waiting for Tx 2's Gap Lock!
5. **Tx 2:** `INSERT INTO accounts (id) VALUES (16);` → requests **Insert Intention Lock on `(10, 20)`** → **BLOCKED** waiting for Tx 1's Gap Lock!
6. **Cycle (`Tx1 -> Tx2 -> Tx1`)! InnoDB deadlock detector immediately aborts one with `ERROR 1213 (40001): Deadlock found`!**

- **The Fix:** Never do `SELECT ... FOR UPDATE` on non-existent keys to "reserve" an insert! Use atomic **`INSERT INTO accounts ... ON DUPLICATE KEY UPDATE ...`** (or `INSERT IGNORE` + catch `1062` duplicate key, or switch to `READ COMMITTED` where gap locks on searches are disabled!).

Run the interactive InnoDB Lock Simulator below to test all 4 locking rules and reproduce the exact Gap-Lock + Insert-Intention deadlock:

```js
// InnoDB REPEATABLE READ lock interval & gap-deadlock simulator
function computeInnoDBLocks({ keys, isUniqueIndex, queryType, target, rangeEnd }) {
  const sorted = [...keys].sort((a, b) => a - b);

  if (queryType === 'eq') {
    const idx = sorted.indexOf(target);
    if (isUniqueIndex) {
      if (idx !== -1) return [`Record[${target}]`]; // Rule 1: unique hit -> record lock only!
      // Rule 2: unique miss -> gap lock between neighbours
      const right = sorted.find((k) => k > target);
      const left = [...sorted].reverse().find((k) => k < target);
      return [`Gap(${left ?? '-inf'}, ${right ?? '+inf'})`];
    }
    // Rule 3: non-unique index equality
    const right = sorted.find((k) => k > target);
    const left = [...sorted].reverse().find((k) => k < target);
    if (idx === -1) return [`Gap(${left ?? '-inf'}, ${right ?? '+inf'})`];
    return [
      `NextKey(${left ?? '-inf'}, ${target}]`,
      `Gap(${target}, ${right ?? '+inf'})`,
    ];
  }

  // Range scan >= target AND <= rangeEnd
  const locks = [];
  let prev = '-inf';
  for (const k of sorted) {
    if (k >= target) locks.push(`NextKey(${prev}, ${k}]`);
    if (k > rangeEnd) break;
    prev = k;
  }
  if (sorted.at(-1) <= rangeEnd) locks.push(`NextKey(${prev}, +inf)`);
  return locks;
}

const keys = [10, 20, 30];
console.log('Unique PK HIT (id = 20):     ', computeInnoDBLocks({ keys, isUniqueIndex: true, queryType: 'eq', target: 20 }));
console.log('Unique PK MISS (id = 15):    ', computeInnoDBLocks({ keys, isUniqueIndex: true, queryType: 'eq', target: 15 }));
console.log('Secondary idx HIT (amt = 20):', computeInnoDBLocks({ keys, isUniqueIndex: false, queryType: 'eq', target: 20 }));

test('Unique index equality hit downgrades to pure Record Lock with zero Gap Lock', () => {
  expect(computeInnoDBLocks({ keys, isUniqueIndex: true, queryType: 'eq', target: 20 })).toEqual(['Record[20]']);
});

test('Unique index equality miss acquires Gap Lock on enclosing interval (10, 20)', () => {
  const tx1Locks = computeInnoDBLocks({ keys, isUniqueIndex: true, queryType: 'eq', target: 15 });
  const tx2Locks = computeInnoDBLocks({ keys, isUniqueIndex: true, queryType: 'eq', target: 16 });
  expect(tx1Locks).toEqual(['Gap(10, 20)']);
  expect(tx2Locks).toEqual(['Gap(10, 20)']); // Both acquire compatible Gap(10, 20) -> subsequent INSERTs deadlock!
});

test('Non-unique secondary index hit locks Next-Key (10, 20] AND trailing Gap (20, 30)', () => {
  expect(computeInnoDBLocks({ keys, isUniqueIndex: false, queryType: 'eq', target: 20 })).toEqual([
    'NextKey(10, 20]',
    'Gap(20, 30)',
  ]);
});
```

### Diagnosing MySQL lock waits and deadlocks (`SHOW ENGINE INNODB STATUS` & `performance_schema`)

```mysql
-- 1. Inspect the most recent deadlock graph (shows BOTH transactions, exact SQL, and exact index/gap locks held & waited!)
SHOW ENGINE INNODB STATUS\G
-- Enable innodb_print_all_deadlocks = ON in my.cnf so EVERY deadlock is logged to the MySQL error log!

-- 2. Live lock-wait view in MySQL 8.0+ (replaces deprecated INFORMATION_SCHEMA.INNODB_LOCKS)
SELECT
  r.trx_id              AS waiting_trx_id,
  r.trx_mysql_thread_id AS waiting_thread,
  r.trx_query           AS waiting_query,
  b.trx_id              AS blocking_trx_id,
  b.trx_mysql_thread_id AS blocking_thread,
  b.trx_query           AS blocking_query
FROM performance_schema.data_lock_waits w
JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_engine_transaction_id
JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_engine_transaction_id;

-- Or the 1-word helper view built into MySQL's sys schema:
SELECT * FROM sys.innodb_lock_waits;
```

---

## MySQL 8.0+ query optimizer, indexes & performance

### Mastering MySQL `EXPLAIN`, `EXPLAIN ANALYZE` and `key_len` composite-index math 🔥

In MySQL 8.0.18+, always pair tabular `EXPLAIN` with **`EXPLAIN ANALYZE`** (which runs the query and prints `actual time=... rows=... loops=...` in `TREE` format just like Postgres!). When reading tabular `EXPLAIN`, interviewers love testing **`key_len`** — because **`key_len` reveals how many columns of your composite index MySQL actually used!**

**How `key_len` is calculated (`utf8mb4` = 4 bytes per char!):**
- `INT NOT NULL` = `4` bytes; `BIGINT NOT NULL` = `8` bytes (`+1` byte if column is nullable!).
- `DATETIME` (precision 0) = `5` bytes (`DATETIME(6)` = `8` bytes).
- `VARCHAR(50) utf8mb4 NOT NULL` = `50 × 4 + 2 (length bytes) = 202` bytes (`+1` = `203` if nullable!).

**Example:** Suppose you have `INDEX idx_shop (tenant_id BIGINT NOT NULL, status VARCHAR(20) utf8mb4 NOT NULL, created_at DATETIME NOT NULL)`:
- Total index width = `8 + (20×4 + 2) + 5 = 8 + 82 + 5 = 95` bytes.
- If `EXPLAIN` shows `key: idx_shop, key_len: 8`, MySQL **only used `tenant_id`** and stopped before `status`!
- If `key_len: 90` (`8 + 82`), it used `(tenant_id, status)`!
- If `key_len: 95`, **all 3 columns** fired in the B+Tree lookup!

```js
// Secondary index storage bloat & MySQL EXPLAIN key_len calculator
function explainKeyLen(colsUsed) {
  return colsUsed.reduce((bytes, col) => {
    let w = 0;
    if (col.type === 'BIGINT') w = 8;
    else if (col.type === 'INT') w = 4;
    else if (col.type === 'DATETIME') w = 5;
    else if (col.type === 'VARCHAR_UTF8MB4') w = col.length * 4 + 2;
    else if (col.type === 'BINARY') w = col.length;
    if (col.nullable) w += 1;
    return bytes + w;
  }, 0);
}

function secondaryIndexPkOverheadGB({ rows, numSecondaryIndexes, pkBytes }) {
  return Number(((rows * numSecondaryIndexes * pkBytes) / 1024 ** 3).toFixed(2));
}

const idxCols = [
  { name: 'tenant_id', type: 'BIGINT', nullable: false },
  { name: 'status', type: 'VARCHAR_UTF8MB4', length: 20, nullable: false },
  { name: 'created_at', type: 'DATETIME', nullable: true },
];

console.log('key_len (1 col): ', explainKeyLen(idxCols.slice(0, 1)));
console.log('key_len (2 cols):', explainKeyLen(idxCols.slice(0, 2)));
console.log('key_len (3 cols):', explainKeyLen(idxCols));
console.log(
  'PK overhead across 5 secondary indexes @ 100M rows (BIGINT 8B vs VARCHAR(36) 146B):',
  secondaryIndexPkOverheadGB({ rows: 100_000_000, numSecondaryIndexes: 5, pkBytes: 8 }),
  'GB vs',
  secondaryIndexPkOverheadGB({ rows: 100_000_000, numSecondaryIndexes: 5, pkBytes: 146 }),
  'GB',
);

test('EXPLAIN key_len pinpoints exact prefix columns used in composite index', () => {
  expect(explainKeyLen(idxCols.slice(0, 1))).toBe(8);
  expect(explainKeyLen(idxCols.slice(0, 2))).toBe(90);
  expect(explainKeyLen(idxCols)).toBe(96); // 8 + 82 + (5 + 1 nullable)
});

test('VARCHAR(36) utf8mb4 PK adds ~64 GB of pure PK duplication across 5 secondary indexes at 100M rows', () => {
  const bigintGB = secondaryIndexPkOverheadGB({ rows: 100_000_000, numSecondaryIndexes: 5, pkBytes: 8 });
  const uuidStrGB = secondaryIndexPkOverheadGB({ rows: 100_000_000, numSecondaryIndexes: 5, pkBytes: 146 });
  expect(bigintGB).toBe(3.73);
  expect(uuidStrGB).toBe(67.99);
});
```

### What are Index Condition Pushdown (ICP), Multi-Range Read (MRR), Batched Key Access (BKA) and Loose Index Scans? 🔥

- **Index Condition Pushdown (`Using index condition` in `Extra`):**
  - Suppose `INDEX (zipcode, lastname, address)` is queried with `WHERE zipcode = '500001' AND lastname LIKE '%uddin%'`.
  - `lastname LIKE '%uddin%'` has a leading `%`, so B+Tree range traversal stops after `zipcode = '500001'`.
  - **Without ICP:** InnoDB does **10,000 expensive clustered-PK bookmark lookups** for every `'500001'` row and hands full rows to the Server layer just to discard 9,990 of them!
  - **With ICP:** The Server layer pushes `lastname LIKE '%uddin%'` **down into InnoDB**, which evaluates it directly on the `lastname` string already sitting inside the secondary index leaf entry — doing only **10 bookmark lookups instead of 10,000**!
- **Multi-Range Read (`Using MRR`):** When a secondary index range scan produces thousands of random primary-key IDs, MRR collects and **sorts the PKs in memory (`read_rnd_buffer_size`) first** before probing the clustered index in sequential page order!
- **Batched Key Access (BKA):** Combines Nested Loop Join + MRR to batch inner index lookups instead of one random I/O per outer row (note: MySQL 8.0.18+ also finally added native **Hash Joins**, replacing legacy slow Block Nested Loop joins for unindexed equijoins!).
- **Loose Index Scan (`Using index for group-by`):** Computes `SELECT dept_id, MIN(salary) FROM employees GROUP BY dept_id` on `INDEX (dept_id, salary)` by **jumping from the first entry of `dept_id=10` straight to `dept_id=20` in $O(\text{distinct groups} \times \log N)$** instead of scanning all 5M rows!

### Eliminating `Using filesort` and `Using temporary` in MySQL 🔥

- **`Using filesort`** does **not** necessarily mean disk I/O — it means MySQL couldn't read rows in `ORDER BY` order directly from an index and had to run QuickSort in `sort_buffer_size` (spilling to temp disk chunks if oversized).
- **`Using temporary`** means MySQL materialised an internal `TempTable` (in RAM up to `temptable_max_ram` / `tmp_table_size`, then spilling to disk!) to evaluate `GROUP BY`, `DISTINCT`, `UNION`, or derived tables.
- **How to eliminate both with one index:** Follow **ESR (Equality → Sort/Group → Range)**:
  - Query: `SELECT status, COUNT(*) FROM orders WHERE customer_id = 42 GROUP BY status;` → `INDEX (customer_id, status)` delivers rows already grouped in B+Tree order (`Using index` — **no `temporary`, no `filesort`**!).
  - Query: `SELECT id, total FROM orders WHERE customer_id = 42 AND status = 'paid' ORDER BY created_at DESC LIMIT 20;` → `INDEX (customer_id, status, created_at DESC)` reads the first 20 matching entries and **stops immediately**!

### Modern MySQL 8.0 / 8.4 index superpowers: Invisible, Functional, Descending, Multi-Valued JSON & Histograms 🔥

Five features older MySQL lacked that **MySQL 8.0+ natively supports** (mentioning these proves up-to-date MySQL expertise!):

```mysql
-- 1. INVISIBLE INDEXES: test dropping a suspected unused index in production with ZERO risk!
-- Optimizer ignores it immediately; if latency spikes, make it VISIBLE again in 1 millisecond without rebuilding!
ALTER TABLE orders ALTER INDEX idx_legacy_status INVISIBLE;
-- (Test selectively in one session with: SET SESSION optimizer_switch = 'use_invisible_indexes=on';)
ALTER TABLE orders ALTER INDEX idx_legacy_status VISIBLE;

-- 2. FUNCTIONAL (EXPRESSION) INDEXES (double parentheses required in MySQL 8.0.13+!)
CREATE INDEX idx_users_lower_email ON users ((LOWER(email)));
CREATE INDEX idx_orders_year_month ON orders ((YEAR(created_at)), (MONTH(created_at)));

-- 3. TRUE DESCENDING INDEXES (prior to 8.0, DESC in index DDL was parsed and silently ignored!)
-- Critical for mixed-direction ORDER BY: ORDER BY priority ASC, created_at DESC
CREATE INDEX idx_queue_prio_created ON jobs (priority ASC, created_at DESC);

-- 4. MULTI-VALUED INDEXES on JSON arrays (InnoDB's answer to Postgres GIN on JSON arrays!)
CREATE INDEX idx_products_tags ON products ((CAST( attributes->'$.tags' AS CHAR(32) ARRAY )));
SELECT id, name FROM products WHERE 'wireless' MEMBER OF (attributes->'$.tags'); -- uses idx_products_tags!

-- 5. OPTIMIZER HISTOGRAMS on unindexed skewed columns (fixes terrible join-order cardinality estimates!)
ANALYZE TABLE orders UPDATE HISTOGRAM ON status, channel WITH 100 BUCKETS;
```

*(Note on Partial Indexes: unlike PostgreSQL's `CREATE INDEX ... WHERE deleted_at IS NULL`, MySQL still has **no native `WHERE` clause on `CREATE INDEX`**! The MySQL workaround is a virtual generated column returning `NULL` for inactive rows — e.g. `active_email VARCHAR(320) AS (IF(deleted_at IS NULL, email, NULL)) VIRTUAL` with a `UNIQUE` index, since `UNIQUE` ignores `NULL`s!)*

---

## MySQL dialect gotchas, `utf8mb4` collations, `sql_mode` & online DDL

### Character sets & collations: the legacy `utf8` 3-byte trap and `utf8mb4_0900_ai_ci` 🔥

- **Historical MySQL trap:** For nearly 15 years, MySQL's `CHARSET=utf8` (alias `utf8mb3`) only stored **1–3 bytes per character**, crashing or silently truncating **4-byte UTF-8 emojis (`🎉`) and CJK supplementary characters**! MySQL 8.0 finally made **`utf8mb4`** the server default (`utf8mb3` is deprecated in 8.0/8.4).
- **Collation suffixes decoded (`utf8mb4_0900_ai_ci` — MySQL 8.0 default):**
  - `0900` = Unicode 9.0 collation algorithm.
  - `ai` = **accent-insensitive** (`'café' = 'cafe'` is **`TRUE`**!).
  - `ci` = **case-insensitive** (`'Zaki' = 'zaki'` is **`TRUE`** — including inside `UNIQUE` indexes and `WHERE email = ...`!).
  - Use **`utf8mb4_0900_as_cs`** (accent- & case-sensitive) or **`utf8mb4_bin`** for case-sensitive tokens, slugs, Base62 short URLs (`bit.ly/aBc` ≠ `bit.ly/abc`!), or password hashes!
  - **Cross-table `JOIN` catastrophe:** If `users.external_id` is `utf8mb4_0900_ai_ci` and `events.external_id` is `utf8mb4_unicode_ci` (from an older table), **MySQL cannot use the index on the join** because collations mismatch! Standardise charset & collation across every table in your schema.

### `sql_mode` & the Implicit Type Conversion trap (`WHERE varchar_phone = 9876543210`) 🔥

**The Implicit String-to-Number Cast Outage (asked constantly in MySQL debugging interviews!):**
Suppose `users.phone` is `VARCHAR(20)` with `INDEX (phone)`, and a developer passes a JS number instead of a string:

```mysql
-- ✗ SILENT PRODUCTION KILLER:
SELECT * FROM users WHERE phone = 9876543210;
```

- **What Postgres does:** Fails loud and fast (`ERROR: operator does not exist: character varying = bigint`) so you fix the bug in dev!
- **What MySQL does:** Coerces **the string column to floating-point** on *every row* (`CAST(phone AS DOUBLE) = 9876543210`)! Why can't it convert the integer to `'9876543210'`? Because many different strings (`'9876543210'`, `'09876543210'`, `'9876543210abc'`, `' 9876543210'`) all cast to the number `9876543210`!
- **Two awful consequences:**
  1. **Completely bypasses `INDEX (phone)` → Full Table Scan on 50M rows!**
  2. **Security / logic bug:** `'123abc' = 123` evaluates to **`TRUE`** in MySQL!
- **Always verify `sql_mode` includes:** `STRICT_TRANS_TABLES,ONLY_FULL_GROUP_BY,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO`. (Without `STRICT_TRANS_TABLES`, legacy MySQL truncated a 500-char string into `VARCHAR(50)` or turned invalid dates into `'0000-00-00'` with only a warning!)

### Online DDL in MySQL 8.0 (`INSTANT` vs `INPLACE` vs `COPY`), `gh-ost` and `pt-online-schema-change` 🔥

Always declare explicit `ALGORITHM` and `LOCK` clauses on production MySQL migrations so an unexpected table rebuild fails immediately instead of locking production for 40 minutes:

```mysql
-- Fails fast in 1ms if MySQL cannot apply the change instantly without copying!
ALTER TABLE orders
  ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'web',
  ALGORITHM=INSTANT, LOCK=NONE;
```

| DDL Algorithm | How it works | Supported operations (MySQL 8.0.29+) | Impact on 500 GB table |
|---|---|---|---|
| **`INSTANT`** | Metadata-only update in data dictionary | Add/drop column (anywhere in 8.0.29+!), change column default, rename table/enum append | **Milliseconds!** Zero I/O, zero replication lag (still acquires brief metadata lock `MDL` — beware long transactions just like Postgres!). |
| **`INPLACE` (`LOCK=NONE`)** | Modifies/rebuilds inside InnoDB while buffering concurrent DML in an online row log | Create/drop secondary index, extend `VARCHAR(50) → VARCHAR(100)` (stays 1-byte length prefix `<256 bytes`!) | Concurrent reads & writes continue, **BUT** on replicated setups, replicas replay the DDL **single-threaded after commit**, causing **massive replication lag** on multi-hour index builds! |
| **`COPY`** | Copies entire table row-by-row to temp table under read-only lock (`LOCK=SHARED`) | Changing column data type (`INT → BIGINT`), changing charset (`latin1 → utf8mb4`) | **Blocks all writes for hours!** Never run raw `COPY` DDL on large live tables. |

**Why GitHub built `gh-ost` (and Percona built `pt-online-schema-change`) for huge MySQL tables:**
Even `INPLACE` DDL can spike primary Disk I/O without throttling and cause hours of replica lag. **`gh-ost` (GitHub's Online Schema Transmogrifier)**:
1. Creates an empty shadow table `_orders_gho` with the new schema (`BIGINT`, new indexes, `utf8mb4`).
2. Copies existing rows in **small throttled chunks** (automatically pausing whenever replica lag > 1.5s or primary load spikes!).
3. **Unlike `pt-osc` (which installs synchronous triggers on the hot table), `gh-ost` is 100% triggerless** — it connects as a fake replica, **tails the row-based `binlog` asynchronously**, applies ongoing live DML to `_orders_gho`, and performs an atomic `RENAME TABLE` cutover at the end!

---

## High availability, Vitess sharding & PostgreSQL vs MySQL head-to-head

### Scaling MySQL: Semi-Sync Replication, Group Replication, ProxySQL and Vitess 🔥

- **Async vs Semi-Synchronous Replication (`rpl_semi_sync_source_enabled`):** Plain async binlog replication is fast (`RPO > 0` if primary disks die before shipping binlog). **Lossless Semi-Sync (`AFTER_SYNC`)** waits until **at least 1 replica acknowledges writing the binlog event to its relay log** before returning `COMMIT` to the client — giving zero committed-transaction loss on primary failure!
- **MySQL InnoDB Cluster (Group Replication + MySQL Router) / Orchestrator:** Built-in Paxos-like consensus group providing automatic primary election and split-brain prevention.
- **ProxySQL:** MySQL-protocol-aware L7 proxy handling connection multiplexing (like PgBouncer), read/write query splitting (`SELECT` → replicas unless inside tx / `FOR UPDATE`), replica-lag circuit breaking (`max_replication_lag`), and live query firewalling/rewriting without deploying app code!
- **Vitess (Horizontal MySQL Sharding at YouTube / Slack / HubSpot / PlanetScale scale):**
  - App speaks standard MySQL protocol to stateless **`VTGate`** routers → `VTGate` consults **`VSchema` + `Vindexes`** (lookup/hash shard maps) and routes/scatter-gathers across **`VTTablet` + `mysqld`** shards, managing online resharding (`MoveTables` / `Reshard`), connection pooling, and query row-limits transparently.

### Production MySQL observability: Slow Query Log, `performance_schema` and `sys` schema 🔥

```mysql
-- 1. Slow Query Log settings (capture sub-second hogs AND full scans!)
-- slow_query_log = ON, long_query_time = 0.2, log_queries_not_using_indexes = ON (with throttle!)

-- 2. MySQL's equivalent of Postgres pg_stat_statements (built into performance_schema / sys!):
SELECT
  query,
  exec_count,
  total_latency,
  avg_latency,
  rows_sent_avg,
  rows_examined_avg,   -- HUGE signal: rows_examined_avg = 50000 to return rows_sent_avg = 10 -> missing index!
  tmp_tables,
  full_scan
FROM sys.statement_analysis
ORDER BY avg_latency DESC
LIMIT 10;

-- 3. Find unused indexes wasting InnoDB write I/O & Buffer Pool memory:
SELECT * FROM sys.schema_unused_indexes;

-- 4. Find redundant prefix indexes (e.g. INDEX(a) when INDEX(a, b) already exists!):
SELECT * FROM sys.schema_redundant_indexes;
```

### PostgreSQL vs MySQL architectural decision matrix: when do you choose which in System Design? 🔥

Give a balanced, **engineering-grounded** answer rather than tribal bias:

| Dimension | Pick **PostgreSQL** when… | Pick **MySQL (InnoDB)** when… |
|---|---|---|
| **Workload shape** | Complex analytical joins, CTEs, window frames, rich constraints, geospatial (**PostGIS**), full-text/trigram, vector RAG (**pgvector**), JSONB document hybrids | High-rate, straightforward PK-centric OLTP lookups & heavy in-place row updates at massive scale |
| **Storage & PK lookups** | Heap + uniform secondary indexes (fast multi-index Bitmap AND/OR combinations; unaffected by wide PKs on secondary indexes) | **Clustered PK B+Tree** — unbeatable 1-hop `WHERE id = ?` and PK-ordered range scans (provided PK is compact monotonic `BIGINT` / `UUIDv7`!) |
| **Update-heavy churn** | Needs `fillfactor` + careful index discipline for HOT updates + aggressive `autovacuum` + XID wraparound monitoring | **In-place updates + Undo Log** — zero secondary-index write amplification when non-indexed cols change; no `VACUUM` / XID wraparound cliff! |
| **Schema rigor & DDL** | **Transactional DDL**, Exclusion Constraints, partial indexes (`WHERE`), Row-Level Security (RLS) for multi-tenant SaaS | `ALGORITHM=INSTANT` column additions + battle-tested **`gh-ost`** online migrations + **Vitess** ecosystem for 100+ shard clusters |
| **Connection model** | Process-per-connection (~5–15 MB each) → **always pair with PgBouncer / RDS Proxy** | Lightweight thread-per-connection (or thread pool) → tolerates higher direct connection counts (pair with **ProxySQL** at scale) |

### Complete PostgreSQL ↔ MySQL 8.0+ SQL translation cheat sheet 🔥

| Pattern | PostgreSQL | MySQL 8.0+ |
|---|---|---|
| **Upsert** | `INSERT INTO t (k, v) VALUES (1, 'a') ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;` | `INSERT INTO t (k, v) VALUES (1, 'a') AS new ON DUPLICATE KEY UPDATE v = new.v;` *(8.0.20+ deprecates `VALUES(v)`!)* |
| **Ignore duplicate insert** | `INSERT INTO t ... ON CONFLICT DO NOTHING;` | `INSERT IGNORE INTO t ...` *(warning: `INSERT IGNORE` also downgrades type/truncation errors to warnings — prefer `ON DUPLICATE KEY UPDATE id = id`!)* |
| **Return inserted/updated row** | `INSERT ... RETURNING *;` / `UPDATE ... RETURNING id;` | No `RETURNING`; use `LAST_INSERT_ID()` + follow-up `SELECT` if server-computed cols needed |
| **Update with Join** | `UPDATE a SET x = b.x FROM b WHERE a.b_id = b.id;` | `UPDATE a JOIN b ON a.b_id = b.id SET a.x = b.x;` |
| **Delete with Join** | `DELETE FROM a USING b WHERE a.b_id = b.id AND b.expired;` | `DELETE a FROM a JOIN b ON a.b_id = b.id WHERE b.expired;` |
| **Delete with `LIMIT` (batching!)** | No `DELETE ... LIMIT`! Use `WHERE ctid IN (SELECT ctid FROM t WHERE ... LIMIT 5000)` or PK subquery | Native **`DELETE FROM t WHERE created_at < '2024-01-01' ORDER BY id LIMIT 5000;`**! |
| **Extract JSON string** | `payload->>'status'`, nested `payload#>>'{user,role}'` | `payload->>'$.status'` (`JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status'))`), nested `payload->>'$.user.role'` |
| **JSON containment filter** | `WHERE payload @> '{"role":"admin"}'` (uses GIN!) | `WHERE JSON_CONTAINS(payload, '"admin"', '$.role')` |
| **Generate date/number series** | `SELECT generate_series(1, 10)` or `generate_series('2026-01-01'::date, '2026-01-31', '1 day')` | Use **`WITH RECURSIVE seq AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM seq WHERE n < 10) SELECT * FROM seq;`** |
| **Regex match** | `col ~ '^[0-9]+$'` (case-insensitive `~*`) | `REGEXP_LIKE(col, '^[0-9]+$', 'c')` or `col REGEXP '^[0-9]+$'` |
| **Null-safe equality** | `a IS NOT DISTINCT FROM b` | `a <=> b` |
| **Latest 1 row per group** | `SELECT DISTINCT ON (user_id) ... ORDER BY user_id, created_at DESC` | `QUALIFY`-style CTE with `ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) = 1` |
