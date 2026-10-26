# SQL Fundamentals: Fresher to Interview-Ready (PostgreSQL & MySQL)

If you are catching up on SQL from scratch — or brushing up before a full-stack round where an interviewer opens a blank SQL pad — **start here**. Before jumping into advanced window frames or MVCC internals, interviewers test whether your **foundations** are rock solid: how tables and keys work, `DELETE` vs `TRUNCATE` vs `DROP`, data types that don't corrupt money or timestamps, how `NULL` breaks naive `WHERE` clauses, `GROUP BY` vs `HAVING`, and writing clean joins without losing or duplicating rows.

Every concept below is taught **from zero** with concrete sample rows, expected outputs, and **side-by-side PostgreSQL and MySQL syntax** wherever the two engines differ. Once you finish this guide, step up to [SQL Mastery: Queries, Joins & Window Functions](/docs/sql-mastery), [PostgreSQL Deep Dive](/docs/postgresql-deep-dive), [MySQL & InnoDB Deep Dive](/docs/mysql-deep-dive), and [SQL Scalability & Query Efficiency](/docs/sql-scalability-efficiency).

> SQL itself isn't executed in the browser playground, so two runnable **JavaScript mental-model simulators with tests** are included below — one for the **SQL query execution pipeline & LEFT JOIN trap**, and one for **Set operations (`UNION`, `INTERSECT`, `EXCEPT`) and `NULL` helpers**. Click **▶ Run** on either block to experiment interactively.

**Practice dataset used across this guide:**

```sql
-- Shared mental-model dataset (4 departments, 6 employees, payments)
-- departments
-- +----+-------------+-----------+
-- | id | name        | budget    |
-- +----+-------------+-----------+
-- | 10 | Engineering | 500000.00 |
-- | 20 | Product     | 250000.00 |
-- | 30 | Design      | 150000.00 |
-- | 40 | Legal       | 100000.00 |  <-- 0 employees!
-- +----+-------------+-----------+

-- employees
-- +----+--------+---------+------------+-----------+------------+-------------------------+
-- | id | name   | dept_id | manager_id | salary    | bonus      | hired_at                |
-- +----+--------+---------+------------+-----------+------------+-------------------------+
-- |  1 | Asha   |      10 |       NULL | 120000.00 |   15000.00 | 2022-01-15              |
-- |  2 | Bilal  |      10 |          1 |  95000.00 |       NULL | 2023-03-10              |
-- |  3 | Charu  |      10 |          1 |  95000.00 |    5000.00 | 2023-07-01              |
-- |  4 | Dev    |      20 |          1 |  80000.00 |    8000.00 | 2024-02-20              |
-- |  5 | Elena  |      30 |       NULL |  88000.00 |       NULL | 2024-06-11              |
-- |  6 | Farhan |    NULL |          2 |  60000.00 |       NULL | 2025-01-05              | <-- contractor (no dept!)
-- +----+--------+---------+------------+-----------+------------+-------------------------+
```

---

## RDBMS mental models & SQL sub-languages

### What is an RDBMS, and how are databases, schemas, tables, rows and columns organised in PostgreSQL vs MySQL? 🔥

An **RDBMS (Relational Database Management System)** stores data in **relations (tables)** governed by strict schemas, typed columns, integrity constraints, and **ACID** transactions.

| Term | Formal relational name | Plain-English meaning | Example |
|---|---|---|---|
| **Table** | Relation | A collection of records of one entity type | `employees` |
| **Row** | Tuple / Record | One single entity instance | `(2, 'Bilal', 10, 1, 95000.00, NULL, '2023-03-10')` |
| **Column** | Attribute / Field | One typed property shared by every row | `salary NUMERIC(10,2)` |
| **Domain** | Data type + constraints | Legal values allowed in a column | `NUMERIC(10,2) CHECK (salary >= 0)` |
| **Cardinality** | Row count | How many rows a table or column has (or how many distinct values) | `employees` has cardinality 6 |
| **Degree / Arity** | Column count | How many columns a table or result set has | `employees` has degree 7 |

**Crucial PostgreSQL vs MySQL hierarchy trap (asked constantly!):**

- **PostgreSQL:** `Cluster (server instance) → Database → Schema (default: public) → Table`.
  - Connections connect to **one database** at a time. You cannot casually `JOIN` across two PostgreSQL databases without `postgres_fdw`, **_but_** you can freely `JOIN` across schemas inside the same database (`SELECT * FROM billing.invoices JOIN auth.users ...`).
- **MySQL:** `Server instance → Database (synonym for Schema!) → Table`.
  - In MySQL, `CREATE SCHEMA app;` and `CREATE DATABASE app;` are **100% identical**! A single MySQL connection can `JOIN` across two schemas/databases on the same server (`SELECT * FROM billing.invoices JOIN auth.users ...`).

### Explain the 5 SQL sub-languages: DDL, DML, DQL, DCL and TCL 🔥

This is one of the most common warm-up questions for freshers and junior-to-mid rounds. Group every command by **what it acts on**:

| Sub-language | Stands for | Purpose | Commands |
|---|---|---|---|
| **DDL** | Data Definition Language | Defines or alters **structure / metadata** in the catalog | `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `COMMENT` |
| **DML** | Data Manipulation Language | Inserts, modifies, or deletes **row data** | `INSERT`, `UPDATE`, `DELETE`, `MERGE` (PG 15+), `REPLACE` (MySQL) |
| **DQL** | Data Query Language | Reads and shapes data without mutating state | `SELECT` (sometimes grouped under DML in older textbooks — mention both!) |
| **DCL** | Data Control Language | Controls **permissions and access security** | `GRANT`, `REVOKE` |
| **TCL** | Transaction Control Language | Manages **atomic units of work** | `BEGIN` / `START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, `SET TRANSACTION` |

**Bonus interview detail:** In **PostgreSQL**, almost all **DDL is transactional** — you can run `BEGIN; ALTER TABLE ...; DROP TABLE ...; ROLLBACK;` and undo schema changes! In **MySQL**, DDL statements trigger an **implicit `COMMIT`** before and after running, so you **cannot** `ROLLBACK` a `DROP TABLE` or `TRUNCATE TABLE` in MySQL.

### `DELETE` vs `TRUNCATE` vs `DROP`: what happens under the hood? 🔥

Never stop at *"DELETE has WHERE and TRUNCATE doesn't"*. Give the **engine-level** comparison:

| Dimension | `DELETE FROM t WHERE ...` | `TRUNCATE TABLE t` | `DROP TABLE t` |
|---|---|---|---|
| **Category** | DML | DDL | DDL |
| **Removes** | Matching rows (or all rows if no `WHERE`) | **All rows**, keeps table, columns & indexes | **Everything**: data, table structure, indexes, triggers, grants |
| **`WHERE` clause?** | Yes | No | No |
| **Row-level triggers?** | Fires `BEFORE/AFTER DELETE` per row | Does **not** fire row `DELETE` triggers (PG has `ON TRUNCATE` statement triggers) | Fires no DML triggers |
| **Speed on 10M rows** | **Slow** — visits every row, logs each row deletion (WAL / undo), leaves dead tuples in PG | **Instant ($O(1)$ metadata + new empty file/pages)** — deallocates data pages wholesale | **Instant** — unlinks files & drops catalog metadata |
| **Lock taken** | Row-level locks (`ROW EXCLUSIVE` table lock) — concurrent reads continue | Full table lock (`ACCESS EXCLUSIVE` in PG; metadata lock in MySQL) | Full exclusive metadata lock |
| **Can `ROLLBACK`?** | **Yes** in both Postgres & MySQL | **Yes in PostgreSQL!** **No in MySQL** (implicit commit) | **Yes in PostgreSQL!** **No in MySQL** |
| **Auto-increment / Identity** | Keeps counting from previous high-water mark | **MySQL:** resets `AUTO_INCREMENT` to 1! **Postgres:** keeps sequence unless `RESTART IDENTITY` is passed | Sequence/table removed completely |
| **Foreign keys** | Allowed (checks `ON DELETE` rules) | Blocked if another table has an enabled FK referencing `t` (unless `TRUNCATE a, b` / `CASCADE` in PG) | Blocked unless `CASCADE` (PG) or FK dropped first |

```pgsql
-- PostgreSQL: reset identity sequence and cascade to referencing child tables inside a safe transaction
BEGIN;
TRUNCATE TABLE orders RESTART IDENTITY CASCADE;
-- Oops, wrong environment? In Postgres you can still undo it:
ROLLBACK;
```

### How does a SQL query actually execute inside PostgreSQL and MySQL? 🔥

Understanding the 5-stage pipeline explains *why* syntax errors happen immediately, *why* prepared statements save CPU, and *why* the database ignores an index:

1. **Connection & Authentication:** Client connects via TCP/TLS or Unix socket (`psql` on port `5432` for Postgres; `mysql` on port `3306` for MySQL). Postgres spawns/uses a backend process; MySQL assigns a worker thread.
2. **Parser & Validator (Analyzer):** Checks SQL grammar, tokenises keywords/identifiers, builds a **parse tree**, and verifies table/column names and types against the system catalog.
3. **Rewriter:** Expands **views** into underlying queries and applies rule rewrites (e.g., Row-Level Security predicates in Postgres, derived table merging in MySQL).
4. **Query Planner / Cost-Based Optimizer (CBO):** Generates candidate execution plans (Seq Scan vs Index Scan; Nested Loop vs Hash Join vs Merge Join), consults **table statistics** (row counts, histograms, null fractions), estimates I/O + CPU cost, and picks the cheapest physical plan.
5. **Executor & Storage Engine:** Runs the chosen plan tree node by node, reading 8 KB pages (Postgres buffer manager) or 16 KB pages (MySQL InnoDB Buffer Pool) from RAM or disk, checking MVCC visibility, writing WAL/redo logs for mutations, and streaming rows back to the client.

---

## Data types, keys & constraints (PostgreSQL vs MySQL)

### Which data types should you pick for numbers, money, strings, booleans, UUIDs and JSON? 🔥

Choosing wrong types is an instant red flag in schema rounds (especially `FLOAT` for money!). Memorise this production mapping:

| Domain | PostgreSQL (Recommended) | MySQL 8.0+ (Recommended) | Why / Trap to avoid |
|---|---|---|---|
| **Primary Key IDs** | `BIGINT GENERATED ALWAYS AS IDENTITY` | `BIGINT UNSIGNED AUTO_INCREMENT` | `INT` overflows at ~2.14B rows! Always default new tables to `BIGINT` (8 bytes). |
| **Exact money / rates** | `NUMERIC(12, 2)` (or integer minor units like paise/cents in `BIGINT`) | `DECIMAL(12, 2)` (or `BIGINT` cents) | **Never use `FLOAT`/`REAL`/`DOUBLE` for money** — binary IEEE-754 floating point cannot represent `0.1 + 0.2` exactly (`0.30000000000000004`). |
| **Strings (variable)** | `TEXT` (or `VARCHAR(n)` when length limit is a true domain rule) | `VARCHAR(255)` / `VARCHAR(n)` with `utf8mb4` | In PG, `TEXT` and `VARCHAR` have **identical storage & speed**. In MySQL, `VARCHAR` can live inline in memory temp tables whereas `TEXT` is stored off-page/BLOB-style. |
| **Booleans** | `BOOLEAN` (`true` / `false`) | `BOOLEAN` (alias for `TINYINT(1)`: `1` / `0`) | MySQL drivers may return `0`/`1` unless configured to cast `TINYINT(1)` to boolean. |
| **Timestamps** | `TIMESTAMPTZ` (`timestamp with time zone`) | `DATETIME(6)` (stored in UTC by convention) or `TIMESTAMP(6)` | See next question for the MySQL 2038 trap! |
| **UUIDs** | Native `UUID` (16 bytes, `gen_random_uuid()` / `uuidv7()` in PG 18+) | `BINARY(16)` with `UUID_TO_BIN(UUID(), 1)` | Never store UUIDs as `VARCHAR(36)` — wastes 2.25× space and bloats every index! |
| **Semi-structured JSON** | `JSONB` (parsed binary tree, GIN-indexable) | `JSON` (binary DOM format in MySQL 8+, supports multi-valued indexes) | In PG, avoid plain `JSON` (stores raw text and reparses on every read) unless preserving key order/whitespace matters. |

### `CHAR(n)` vs `VARCHAR(n)` vs `TEXT`: storage, padding and performance myths 🔥

| Type | How it's stored | Good for | Gotcha |
|---|---|---|---|
| `CHAR(n)` | Fixed-length, **right-padded with spaces** up to `n` characters | Almost nothing in modern DBs (maybe strictly fixed ISO codes like `CHAR(2)` `'IN'`, `'US'`) | Wastes space on shorter strings; trailing spaces are stripped on comparison/retrieval in MySQL! Not faster than `VARCHAR`/`TEXT` in Postgres. |
| `VARCHAR(n)` | 1–4 byte length prefix + actual UTF-8 bytes up to `n` characters | Bounded fields (`email VARCHAR(320)`, `sku VARCHAR(64)`) | In MySQL, `VARCHAR(n)` reserves worst-case buffer memory during some internal sort operations (`VARCHAR(4000)` allocates more sort buffer than `VARCHAR(100)`!). |
| `TEXT` | Variable-length up to 1 GB in Postgres; `TINYTEXT`/`TEXT` (64 KB)/`MEDIUMTEXT` (16 MB)/`LONGTEXT` (4 GB) in MySQL | Descriptions, markdown bodies, logs; in Postgres, general strings | In **MySQL**, indexing a `TEXT` column requires a **prefix length** (`CREATE INDEX idx ON posts (body(100))`), whereas `VARCHAR` can be indexed directly. |

### `TIMESTAMPTZ` vs `TIMESTAMP` (Postgres) and `DATETIME` vs `TIMESTAMP` (MySQL): what is the 2038 trap? 🔥

Time handling trips up even experienced devs. Both engines use **misleadingly similar names** with very different rules:

**In PostgreSQL:**
- **`TIMESTAMPTZ` (`timestamp with time zone`) — ALWAYS USE THIS for instants in time:**
  - Stores **8 bytes in UTC** (microseconds since `2000-01-01 00:00:00 UTC`, range up to year 294,276 AD!). Does **not** actually store the original timezone string — it converts incoming timestamps from the session's `TimeZone` into UTC on write, and converts UTC back to the session's `TimeZone` on read.
- **`TIMESTAMP` (`timestamp without time zone`):**
  - Ignores timezones completely. Only use for "wall-clock" local concepts when paired with a separate IANA timezone column (e.g., future recurring events when a country might change DST rules).

**In MySQL:**
- **`TIMESTAMP` (4 bytes):**
  - Converts session timezone ↔ UTC automatically like PG's `TIMESTAMPTZ`, **BUT** is only 32-bit Unix seconds: **max value is `2038-01-19 03:14:07 UTC` (the Year 2038 bug!)**. Never use MySQL `TIMESTAMP` for long-term dates (mortgages, birthdates, expiries beyond 2038).
- **`DATETIME` (5–8 bytes):**
  - Range `1000-01-01` to `9999-12-31`, immune to 2038, **no automatic timezone conversion**. Production MySQL standard: set MySQL server & connection `time_zone = '+00:00'` and store UTC in `DATETIME(3)` or `DATETIME(6)`.

### Auto-incrementing keys: `IDENTITY` vs `SERIAL` (Postgres) vs `AUTO_INCREMENT` (MySQL) 🔥

```pgsql
-- PostgreSQL (Modern SQL-standard way — Postgres 10+): ALWAYS prefer this over SERIAL
CREATE TABLE users (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```mysql
-- MySQL 8.0+ equivalent
CREATE TABLE users (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(320) NOT NULL UNIQUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

**Why Postgres prefers `GENERATED ALWAYS AS IDENTITY` over legacy `SERIAL` / `BIGSERIAL`:**
- `SERIAL` was a non-standard macro creating a 32-bit `INT` (overflows at 2.1B!) + detached sequence with awkward grant permissions, and allowed accidental manual `INSERT INTO users (id) VALUES (5)` without advancing the sequence (causing `duplicate key` crashes later when the sequence reached `5`!).
- `GENERATED ALWAYS AS IDENTITY` enforces SQL standard behaviour and **rejects accidental manual IDs** unless you explicitly write `OVERRIDING SYSTEM VALUE`.
- **Important interview fact for BOTH engines:** Sequence / `AUTO_INCREMENT` numbers **are NOT guaranteed to be gapless**! Rolled-back transactions, failed `INSERT`s, and cached sequence batches leave gaps (`1, 2, 4, 5`). That is normal and makes sequences fast without global serialization locks.

### Explain all 6 SQL constraints, `ON DELETE` actions, and how `UNIQUE` treats `NULL` 🔥

Constraints enforce business invariants **inside the database** so bugs in any microservice cannot corrupt data:

1. **`PRIMARY KEY`:** Uniquely identifies every row. Equivalent to `UNIQUE` + `NOT NULL` (one per table; can be single-column or composite `PRIMARY KEY (order_id, product_id)`). Automatically creates a unique B-tree index (and in MySQL InnoDB, physically clusters the table!).
2. **`FOREIGN KEY`:** Enforces **referential integrity** — `employees.dept_id` must match an existing `departments.id` (or be `NULL` if nullable).
   - **Gotcha in Postgres & MySQL:** Postgres does **not** automatically create an index on the child foreign-key column (`dept_id`)! Without `CREATE INDEX ON employees(dept_id)`, deleting a department or joining `departments → employees` scans all of `employees`! (MySQL InnoDB automatically creates an index on FK columns if none exists.)
3. **`UNIQUE`:** Prevents duplicate values.
   - **How `UNIQUE` treats `NULL`:** Because `NULL <> NULL` is UNKNOWN in standard SQL, **both PostgreSQL and MySQL allow multiple `NULL` rows in a `UNIQUE` column!** (In PostgreSQL 15+, you can opt into `UNIQUE NULLS NOT DISTINCT` if you want at most one `NULL`.)
4. **`NOT NULL`:** Rejects `NULL` writes. Make columns `NOT NULL` by default unless absence is genuinely meaningful!
5. **`CHECK (expr)`:** Validates boolean row rules (`CHECK (price >= 0 AND discount_pct BETWEEN 0 AND 100)`). Supported in both PostgreSQL and **MySQL 8.0.16+** (MySQL 5.7 parsed `CHECK` and silently ignored it!).
6. **`DEFAULT expr`:** Supplies a fallback value when a column is omitted from `INSERT` (note: explicitly inserting `NULL` into a column with a `DEFAULT` still inserts `NULL`, or fails if `NOT NULL`!).

**Foreign key `ON DELETE` / `ON UPDATE` referential actions:**

| Action | What happens when parent `departments (id = 10)` is deleted | When to use |
|---|---|---|
| `RESTRICT` / `NO ACTION` (default) | **Blocks** the delete with an error if any employee has `dept_id = 10` | Financial records (`customers → invoices`), core entities you must never orphan or silently wipe |
| `CASCADE` | Automatically deletes all child rows (`order → order_items`) | Pure owned sub-entities (`order_items`, `session_tokens`) — **dangerous** on deep hierarchies! |
| `SET NULL` | Sets `employees.dept_id = NULL` on affected employees | Optional relationships (`employees.manager_id`, `posts.author_id` when user deletes account) |
| `SET DEFAULT` | Sets child FK to its `DEFAULT` value | Fallback bucket (note: InnoDB rejects `ON DELETE SET DEFAULT`) |

---

## CRUD operations & safe data modification

### `INSERT` patterns: multi-row batching, `INSERT ... SELECT`, and getting generated IDs (`RETURNING` vs `LAST_INSERT_ID()`) 🔥

Always list target columns explicitly (`INSERT INTO t (col1, col2)`), never bare `INSERT INTO t VALUES (...)` — otherwise adding or reordering a column later breaks your app!

```pgsql
-- 1. Multi-row INSERT (10x–50x faster than 1,000 individual network round-trips!)
-- PostgreSQL: RETURNING gives back any columns (id, created_at, computed defaults) in 1 round-trip!
INSERT INTO employees (name, dept_id, salary, hired_at)
VALUES
  ('Gita', 10, 105000.00, '2025-02-01'),
  ('Harish', 20, 92000.00, '2025-02-15')
RETURNING id, name, hired_at;
```

```mysql
-- MySQL: no RETURNING on INSERT (MySQL 8.x); retrieve first generated ID via LAST_INSERT_ID()
INSERT INTO employees (name, dept_id, salary, hired_at)
VALUES
  ('Gita', 10, 105000.00, '2025-02-01'),
  ('Harish', 20, 92000.00, '2025-02-15');

SELECT LAST_INSERT_ID(); -- returns Gita's id (connection-scoped, safe under concurrency!)
```

```sql
-- 2. INSERT ... SELECT: copy / transform rows directly inside the DB without pulling into Node/Python RAM
INSERT INTO archived_orders (id, customer_id, total, created_at)
SELECT id, customer_id, total, created_at
FROM orders
WHERE created_at < '2024-01-01' AND status = 'shipped';
```

### Safe `UPDATE` and `DELETE` habits in production, plus updating from another table 🔥

**Production survival habit (say this in interviews — interviewers love it!):**
1. Write your `UPDATE` or `DELETE` **as a `SELECT COUNT(*)` / `SELECT *` first** with the exact same `WHERE` clause to verify row count!
2. Wrap manual production fixes in `BEGIN; ... -- check affected rows! ... COMMIT;` (or `ROLLBACK;` if the affected row count surprises you).
3. In MySQL CLI, enable `--safe-updates` (`sql_safe_updates = 1`), which blocks `UPDATE` or `DELETE` statements that lack a `WHERE` key condition or `LIMIT`!

**Dialect difference — `UPDATE` joining another table:**

```pgsql
-- PostgreSQL: UPDATE ... FROM (note: target table is NOT repeated in FROM)
UPDATE employees e
SET salary = e.salary * 1.10
FROM departments d
WHERE e.dept_id = d.id
  AND d.name = 'Engineering'
RETURNING e.id, e.name, e.salary;
```

```mysql
-- MySQL: multi-table UPDATE uses standard JOIN syntax right after UPDATE!
UPDATE employees e
JOIN departments d ON e.dept_id = d.id
SET e.salary = e.salary * 1.10
WHERE d.name = 'Engineering';
```

### `SELECT`, `DISTINCT`, aliases, and why `SELECT DISTINCT` is often an interview warning sign

- **Column aliases (`AS`):** created in step 5 (`SELECT`), so **you cannot reference a `SELECT` alias in `WHERE`**! (You *can* reference it in `ORDER BY` in standard SQL, and in `GROUP BY` / `HAVING` in MySQL or Postgres ordinal/non-standard forms, though repeating the expression or using a CTE is cleaner and portable.)
- **`SELECT DISTINCT`:** deduplicates rows across **all** selected columns (`SELECT DISTINCT dept_id, manager_id FROM employees`).
- **Why interviewers probe `DISTINCT`:** Freshers often slap `SELECT DISTINCT` onto a query when a `JOIN` accidentally multiplied rows (fan-out). That forces a **full sort or hash aggregate** over the inflated intermediate rows **and** silently hides double-counted `SUM()` / `COUNT()` bugs! Fix the join grain (`EXISTS` or pre-aggregate) instead of masking duplicates with `DISTINCT`.

---

## Filtering, operators, `NULL`s & conditional logic

### `WHERE` operators: the `AND`/`OR` precedence bug, `BETWEEN` date trap, and `LIKE` vs `ILIKE` 🔥

Three bugs that appear in almost every live SQL screen:

**1. `AND` binds tighter than `OR` (just like `*` before `+`):**
```sql
-- ✗ BUG: returns ALL Engineering employees (even hired in 2019!) PLUS Product hires in 2024+
SELECT * FROM employees
WHERE dept_id = 10 OR dept_id = 20 AND hired_at >= '2024-01-01';

-- ✓ ALWAYS parenthesise OR — or better yet, use IN (...)!
SELECT * FROM employees
WHERE dept_id IN (10, 20)
  AND hired_at >= '2024-01-01';
```

**2. The `BETWEEN` timestamp boundary trap:**
`BETWEEN a AND b` is **inclusive on both ends** (`x >= a AND x <= b`). On `DATE` columns (`'2025-01-01'` to `'2025-01-31'`) that's fine, but on **`TIMESTAMPTZ` / `DATETIME`** columns, `'2025-01-31'` coerces to `'2025-01-31 00:00:00'` — **dropping 23 hours, 59 minutes, 59.999999 seconds of Jan 31st**!
```sql
-- ✗ WRONG for timestamps: misses everything after midnight on Jan 31!
WHERE created_at BETWEEN '2025-01-01' AND '2025-01-31'

-- ✓ ALWAYS use half-open intervals [start, next_period_start) for timestamps!
WHERE created_at >= '2025-01-01'
  AND created_at <  '2025-02-01'
```

**3. Pattern matching (`LIKE` vs `ILIKE`, `%` vs `_`, escaping):**
- `%` matches **0 or more** characters; `_` matches **exactly 1** character (`'A___'` matches `'Asha'`, NOT `'Ash'`!).
- If searching for literal `50%` or `user_id`, escape wildcards: `WHERE promo LIKE '%50\%%' ESCAPE '\'`.
- **PostgreSQL:** `LIKE` is **case-sensitive** (`'Asha' LIKE 'asha%'` → `false`); use `ILIKE` for case-insensitive matching.
- **MySQL:** `LIKE` follows the column's **collation** — default `utf8mb4_0900_ai_ci` is **case-insensitive (`_ci`)**, so `'Asha' LIKE 'asha%'` is `true`! Use `COLLATE utf8mb4_0900_as_cs` or `LIKE BINARY` when case sensitivity is required.

### Working with `NULL`: `IS NULL`, `COALESCE`, `NULLIF`, and `IS DISTINCT FROM` vs `<=>` 🔥

`NULL` means **missing / unknown / inapplicable** — it is **not** `0`, **not** `''` (empty string), and **not** `false`. Any arithmetic or `=`/`!=` comparison with `NULL` yields `NULL` (UNKNOWN):

- On our sample `employees` table, `SELECT name, salary + bonus AS total_comp FROM employees;` returns **`NULL`** for Bilal (`95000 + NULL = NULL`), Elena, and Farhan!

**Your 4 essential `NULL` tools:**

| Expression | What it does | Real interview example |
|---|---|---|
| `x IS NULL` / `x IS NOT NULL` | Tests whether `x` is NULL (never write `x = NULL` or `x != NULL` — both always evaluate to UNKNOWN!) | `WHERE manager_id IS NULL` (finds top-level executives Asha & Elena) |
| `COALESCE(a, b, c, 0)` | Standard SQL: returns the **first non-NULL** argument (short-circuits left to right). Prefer over PG-irrelevant `IFNULL`/`NVL` because `COALESCE` works identically in **both Postgres & MySQL**! | `salary + COALESCE(bonus, 0)` → Bilal gets `95000.00` instead of `NULL` |
| `NULLIF(a, b)` | Returns `NULL` if `a = b`, otherwise returns `a` | Safe division: `revenue / NULLIF(orders_count, 0)` returns `NULL` instead of crashing with `division by zero`! Also great for cleaning CSV empty strings: `NULLIF(TRIM(phone), '')` |
| Null-safe equality | Treats `NULL` as equal to `NULL` and unequal to values (always returns `true` or `false`, never `NULL`!) | **PostgreSQL:** `a IS NOT DISTINCT FROM b` (and `a IS DISTINCT FROM b`)<br>**MySQL:** `a <=> b` (spaceship operator!) and `NOT (a <=> b)` (MySQL 8.0.16+ hasn't `IS DISTINCT FROM`, so `<=>` is key!) |

### `CASE WHEN` expressions: conditional columns, bucketing, and conditional aggregation 🔥

`CASE` is SQL's `if / else if / else` **expression** (note: always ends with `END`, and if `ELSE` is omitted and no branch matches, it evaluates to **`NULL`**!).

```sql
-- 1. Row-level bucketing + safe ratio
SELECT
  name,
  salary,
  CASE
    WHEN salary >= 110000 THEN 'Band L5+'
    WHEN salary >= 90000  THEN 'Band L4'
    ELSE 'Band L3'
  END AS comp_band
FROM employees;

-- 2. Conditional aggregation (pivoting counts/sums in a SINGLE table scan — huge interview pattern!)
SELECT
  COUNT(*) AS total_employees,
  COUNT(CASE WHEN bonus IS NOT NULL THEN 1 END) AS with_bonus,
  SUM(CASE WHEN salary >= 95000 THEN 1 ELSE 0 END) AS high_earners,
  ROUND(
    100.0 * SUM(CASE WHEN bonus IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
    2
  ) AS bonus_pct
FROM employees;
-- Note: in PostgreSQL you can also write: COUNT(*) FILTER (WHERE bonus IS NOT NULL)
```

---

## Sorting, limiting & essential built-in functions

### `ORDER BY`, `NULLS FIRST` / `NULLS LAST` (Postgres vs MySQL), and `LIMIT` / `OFFSET` 🔥

- **Default direction is `ASC`** (`ORDER BY dept_id, salary DESC` sorts `dept_id ASC`, and breaks ties by `salary DESC`).
- **Without `ORDER BY`, row order is NEVER guaranteed** — even if rows happened to come back in insertion order during testing, `VACUUM` or parallel scans can return them in any order!
- **Where do `NULL`s sort by default? (Classic PG vs MySQL gotcha!):**
  - **PostgreSQL:** treats `NULL` as **larger** than any value → `ASC` puts `NULL`s **last**, `DESC` puts `NULL`s **first**! So `ORDER BY bonus DESC` puts Bilal, Elena, and Farhan (`NULL` bonus) **at the very top** unless you write `ORDER BY bonus DESC NULLS LAST`!
  - **MySQL:** treats `NULL` as **smaller** than any value → `ASC` puts `NULL`s **first**, `DESC` puts `NULL`s **last**, and MySQL **does not support `NULLS FIRST` / `NULLS LAST` syntax**!

```pgsql
-- PostgreSQL: clean explicit control
SELECT name, bonus
FROM employees
ORDER BY bonus DESC NULLS LAST, id ASC
LIMIT 3 OFFSET 0;
```

```mysql
-- MySQL idiom for NULLS LAST on ASC sort: (bonus IS NULL) evaluates to 0 for non-null, 1 for null!
SELECT name, bonus
FROM employees
ORDER BY (bonus IS NULL) ASC, bonus ASC, id ASC
LIMIT 3 OFFSET 0;
```

### Must-know string, math and type-casting functions in PostgreSQL vs MySQL 🔥

Keep this side-by-side translation table handy when switching dialects in coding assessments (HackerRank / LeetCode / CoderPad often let you pick PostgreSQL or MySQL):

| Operation | PostgreSQL | MySQL 8.0+ | Subtle trap |
|---|---|---|---|
| **Concatenate strings** | `first \|\| ' ' \|\| last` or `CONCAT(first, ' ', last)` | `CONCAT(first, ' ', last)` | In PG, `'a' \|\| NULL` is **`NULL`** (whereas `CONCAT('a', NULL)` is `'a'`)! In MySQL, `\|\|` means logical **`OR`** by default! |
| **Substring (1-indexed!)** | `SUBSTRING(s FROM 1 FOR 3)` or `SUBSTR(s, 1, 3)` | `SUBSTRING(s, 1, 3)` / `LEFT(s, 3)` / `RIGHT(s, 3)` | SQL strings are **1-indexed**, not 0-indexed (`SUBSTR('SQL', 1, 2)` → `'SQ'`)! |
| **Character vs byte length** | `CHAR_LENGTH(s)` (chars) vs `OCTET_LENGTH(s)` (bytes) | `CHAR_LENGTH(s)` (chars) vs `LENGTH(s)` (**bytes**!) | In MySQL, `LENGTH('🚀')` is **`4`** (UTF-8 bytes), while `CHAR_LENGTH('🚀')` is **`1`**! (In PG, `LENGTH('🚀')` is `1`.) |
| **Case & trim** | `LOWER(s)`, `UPPER(s)`, `TRIM(s)` | `LOWER(s)`, `UPPER(s)`, `TRIM(s)` | Identical in both. |
| **Replace substring** | `REPLACE(s, 'old', 'new')` | `REPLACE(s, 'old', 'new')` | Case-sensitive in both. |
| **Integer division trap!** | `5 / 2` → **`2`** (truncates!); use `5.0 / 2` or `5::numeric / 2` → `2.5` | `5 / 2` → **`2.5000`** (`DIV` does integer division: `5 DIV 2` → `2`)! | **Huge LeetCode/interview trap** in Postgres when computing conversion rates: `COUNT(a) / COUNT(b)` returns `0` unless multiplied by `1.0` or cast to `NUMERIC`! |
| **Type casting** | `CAST(x AS INT)` or shorthand `x::int`, `'2025-01-01'::date` | `CAST(x AS SIGNED)` / `CAST(x AS DECIMAL(10,2))` / `CAST(x AS CHAR)` | In MySQL `CAST`, use `SIGNED` / `UNSIGNED` (not `INT`!) and `CHAR` (not `VARCHAR`!). |

### Date and time functions interviewers test constantly 🔥

| Task | PostgreSQL | MySQL 8.0+ |
|---|---|---|
| **Current timestamp / date** | `NOW()` (transaction start) / `CLOCK_TIMESTAMP()` / `CURRENT_DATE` | `NOW()` / `SYSDATE()` / `CURDATE()` |
| **Add / subtract interval** | `NOW() - INTERVAL '7 days'`, `hired_at + INTERVAL '1 month'` | `NOW() - INTERVAL 7 DAY` or `DATE_SUB(NOW(), INTERVAL 7 DAY)` |
| **Truncate to month / day / hour** (for `GROUP BY` charts!) | `DATE_TRUNC('month', created_at)` → `'2025-03-01 00:00:00+00'` | `DATE_FORMAT(created_at, '%Y-%m-01')` or `CAST(DATE_FORMAT(created_at, '%Y-%m-01') AS DATE)` |
| **Extract year / month / DOW** | `EXTRACT(YEAR FROM hired_at)`, `EXTRACT(DOW FROM hired_at)` (`0=Sun..6=Sat`) | `YEAR(hired_at)`, `MONTH(hired_at)`, `DAYOFWEEK(hired_at)` (`1=Sun..7=Sat`) |
| **Days between two dates** | `(date2 - date1)` (subtracting two `DATE`s returns an `INT` days!) or `EXTRACT(EPOCH FROM ts2 - ts1) / 86400` | `DATEDIFF(date2, date1)` (returns `date2 - date1` in days) or `TIMESTAMPDIFF(SECOND, ts1, ts2)` |

---

## Aggregations & `GROUP BY` from scratch

### How do `COUNT`, `SUM`, `AVG`, `MIN` and `MAX` treat `NULL`s and empty sets? 🔥

Every aggregate function **ignores `NULL` values** — *except* `COUNT(*)`:

Trace all of them on our 6-row `employees` table (where `bonus` is `15000, NULL, 5000, 8000, NULL, NULL`):

| Expression | Result on `employees` | Why! |
|---|---|---|
| `COUNT(*)` | `6` | Counts **rows**, regardless of whether columns are `NULL`. |
| `COUNT(bonus)` | `3` | Counts rows where `bonus IS NOT NULL`. |
| `COUNT(DISTINCT dept_id)` | `3` | Distinct non-NULL `dept_id`s (`10, 20, 30` — ignores Farhan's `NULL`). |
| `SUM(bonus)` | `28000.00` | `15000 + 5000 + 8000`. (**Warning:** if *all* rows are `NULL` or `0` rows match `WHERE`, `SUM` returns **`NULL`**, not `0`! Wrap in `COALESCE(SUM(bonus), 0)` for API responses!) |
| `AVG(bonus)` | `9333.33...` | Divides `28000 / 3` (**non-NULL count**), **NOT** `28000 / 6`! If an interviewer asks for *"average bonus across ALL employees treating no-bonus as $0"*, you **must** write `AVG(COALESCE(bonus, 0))` (`28000 / 6 = 4666.67`)! |
| `MIN(bonus)` / `MAX(bonus)` | `5000.00` / `15000.00` | Ignores `NULL`s; works on numbers, strings (lexicographical), and dates. |

### How does `GROUP BY` work step-by-step, and what is MySQL's `ONLY_FULL_GROUP_BY` rule? 🔥

Think of `GROUP BY dept_id` as **bucketing rows into piles** (one pile per distinct `dept_id`, **including one single pile for all `NULL`s** — unlike `WHERE`, `GROUP BY` treats `NULL`s as equal to each other so Farhan lands in a `NULL` group!). Once rows are collapsed into one summary row per bucket:

> **The Golden Rule of `GROUP BY`:** Every column in `SELECT`, `HAVING`, or `ORDER BY` must either be **(a) in `GROUP BY`**, **(b) wrapped in an aggregate function (`SUM`, `MAX`, `COUNT`…)**, or **(c) functionally dependent on the `GROUP BY` primary key** (e.g., if you `GROUP BY d.id`, selecting `d.name` is valid in both Postgres and MySQL 8.0!).

```sql
-- ✗ INVALID: Engineering (dept_id = 10) has 3 names ('Asha', 'Bilal', 'Charu') — WHICH name should SQL pick?!
SELECT dept_id, name, AVG(salary)
FROM employees
GROUP BY dept_id;
```

- **PostgreSQL** and **MySQL 5.7.5+ / 8.0+ (where `ONLY_FULL_GROUP_BY` is enabled by default in `sql_mode`)** rightly reject this query with an error!
- Legacy MySQL (`ONLY_FULL_GROUP_BY` disabled) famously accepted it and returned an **arbitrary indeterminate `name`** from the group — a classic source of production data bugs.

### `WHERE` vs `HAVING`: execution order, examples, and performance 🔥

| | `WHERE` | `HAVING` |
|---|---|---|
| **Filters** | Individual **rows** *before* grouping | Collapsed **groups** *after* `GROUP BY` |
| **Can use aggregates (`COUNT`, `SUM`, `AVG`)?** | **No** (`WHERE COUNT(*) > 2` is a syntax error!) | **Yes** (`HAVING COUNT(*) > 2`) |
| **Performance rule** | **Always push non-aggregate row filters into `WHERE`** so indexes are used and fewer rows enter the hash/sort aggregator! | Reserve strictly for conditions that depend on aggregate outputs |

```sql
-- "For employees hired since 2022, show departments whose total salary exceeds 150,000"
SELECT
  dept_id,
  COUNT(*)    AS headcount,
  SUM(salary) AS payroll
FROM employees
WHERE hired_at >= '2022-01-01'      -- 1. Row filter BEFORE grouping (uses index!)
  AND dept_id IS NOT NULL
GROUP BY dept_id                    -- 2. Bucket remaining rows by dept_id
HAVING SUM(salary) > 150000;        -- 3. Group filter AFTER aggregation
-- Result: dept_id = 10 | headcount = 3 | payroll = 310000.00
```

### Concatenate values inside a group: `STRING_AGG` (Postgres) vs `GROUP_CONCAT` (MySQL)

A very popular practical question (*"Return one row per department with a comma-separated sorted list of employee names"*):

```pgsql
-- PostgreSQL
SELECT
  dept_id,
  STRING_AGG(name, ', ' ORDER BY name ASC) AS team_members
FROM employees
WHERE dept_id IS NOT NULL
GROUP BY dept_id;
-- dept 10 -> 'Asha, Bilal, Charu'
```

```mysql
-- MySQL (watch out: group_concat_max_len defaults to 1024 bytes in MySQL and silently truncates long lists unless raised!)
SELECT
  dept_id,
  GROUP_CONCAT(name ORDER BY name ASC SEPARATOR ', ') AS team_members
FROM employees
WHERE dept_id IS NOT NULL
GROUP BY dept_id;
```

---

## Joins, set operations & subqueries visualised

### Visualise all 6 JOIN types on our dataset (plus how to write `FULL OUTER JOIN` in MySQL!) 🔥

Recall our data:
- `departments` has `10 (Eng)`, `20 (Prod)`, `30 (Design)`, and **`40 (Legal — 0 employees!)`**.
- `employees` has 5 employees in depts `10, 20, 30`, plus **`Farhan (dept_id = NULL — no department!)`**.

| Join type | Rows kept | On our 6 employees × 4 departments |
|---|---|---|
| **`INNER JOIN`** (`JOIN`) | Only pairs where `e.dept_id = d.id` matches | **5 rows** (Farhan dropped; Legal dropped) |
| **`LEFT JOIN`** (`LEFT OUTER JOIN`) | **Every left row**, plus matching right columns (or `NULL`s if unmatched) | `employees LEFT JOIN departments`: **6 rows** (Farhan kept with `d.name = NULL`; Legal dropped) |
| **`RIGHT JOIN`** (`RIGHT OUTER JOIN`) | **Every right row**, plus matching left columns (in practice, swap table order and write `LEFT JOIN` for readability!) | `employees RIGHT JOIN departments`: **6 rows** (5 matched + Legal with `e.name = NULL`; Farhan dropped) |
| **`FULL OUTER JOIN`** | Matched pairs + unmatched left rows + unmatched right rows | **7 rows** (5 matched + Farhan + Legal!) |
| **`CROSS JOIN`** | Cartesian product ($M \times N$ rows — no `ON` clause) | $6 \times 4 =$ **24 rows** (useful for generating date × store grids!) |
| **`SELF JOIN`** | A table joined to itself using **two different table aliases** | `employees e LEFT JOIN employees m ON e.manager_id = m.id` (pairs Bilal with manager Asha!) |

**Dialect trap — MySQL does NOT have `FULL OUTER JOIN`!** If asked in a MySQL round, combine `LEFT JOIN` and unmatched `RIGHT JOIN` with `UNION ALL`:

```mysql
-- Emulating FULL OUTER JOIN in MySQL (UNION ALL avoids an expensive deduplication sort!)
SELECT e.id AS emp_id, e.name AS emp_name, d.id AS dept_id, d.name AS dept_name
FROM employees e
LEFT JOIN departments d ON e.dept_id = d.id

UNION ALL

SELECT NULL AS emp_id, NULL AS emp_name, d.id AS dept_id, d.name AS dept_name
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.id
WHERE e.id IS NULL;
```

### Why does filtering the right table in `WHERE` silently break a `LEFT JOIN`? (`ON` vs `WHERE`) 🔥

This is **the single highest-frequency join trap in SQL interviews**. Suppose an interviewer asks: *"List **all** departments, alongside the count of employees earning over 90,000 (show `0` if none)."*

```sql
-- ✗ BROKEN: For Legal (0 employees) and Product (Dev earns 80k), e.salary after LEFT JOIN is NULL / 80k.
-- Then WHERE e.salary > 90000 evaluates NULL > 90000 -> UNKNOWN -> DROPS Product, Design, AND Legal!
SELECT d.name, COUNT(e.id) AS high_earners
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.id
WHERE e.salary > 90000
GROUP BY d.id, d.name;
-- Returns ONLY Engineering (3)! Legal, Product, and Design vanished!

-- ✓ CORRECT: Put the right-table filter inside ON so unmatched departments still survive with e.id = NULL!
-- And notice COUNT(e.id) — NEVER COUNT(*) here, because COUNT(*) would count the 1 NULL-padded row as 1 instead of 0!
SELECT d.name, COUNT(e.id) AS high_earners
FROM departments d
LEFT JOIN employees e
  ON e.dept_id = d.id
 AND e.salary > 90000
GROUP BY d.id, d.name;
-- Engineering: 3 | Product: 0 | Design: 0 | Legal: 0  ✓
```

Run the interactive pipeline simulator below to watch **exact rows** flow through `FROM → LEFT JOIN → WHERE → GROUP BY → HAVING → SELECT`, and verify both traps (`WHERE` vs `ON` and `COUNT(*)` vs `COUNT(e.id)`):

```js
// Mini relational execution engine modelling SQL's exact logical order
const departments = [
  { id: 10, name: 'Engineering' },
  { id: 20, name: 'Product' },
  { id: 30, name: 'Design' },
  { id: 40, name: 'Legal' },
];
const employees = [
  { id: 1, name: 'Asha', dept_id: 10, salary: 120000 },
  { id: 2, name: 'Bilal', dept_id: 10, salary: 95000 },
  { id: 3, name: 'Charu', dept_id: 10, salary: 95000 },
  { id: 4, name: 'Dev', dept_id: 20, salary: 80000 },
  { id: 5, name: 'Elena', dept_id: 30, salary: 88000 },
  { id: 6, name: 'Farhan', dept_id: null, salary: 60000 },
];

function leftJoin(left, right, onPred) {
  const out = [];
  for (const l of left) {
    const matches = right.filter((r) => onPred(l, r) === true);
    if (matches.length) {
      for (const r of matches) out.push({ d: l, e: r });
    } else {
      out.push({ d: l, e: { id: null, name: null, dept_id: null, salary: null } });
    }
  }
  return out;
}

function countByDept(rows, useCountStar = false) {
  const groups = new Map();
  for (const row of rows) {
    const g = groups.get(row.d.name) ?? [];
    g.push(row);
    groups.set(row.d.name, g);
  }
  return [...groups.entries()].map(([dept, grp]) => ({
    dept,
    high_earners: useCountStar ? grp.length : grp.filter((r) => r.e.id !== null).length,
  }));
}

// 1. Broken: filter in WHERE drops unmatched NULL rows!
const brokenRows = leftJoin(departments, employees, (d, e) => e.dept_id === d.id)
  .filter((r) => r.e.salary !== null && r.e.salary > 90000);

// 2. Fixed: filter in ON preserves every department!
const fixedRows = leftJoin(
  departments,
  employees,
  (d, e) => e.dept_id === d.id && e.salary > 90000,
);

console.log('Broken (filter in WHERE):', countByDept(brokenRows));
console.log('Fixed  (filter in ON + COUNT(e.id)):', countByDept(fixedRows, false));
console.log('Trap   (filter in ON + COUNT(*)):   ', countByDept(fixedRows, true));

test('Filtering right table in WHERE turns LEFT JOIN into INNER JOIN', () => {
  expect(countByDept(brokenRows)).toEqual([{ dept: 'Engineering', high_earners: 3 }]);
});

test('Filtering in ON + COUNT(e.id) keeps all 4 departments with accurate 0 counts', () => {
  expect(countByDept(fixedRows, false)).toEqual([
    { dept: 'Engineering', high_earners: 3 },
    { dept: 'Product', high_earners: 0 },
    { dept: 'Design', high_earners: 0 },
    { dept: 'Legal', high_earners: 0 },
  ]);
});

test('Using COUNT(*) after LEFT JOIN falsely counts NULL-padded rows as 1', () => {
  const legal = countByDept(fixedRows, true).find((x) => x.dept === 'Legal');
  expect(legal.high_earners).toBe(1);
});
```

### `UNION` vs `UNION ALL`, `INTERSECT` and `EXCEPT`: rules and performance 🔥

Set operators stack rows **vertically** (unlike `JOIN`, which combines columns horizontally). Both queries must return the **same number of columns** with compatible types, and column names come from the **first** `SELECT`:

| Set operator | Semantics | Deduplicates? | Dialect support |
|---|---|---|---|
| **`UNION ALL`** | Concatenates all rows from Query A + Query B | **No** — fast streaming $O(N + M)$, zero sort/hash! | Postgres & MySQL (all versions) |
| **`UNION`** | Unique rows present in A or B | **Yes** — sorts/hashes **all** rows to deduplicate (even duplicates *within* A alone!) | Postgres & MySQL |
| **`INTERSECT`** | Unique rows present in **both** A and B | Yes (`INTERSECT ALL` preserves multiplicity) | Postgres & **MySQL 8.0.31+** |
| **`EXCEPT`** (`MINUS` in Oracle) | Unique rows in A **not** present in B | Yes (`EXCEPT ALL` preserves multiplicity) | Postgres & **MySQL 8.0.31+** |

**Subtle interview insight:** Unlike `WHERE a = b`, set operators treat **`NULL` as equal to `NULL`** when deduplicating or matching across sets! And **always default to `UNION ALL`** unless you specifically need deduplication — interviewers regularly test whether you know `UNION` adds an unnecessary full sort/hash step.

```js
// Set operations treat NULLs as equal (IS NOT DISTINCT FROM semantics), unlike '='!
const rowKey = (row) => JSON.stringify(row); // null serialises deterministically

const unionAll = (a, b) => [...a, ...b];
const union = (a, b) => {
  const seen = new Set();
  return [...a, ...b].filter((r) => {
    const k = rowKey(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const intersect = (a, b) => {
  const bKeys = new Set(b.map(rowKey));
  return union(a, []).filter((r) => bKeys.has(rowKey(r)));
};
const except = (a, b) => {
  const bKeys = new Set(b.map(rowKey));
  return union(a, []).filter((r) => !bKeys.has(rowKey(r)));
};

const q1 = [{ id: 1 }, { id: 2 }, { id: 2 }, { id: null }];
const q2 = [{ id: 2 }, { id: 3 }, { id: null }];

console.log('UNION ALL:', unionAll(q1, q2));
console.log('UNION:    ', union(q1, q2));
console.log('INTERSECT:', intersect(q1, q2));
console.log('EXCEPT:   ', except(q1, q2));

test('UNION deduplicates both across queries AND within the same query, matching NULLs', () => {
  expect(unionAll(q1, q2)).toHaveLength(7);
  expect(union(q1, q2)).toEqual([{ id: 1 }, { id: 2 }, { id: null }, { id: 3 }]);
});
test('INTERSECT and EXCEPT match NULL rows cleanly', () => {
  expect(intersect(q1, q2)).toEqual([{ id: 2 }, { id: null }]);
  expect(except(q1, q2)).toEqual([{ id: 1 }]);
});
```

### Subqueries (scalar, row, table, correlated) vs CTEs (`WITH`): how do you choose? 🔥

A subquery is simply a `SELECT` nested inside parentheses, classified by **shape** and **dependency**:

1. **Scalar subquery (1 row, 1 column):** Can sit anywhere a single value can (`SELECT name, salary - (SELECT AVG(salary) FROM employees) AS diff_from_company_avg FROM employees;`). Errors at runtime if it returns >1 row!
2. **Multi-row, 1-column subquery (`IN` / `ANY` / `ALL`):** `WHERE dept_id IN (SELECT id FROM departments WHERE budget > 200000)`.
3. **Derived table (subquery in `FROM`):** **Must have an alias** in both PostgreSQL and MySQL (`FROM (SELECT ...) AS sub`).
4. **Correlated subquery:** References a column from the outer query (`WHERE e.salary > (SELECT AVG(e2.salary) FROM employees e2 WHERE e2.dept_id = e.dept_id)`). Conceptually evaluated per outer row (modern planners often decorrelate it into a hash join, or you can write it in a single pass with `AVG(salary) OVER (PARTITION BY dept_id)`!).
5. **Common Table Expressions — `WITH cte_name AS (...)` (Postgres & MySQL 8.0+):**
   - Reads **top-to-bottom** like clean variables in code instead of inside-out nested parentheses.
   - Can be referenced multiple times in the main query, and supports `WITH RECURSIVE` for trees/hierarchies.

---

## Views, indexes, transactions & fresher survival kit

### Views vs Materialised Views vs Temporary Tables vs CTEs

| Feature | CTE (`WITH`) | Standard `VIEW` | `MATERIALIZED VIEW` (PG) | `TEMPORARY TABLE` |
|---|---|---|---|---|
| **Lifetime** | Single SQL statement | Saved permanently in schema | Saved permanently in schema | Current DB session (or transaction with `ON COMMIT DROP` in PG) |
| **Stores data on disk?** | No (virtual step) | **No** — just a saved query macro expanded on every read | **Yes** — caches computed result on disk; can have **its own indexes**! | **Yes** — session-private table; can be indexed & `ANALYZE`d |
| **Freshness** | Real-time | Real-time | Potentially stale until `REFRESH MATERIALIZED VIEW CONCURRENTLY` | Static snapshot from creation |
| **MySQL note** | Supported in MySQL 8.0+ | Supported (`CREATE VIEW`) | **No native `MATERIALIZED VIEW` in MySQL** — emulate with a summary table refreshed by cron/events/triggers! | `CREATE TEMPORARY TABLE` |

### Fresher's 60-second mental model of Indexes and ACID Transactions 🔥

Even in junior rounds, interviewers ask *"What is an index, why not index every column?"* and *"What is ACID?"*

- **Indexes (the Textbook Index analogy):**
  - Without an index, `WHERE email = 'asha@co.com'` reads **every single page** of the table (**Sequential / Full Table Scan** — $O(N)$).
  - A **B-tree index** keeps a sorted, balanced tree of `(email → row pointer)` so lookups take **$O(\log N)$** (~3–4 page reads even on 100 million rows!), and range queries (`ORDER BY`, `BETWEEN`, `LIKE 'abc%'`) walk sorted leaf nodes directly.
  - **Trade-off (why you don't index every column):** Every `INSERT`, `UPDATE` (on indexed columns, or non-HOT in PG), and `DELETE` must also update **every index** on that table — slowing down writes, consuming RAM/disk, and adding maintenance overhead.

- **ACID Transactions (the Bank Transfer ₹500 from A → B analogy):**
  - **Atomicity ("all or nothing"):** Debit A and Credit B both succeed, or if power fails halfway, Undo/Rollback restores A so money never vanishes.
  - **Consistency ("valid state to valid state"):** Every constraint (`CHECK (balance >= 0)`, `FOREIGN KEY`, `UNIQUE`) holds true when `COMMIT` completes.
  - **Isolation ("concurrent transactions don't step on each other"):** Two simultaneous checkouts for the last concert seat don't both succeed (`READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE` + row locks).
  - **Durability ("committed = survives a power plug pull"):** Before `COMMIT` returns `OK`, changes are flushed to non-volatile **WAL (`pg_wal`)** in Postgres or **InnoDB Redo Log** in MySQL.

### Essential `psql` (PostgreSQL) vs `mysql` CLI survival commands

Knowing CLI inspection commands proves you've actually worked with databases rather than only clicking GUI buttons:

| Task | PostgreSQL (`psql`) | MySQL (`mysql` CLI) |
|---|---|---|
| **Connect** | `psql -h localhost -U appuser -d mydb` | `mysql -h localhost -u appuser -p mydb` |
| **List databases** | `\l` | `SHOW DATABASES;` |
| **Switch database** | `\c other_db` | `USE other_db;` |
| **List tables** | `\dt` (`\dt+` includes table sizes on disk!) | `SHOW TABLES;` |
| **Inspect table columns, types & indexes** | `\d employees` / `\d+ employees` | `DESCRIBE employees;` and `SHOW CREATE TABLE employees\G` |
| **List indexes on a table** | Shown inside `\d employees`, or query `pg_indexes` | `SHOW INDEX FROM employees;` |
| **Measure query execution time** | `\timing on` | Shown automatically (`0.01 sec`), or `EXPLAIN ANALYZE ...` |
| **Vertical output for wide rows** | `\x` (toggles expanded vertical display) | Terminate query with `\G` instead of `;` |
| **See running queries** | `SELECT pid, state, query FROM pg_stat_activity;` | `SHOW FULL PROCESSLIST;` |
| **Quit** | `\q` | `EXIT;` or `Ctrl+D` |

### Top 15 rapid-fire SQL fresher interview traps (one-line answers) 🔥

| # | Interviewer Trap Question | Crisp Answer |
|---|---|---|
| 1 | Does `WHERE col != 'active'` include rows where `col IS NULL`? | **No!** `'active' != NULL` is `UNKNOWN`, dropping `NULL` rows. Use `WHERE col IS DISTINCT FROM 'active'` (PG) or `WHERE NOT (col <=> 'active')` (MySQL) or `OR col IS NULL`. |
| 2 | What does `SELECT 10 + NULL` return? | **`NULL`**. Use `COALESCE(x, 0)` before arithmetic. |
| 3 | What happens if `NOT IN (SELECT ...)` has even **one** `NULL` in the subquery? | Returns **0 rows**! Always use `NOT EXISTS` instead of `NOT IN`. |
| 4 | Does `AVG(bonus)` include `NULL` rows in the denominator? | **No** — only non-NULL rows. Use `AVG(COALESCE(bonus, 0))` to include them as zero. |
| 5 | What does `SUM(amount)` return when `WHERE` matches 0 rows? | **`NULL`** (whereas `COUNT(*)` returns **`0`**!). Wrap with `COALESCE(SUM(amount), 0)`. |
| 6 | Can a table have multiple `UNIQUE` keys vs multiple `PRIMARY KEY`s? | At most **1 `PRIMARY KEY`** (can be composite), and **many `UNIQUE` constraints**. `PRIMARY KEY` disallows `NULL`; `UNIQUE` allows multiple `NULL`s. |
| 7 | Why did `SELECT 3 / 4` return `0` in PostgreSQL? | Integer division truncates in Postgres! Cast or multiply by `1.0`: `3.0 / 4` → `0.75`. |
| 8 | Why can't I write `WHERE total_orders > 5` using an alias defined in `SELECT`? | Logical evaluation runs **`WHERE` (step 2)** long before **`SELECT` (step 5)**! Use `HAVING COUNT(*) > 5` or wrap in a CTE. |
| 9 | Does `LIKE '%kumar'` use a standard B-tree index? | **No** — a leading `%` breaks B-tree prefix ordering! (`LIKE 'kumar%'` *can* use a B-tree index with proper operator class/collation; `%kumar%` needs Postgres `pg_trgm` GIN or Full-Text Search.) |
| 10 | If I run `SELECT * FROM users` twice without `ORDER BY`, is order guaranteed identical? | **Never.** Relational tables are unordered sets; always write `ORDER BY` when order matters. |
| 11 | Why did my `LEFT JOIN` drop unmatched left rows? | You filtered a right-table column in `WHERE` instead of `ON`! |
| 12 | Why did `COUNT(*)` return `1` instead of `0` on an empty department after `LEFT JOIN`? | `COUNT(*)` counts the 1 `NULL`-padded left row! Always use `COUNT(right_table.pk)` after `LEFT JOIN`. |
| 13 | What is the difference between `UNION` and `UNION ALL`? | `UNION` sorts/hashes to remove duplicates (even within the same query); `UNION ALL` concatenates all rows with zero dedup overhead. |
| 14 | Should you store money in `FLOAT` / `DOUBLE`? | **Never** — binary float rounding corrupts currency. Use `NUMERIC(p,s)` / `DECIMAL(p,s)` or integer cents in `BIGINT`. |
| 15 | Can you `ROLLBACK` a `TRUNCATE TABLE`? | **Yes in PostgreSQL** (transactional DDL); **No in MySQL** (DDL triggers an implicit `COMMIT`). |
