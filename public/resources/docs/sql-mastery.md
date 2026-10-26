# SQL Mastery: Queries, Joins & Window Functions

Your resume lists **PostgreSQL**, and the LoadOTR dashboard and the ScaleCapacity back ends are the kind of systems where SQL questions come from. Full-stack interviews almost always include a **live SQL round**. The interviewer shares a schema and asks for queries of increasing difficulty: joins, aggregates, "top N per group", "consecutive days", "running totals", "find duplicates". Then they probe whether you understand **why** the query works: NULL semantics, join cardinality, window frames.

This doc goes deeper than [Databases: PostgreSQL & DynamoDB](/docs/databases-sql). New to SQL or want a ground-up refresher first? Start with [SQL Fundamentals (Fresher → Interview-Ready)](/docs/sql-fundamentals), then pair this guide with [PostgreSQL Deep Dive](/docs/postgresql-deep-dive), [MySQL & InnoDB Deep Dive](/docs/mysql-deep-dive), and [SQL Scalability & Query Efficiency](/docs/sql-scalability-efficiency). Every query here is **PostgreSQL** unless stated otherwise, and where MySQL differs, it says so.

> SQL isn't runnable in the playground. Each query lists its expected result. The trickier semantics (three-valued logic, ranking functions, gaps-and-islands, window frames) are reproduced in **runnable JavaScript with tests**, so you can experiment with them.

**Interview schema used throughout:**

```sql
CREATE TABLE departments (
  id    INT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE employees (
  id          INT PRIMARY KEY,
  name        TEXT NOT NULL,
  dept_id     INT REFERENCES departments(id),       -- nullable: contractors have no department
  manager_id  INT REFERENCES employees(id),          -- self-reference (org chart)
  salary      NUMERIC(10,2) NOT NULL,
  hired_at    DATE NOT NULL
);

CREATE TABLE customers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  city        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku       TEXT NOT NULL UNIQUE,
  name      TEXT NOT NULL,
  category  TEXT NOT NULL,
  price     NUMERIC(10,2) NOT NULL CHECK (price >= 0)
);

CREATE TABLE orders (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  status       TEXT NOT NULL CHECK (status IN ('pending','paid','shipped','cancelled','refunded')),
  total        NUMERIC(12,2) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  qty         INT NOT NULL CHECK (qty > 0),
  unit_price  NUMERIC(10,2) NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE logins (                                  -- for streak / retention problems
  user_id     BIGINT NOT NULL,
  login_at    TIMESTAMPTZ NOT NULL
);
```

## How SQL evaluates a query

### Walk me through the logical order of a SELECT, and why it matters 🔥

SQL is **declarative**. You write `SELECT` first, but the database **logically** evaluates the clauses in a different order. The physical plan can differ, but the **result must be as if** this order were followed:

| Step | Clause | What it does | Consequence |
|---|---|---|---|
| 1 | `FROM` / `JOIN` / `LATERAL` | Builds the working row set | Join conditions run before any filtering in `WHERE` |
| 2 | `WHERE` | Filters **rows** | Can't reference aggregates, window functions or `SELECT` aliases |
| 3 | `GROUP BY` | Collapses rows into groups | After this, only grouped columns and aggregates are visible |
| 4 | `HAVING` | Filters **groups** | Can use aggregates; can't use `SELECT` aliases in Postgres |
| 5 | Window functions | Computed over the grouped rows | So `WHERE rank <= 3` is impossible in the same query level |
| 6 | `SELECT` expressions | Projects columns and creates aliases | Aliases exist only from here on |
| 7 | `DISTINCT` / `DISTINCT ON` | Removes duplicates | `DISTINCT ON` keeps the first row per key according to `ORDER BY` |
| 8 | `ORDER BY` | Sorts | **Can** use aliases and window results |
| 9 | `OFFSET` / `LIMIT` / `FETCH` | Paginates | Without `ORDER BY`, the order is **not guaranteed** |

**Questions this answers in interviews:**

- **"Why can't I filter on a window function?"** Window functions are computed after `WHERE`. Wrap the query in a subquery or CTE and filter outside. (Snowflake, BigQuery and DuckDB offer **`QUALIFY`** for this; PostgreSQL and MySQL don't.)
- **"Why does `WHERE total_spent > 100` fail when `total_spent` is a `SELECT` alias?"** The alias doesn't exist yet at step 2.
- **"Can I use an aggregate in `WHERE`?"** No. Use `HAVING`, or aggregate in a subquery.
- **"Is the result ordered if I don't say `ORDER BY`?"** No. It may *look* ordered (an index scan, for example) until the plan changes.

```sql
-- ✗ ERROR: window functions are not allowed in WHERE
SELECT name, salary, RANK() OVER (ORDER BY salary DESC) AS rnk
FROM employees
WHERE rnk <= 3;

-- ✓ Filter in an outer query
SELECT name, salary, rnk
FROM (
  SELECT name, salary, RANK() OVER (ORDER BY salary DESC) AS rnk
  FROM employees
) ranked
WHERE rnk <= 3
ORDER BY rnk;
```

**Postgres specifics worth knowing:**

- `ORDER BY` and `GROUP BY` accept output aliases and ordinals (`GROUP BY 1`). `HAVING` and `WHERE` don't.
- **`DISTINCT ON (expr)`** is a PostgreSQL extension that returns the first row of each group. It is often the shortest "top 1 per group" query:

```sql
-- Highest-paid employee per department (ties broken by the earliest hire)
SELECT DISTINCT ON (dept_id) dept_id, name, salary
FROM employees
ORDER BY dept_id, salary DESC, hired_at;     -- ORDER BY must start with the DISTINCT ON expressions
```

### How does NULL behave in SQL? Explain three-valued logic 🔥

`NULL` means **unknown or missing**, not zero and not an empty string. Any comparison with NULL yields **UNKNOWN**, and **`WHERE` and `ON` keep only rows that evaluate to TRUE**.

| Expression | Result |
|---|---|
| `NULL = NULL` | UNKNOWN (not TRUE) |
| `NULL <> 1` | UNKNOWN |
| `TRUE AND UNKNOWN` | UNKNOWN |
| `FALSE AND UNKNOWN` | **FALSE** |
| `TRUE OR UNKNOWN` | **TRUE** |
| `FALSE OR UNKNOWN` | UNKNOWN |
| `NOT UNKNOWN` | UNKNOWN |
| `NULL IS NULL` | TRUE |
| `NULL IS DISTINCT FROM NULL` | FALSE (null-safe comparison) |
| `1 IS DISTINCT FROM NULL` | TRUE |

**The traps interviewers love:**

1. **`NOT IN` with a NULL in the list returns nothing.** `x NOT IN (1, NULL)` means `x <> 1 AND x <> NULL`, which is `… AND UNKNOWN`. That is never TRUE, so no rows come back. If the subquery column is nullable, use **`NOT EXISTS`**.
2. **Aggregates skip NULLs.**
   - `COUNT(col)` counts non-NULL values; `COUNT(*)` counts rows.
   - `AVG(col)` divides by the non-NULL count, so `AVG(bonus)` ≠ `SUM(bonus) / COUNT(*)` when some bonuses are NULL.
   - `SUM` over only NULLs (or zero rows) returns **NULL**, not 0. Wrap it: `COALESCE(SUM(x), 0)`.
3. **`GROUP BY` and `DISTINCT` treat NULLs as equal.** All NULLs form one group, which is inconsistent with `=` but practical.
4. **UNIQUE constraints allow multiple NULLs** by default (NULLs are not equal to each other). PostgreSQL 15+ supports `UNIQUE NULLS NOT DISTINCT` to allow only one.
5. **Sorting:**
   - In Postgres, NULLs sort **as if larger than every value**: last in `ASC`, first in `DESC`.
   - MySQL sorts them first in `ASC`.
   - Be explicit with `NULLS FIRST` / `NULLS LAST`, which Postgres supports.
6. **String concatenation:** `'a' || NULL` is NULL. `concat('a', NULL)` is `'a'`.
7. **Division by zero:** `total / NULLIF(count, 0)` returns NULL instead of an error.
8. **`CASE WHEN col = NULL`** never matches. Write `WHEN col IS NULL`.

```sql
-- Employees not in the department list of a project: wrong if project_members.dept_id can be NULL
SELECT name FROM employees WHERE dept_id NOT IN (SELECT dept_id FROM project_members);   -- ✗ may return 0 rows

SELECT e.name FROM employees e
WHERE NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.dept_id = e.dept_id);         -- ✓ NULL-safe

-- Null-safe "has the value changed?" (e.g. in an UPDATE … WHERE or a trigger)
UPDATE products SET price = 19.99 WHERE id = 7 AND price IS DISTINCT FROM 19.99;
```

The runnable block below models SQL's three-valued logic in JavaScript, using `null` for UNKNOWN. Run it and change the inputs:

```js
// SQL three-valued logic: true, false, null (= UNKNOWN)
const AND = (a, b) => (a === false || b === false ? false : a === null || b === null ? null : true);
const OR = (a, b) => (a === true || b === true ? true : a === null || b === null ? null : false);
const NOT = (a) => (a === null ? null : !a);
const EQ = (a, b) => (a === null || b === null ? null : a === b);   // SQL '='

// x NOT IN (list)  ===  x <> v1 AND x <> v2 AND ...
const notIn = (x, list) => list.reduce((acc, v) => AND(acc, NOT(EQ(x, v))), true);
// WHERE keeps a row only when the predicate is TRUE (not null)
const where = (rows, pred) => rows.filter((r) => pred(r) === true);

const deptIds = [1, 2, 3, 4];
console.log('NOT IN (1, 2):      ', where(deptIds, (x) => notIn(x, [1, 2])));
console.log('NOT IN (1, 2, NULL):', where(deptIds, (x) => notIn(x, [1, 2, null])));

test('NULL = NULL is unknown, not true', () => {
  expect(EQ(null, null)).toBeNull();
});
test('FALSE AND UNKNOWN is FALSE; TRUE OR UNKNOWN is TRUE', () => {
  expect(AND(false, null)).toBe(false);
  expect(OR(true, null)).toBe(true);
});
test('NOT IN with a NULL in the list filters out every row', () => {
  expect(where(deptIds, (x) => notIn(x, [1, 2]))).toEqual([3, 4]);
  expect(where(deptIds, (x) => notIn(x, [1, 2, null]))).toEqual([]);
});
```

### `COUNT(*)` vs `COUNT(1)` vs `COUNT(col)` vs `COUNT(DISTINCT col)`

| Form | Counts | Notes |
|---|---|---|
| `COUNT(*)` | All rows in the group | The idiomatic choice |
| `COUNT(1)` | All rows (1 is never NULL) | **Identical** in Postgres and MySQL; there's no performance difference, despite the myth |
| `COUNT(col)` | Rows where `col` is **not NULL** | Useful after a LEFT JOIN: `COUNT(o.id)` gives 0 for customers without orders, while `COUNT(*)` would give 1 |
| `COUNT(DISTINCT col)` | Distinct non-NULL values | Requires sorting or hashing; expensive on large sets. Approximate alternatives: HyperLogLog extensions, `approx_count_distinct` in other engines |

```sql
SELECT c.id, c.name,
       COUNT(*)    AS wrong_count,      -- 1 for customers with no orders (the NULL-extended row counts)
       COUNT(o.id) AS order_count       -- 0 for customers with no orders ✓
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id;                          -- Postgres: c.name is allowed because it depends on the PK
```

> **Counting the whole table quickly:** `SELECT COUNT(*) FROM big_table` must scan, because MVCC means there's no stored row count. For a dashboard estimate, use `SELECT reltuples FROM pg_class WHERE relname = 'big_table'`, which is maintained by `ANALYZE`.

## Joins in depth

### Show what each JOIN type returns on the same data 🔥

Two tiny tables make the semantics obvious:

```sql
-- employees (id, name, dept_id)        departments (id, name)
-- 1 Asha    10                         10 Engineering
-- 2 Ravi    20                         20 Sales
-- 3 Meera   NULL                       30 Legal
-- 4 John    99   (dangling dept id, no FK)
```

| Query | Rows returned |
|---|---|
| `e JOIN d ON e.dept_id = d.id` | Asha–Engineering, Ravi–Sales (**2 rows**) |
| `e LEFT JOIN d ON …` | Asha–Engineering, Ravi–Sales, **Meera–NULL, John–NULL** (4 rows) |
| `e RIGHT JOIN d ON …` | Asha–Engineering, Ravi–Sales, **NULL–Legal** (3 rows) |
| `e FULL JOIN d ON …` | Asha–Eng, Ravi–Sales, Meera–NULL, John–NULL, NULL–Legal (**5 rows**) |
| `e CROSS JOIN d` | 4 × 3 = **12 rows** |
| `e JOIN d ON true` | Same as CROSS JOIN |

**Cardinality rule:** a join returns one row **per matching pair**. If one employee could match two departments (a one-to-many relation in the join direction), that employee appears twice. Most "my numbers are too big" bugs come from this. See the fan-out question below.

**`ON` vs `WHERE` in an outer join, the classic trap:**

```sql
-- Departments with their *active* employees, keeping departments with none
SELECT d.name, e.name
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.id AND e.salary > 0      -- ✓ condition in ON: Legal still appears (with NULL)
ORDER BY d.name;

SELECT d.name, e.name
FROM departments d
LEFT JOIN employees e ON e.dept_id = d.id
WHERE e.salary > 0;                                             -- ✗ NULL > 0 is UNKNOWN: Legal is filtered out
                                                                --   the LEFT JOIN silently became an INNER JOIN
```

**`USING` and `NATURAL`:**

- `JOIN orders USING (customer_id)` joins on the same-named column and outputs it once.
- `NATURAL JOIN` joins on **all** same-named columns. Avoid it: adding a `created_at` column to both tables silently changes the join.

### Semi-joins and anti-joins: `EXISTS` vs `IN` vs `JOIN` 🔥

- **Semi-join:** "rows of A that have **at least one** match in B". Each A row appears once, however many matches it has.
- **Anti-join:** "rows of A with **no** match in B".

```sql
-- Customers who placed at least one order in 2026 (semi-join)
SELECT c.* FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o
  WHERE o.customer_id = c.id AND o.created_at >= '2026-01-01'
);

-- Equivalent: Postgres plans IN (subquery) as a semi-join too
SELECT c.* FROM customers c
WHERE c.id IN (SELECT customer_id FROM orders WHERE created_at >= '2026-01-01');

-- ✗ A plain JOIN duplicates customers with several orders; DISTINCT then hides the bug and costs a sort
SELECT DISTINCT c.* FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.created_at >= '2026-01-01';

-- Customers who never ordered (anti-join): three ways
SELECT c.* FROM customers c WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id);   -- ✓ best
SELECT c.* FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL;           -- ✓ same plan
SELECT c.* FROM customers c WHERE c.id NOT IN (SELECT customer_id FROM orders);                       -- ⚠ NULL trap; can't use an anti-join
```

**Performance answer:**

- In modern Postgres, **`EXISTS`, `IN (subquery)` and `LEFT JOIN … IS NULL` usually produce the same semi- or anti-join plan** (Hash Semi Join, Hash Anti Join, Nested Loop Anti Join…).
- **`NOT IN` is the exception.** Because of NULL semantics, the planner **can't turn it into an anti-join**. It becomes a hashed SubPlan, or, if the subquery result doesn't fit in `work_mem`, a re-scan per outer row, which can be catastrophic.
- **MySQL 8** also converts these to semi- and anti-joins. Older MySQL versions were notoriously bad at `IN (subquery)`.

### What is a LATERAL join, and when do you need one? 🔥

A **`LATERAL`** subquery can **reference columns from tables earlier in the FROM clause**. It acts like a correlated subquery that can return **multiple rows and columns**. SQL Server calls this `CROSS APPLY` / `OUTER APPLY`.

**Typical uses:**

- Top-N per group.
- Calling a set-returning function per row.
- Reusing a computed expression.

```sql
-- The 3 most recent orders for every customer (customers with none are kept)
SELECT c.id, c.name, recent.id AS order_id, recent.total, recent.created_at
FROM customers c
LEFT JOIN LATERAL (
  SELECT o.id, o.total, o.created_at
  FROM orders o
  WHERE o.customer_id = c.id            -- ← references c: only legal because of LATERAL
  ORDER BY o.created_at DESC
  LIMIT 3
) recent ON true
ORDER BY c.id, recent.created_at DESC;

-- Reuse a computed value without repeating the expression
SELECT o.id, calc.net, calc.net * 0.18 AS gst
FROM orders o
CROSS JOIN LATERAL (SELECT o.total - COALESCE((SELECT SUM(amount) FROM refunds r WHERE r.order_id = o.id), 0) AS net) calc;
```

**Why it's fast:** with an index on `orders (customer_id, created_at DESC)`, each lateral probe is an **index scan that stops after 3 rows**. A window function (`ROW_NUMBER() … WHERE rn <= 3`) must number **every** order first. For "few customers, many orders each", LATERAL wins by orders of magnitude.

### Self joins: find employees who earn more than their manager 🔥

```sql
SELECT e.name AS employee, e.salary, m.name AS manager, m.salary AS manager_salary
FROM employees e
JOIN employees m ON m.id = e.manager_id          -- same table, two roles
WHERE e.salary > m.salary;
```

**Variations they ask next:**

```sql
-- Employees whose manager is in a different department
SELECT e.name FROM employees e JOIN employees m ON m.id = e.manager_id
WHERE e.dept_id IS DISTINCT FROM m.dept_id;

-- Managers with at least 3 direct reports
SELECT m.id, m.name, COUNT(*) AS reports
FROM employees m JOIN employees e ON e.manager_id = m.id
GROUP BY m.id, m.name
HAVING COUNT(*) >= 3;

-- Pairs of employees in the same department (each pair once, no self-pairs)
SELECT a.name, b.name, a.dept_id
FROM employees a JOIN employees b ON a.dept_id = b.dept_id AND a.id < b.id;
```

`a.id < b.id` removes both the self-pair (Asha, Asha) and the mirror duplicate ((Asha, Ravi) vs (Ravi, Asha)).

### What is the join fan-out problem, and how do you avoid double counting? 🔥

When you join a parent to **two independent one-to-many children**, every child row on one side pairs with every child row on the other. Aggregates are then **multiplied**.

```sql
-- Customer 1 has 2 orders (100, 200) and 3 support tickets.
-- ✗ Joining both children first: each order row is repeated 3 times
SELECT c.id, SUM(o.total) AS revenue, COUNT(t.id) AS tickets
FROM customers c
LEFT JOIN orders o  ON o.customer_id = c.id
LEFT JOIN tickets t ON t.customer_id = c.id
GROUP BY c.id;
-- revenue = 900 (should be 300), tickets = 6 (should be 3)

-- ✓ Pre-aggregate each child, then join one row per customer
SELECT c.id,
       COALESCE(o.revenue, 0) AS revenue,
       COALESCE(t.tickets, 0) AS tickets
FROM customers c
LEFT JOIN (SELECT customer_id, SUM(total) AS revenue FROM orders GROUP BY customer_id) o ON o.customer_id = c.id
LEFT JOIN (SELECT customer_id, COUNT(*) AS tickets FROM tickets GROUP BY customer_id) t ON t.customer_id = c.id;

-- ✓ Or use correlated scalar subqueries (fine for small result sets)
SELECT c.id,
       (SELECT COALESCE(SUM(total), 0) FROM orders o WHERE o.customer_id = c.id) AS revenue,
       (SELECT COUNT(*) FROM tickets t WHERE t.customer_id = c.id) AS tickets
FROM customers c;
```

**What to say:** "Before I aggregate, I check the **grain** of the joined result, meaning what one row represents. If two one-to-many joins hang off the same parent, I aggregate each to the parent's grain first." `COUNT(DISTINCT t.id)` would fix the ticket count but **not** the SUM, so it isn't a general fix.

## Aggregation

### Explain GROUP BY in depth: functional dependency, FILTER, GROUPING SETS 🔥

**Grouping rules:**

- Every non-aggregated column in `SELECT` must be in `GROUP BY`, **or functionally dependent** on it.
- Postgres knows that if you group by a table's **primary key**, every other column of that table is determined by it. So `GROUP BY c.id` lets you select `c.name`.
- MySQL with `ONLY_FULL_GROUP_BY` (the default since 5.7) applies the same rule. Older MySQL allowed any column and returned an arbitrary value.

**Conditional aggregation:**

```sql
-- One pass over orders, many metrics
SELECT date_trunc('month', created_at) AS month,
       COUNT(*)                                          AS orders,
       COUNT(*) FILTER (WHERE status = 'cancelled')       AS cancelled,       -- Postgres/SQLite syntax
       SUM(total) FILTER (WHERE status IN ('paid','shipped')) AS revenue,
       SUM(CASE WHEN status = 'refunded' THEN total ELSE 0 END) AS refunded,  -- portable (MySQL) form
       ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cancelled') / COUNT(*), 1) AS cancel_pct
FROM orders
GROUP BY 1
ORDER BY 1;
```

**Aggregates you should know:**

| Aggregate | Example |
|---|---|
| `string_agg(name, ', ' ORDER BY name)` | Comma list per group (`GROUP_CONCAT` in MySQL) |
| `array_agg(DISTINCT city)` | Postgres array |
| `json_agg(row_to_json(t))`, `jsonb_object_agg(k, v)` | Build JSON |
| `bool_and(paid)`, `bool_or(flagged)` | All / any |
| `MIN`/`MAX` on text and dates | Work as expected |
| `percentile_cont(0.5) WITHIN GROUP (ORDER BY total)` | Median (an ordered-set aggregate) |
| `mode() WITHIN GROUP (ORDER BY city)` | Most frequent value |

**Subtotals with `GROUPING SETS`, `ROLLUP` and `CUBE`:**

```sql
SELECT category, date_part('year', o.created_at) AS yr, SUM(oi.qty * oi.unit_price) AS revenue,
       GROUPING(category, date_part('year', o.created_at)) AS level   -- bitmask: which columns are rolled up
FROM order_items oi
JOIN products p ON p.id = oi.product_id
JOIN orders o   ON o.id = oi.order_id
GROUP BY ROLLUP (category, date_part('year', o.created_at))
ORDER BY category NULLS LAST, yr NULLS LAST;
```

- `ROLLUP (a, b)` produces the groups `(a, b)`, `(a)` and `()`: subtotals plus a grand total.
- `CUBE (a, b)` adds `(b)`: every combination.
- `GROUPING SETS ((a), (b), ())` lists exactly the groups you want.
- **`GROUPING()`** distinguishes a subtotal row's NULL from a real NULL value.

### Pivot rows into columns, and unpivot columns into rows 🔥

There's no portable `PIVOT` keyword. SQL Server and Oracle have one; Postgres has the `crosstab()` function in the `tablefunc` extension. **Conditional aggregation** works everywhere:

```sql
-- Revenue per category with one column per quarter (2026)
SELECT p.category,
       SUM(oi.qty * oi.unit_price) FILTER (WHERE date_part('quarter', o.created_at) = 1) AS q1,
       SUM(oi.qty * oi.unit_price) FILTER (WHERE date_part('quarter', o.created_at) = 2) AS q2,
       SUM(oi.qty * oi.unit_price) FILTER (WHERE date_part('quarter', o.created_at) = 3) AS q3,
       SUM(oi.qty * oi.unit_price) FILTER (WHERE date_part('quarter', o.created_at) = 4) AS q4
FROM order_items oi
JOIN orders o   ON o.id = oi.order_id
JOIN products p ON p.id = oi.product_id
WHERE o.created_at >= '2026-01-01' AND o.created_at < '2027-01-01'
GROUP BY p.category
ORDER BY p.category;
```

To **unpivot**, turn columns back into rows with `LATERAL (VALUES …)`. This is cleaner than four `UNION ALL`s and reads the table once:

```sql
-- quarterly_targets(category, q1, q2, q3, q4)  →  (category, quarter, target)
SELECT t.category, v.quarter, v.target
FROM quarterly_targets t
CROSS JOIN LATERAL (VALUES (1, t.q1), (2, t.q2), (3, t.q3), (4, t.q4)) AS v(quarter, target);
```

**Dynamic pivots**, where the column list comes from the data, can't be done in plain SQL, because the column list must be known at plan time. Build the SQL in application code, or return long-format rows and pivot in the UI (usually the right answer for a React dashboard).

## Subqueries & CTEs

### Correlated vs non-correlated subqueries: how do they execute? 🔥

- **Non-correlated:** independent of the outer query, so it's evaluated once. `WHERE salary > (SELECT AVG(salary) FROM employees)`.
- **Correlated:** references the outer row, so it's **logically evaluated per outer row**. `WHERE salary > (SELECT AVG(salary) FROM employees e2 WHERE e2.dept_id = e.dept_id)`.

```sql
-- Employees earning above their department's average: three equivalent forms
-- 1. Correlated subquery (logically per row; Postgres may cache or hash it)
SELECT e.name, e.dept_id, e.salary
FROM employees e
WHERE e.salary > (SELECT AVG(e2.salary) FROM employees e2 WHERE e2.dept_id = e.dept_id);

-- 2. Pre-aggregated derived table + join (one pass per table)
SELECT e.name, e.dept_id, e.salary
FROM employees e
JOIN (SELECT dept_id, AVG(salary) AS avg_sal FROM employees GROUP BY dept_id) a USING (dept_id)
WHERE e.salary > a.avg_sal;

-- 3. Window function (a single scan, often the cleanest)
SELECT name, dept_id, salary
FROM (SELECT e.*, AVG(salary) OVER (PARTITION BY dept_id) AS avg_sal FROM employees e) x
WHERE salary > avg_sal;
```

**Scalar subquery rule:**

- A subquery in `SELECT` or used with `=` must return **at most one row**, or you get "more than one row returned by a subquery used as an expression".
- Zero rows yields NULL.

### What are CTEs, and are they an optimisation fence? 🔥

A **CTE** (`WITH name AS (…)`) names a subquery for readability and reuse. **Materialisation behaviour** is a common senior-level follow-up:

| PostgreSQL version | Behaviour |
|---|---|
| ≤ 11 | CTEs were **always materialised**: an optimisation fence, so predicates weren't pushed inside |
| **12+** | A non-recursive, side-effect-free CTE **referenced once is inlined** like a subquery. Referenced **twice or more**, it's materialised. You can force either with `AS MATERIALIZED` / `AS NOT MATERIALIZED` |

```sql
-- Force materialisation when an expensive CTE is reused, or to stop a bad predicate push-down
WITH recent AS MATERIALIZED (
  SELECT * FROM orders WHERE created_at > now() - interval '7 days'
)
SELECT (SELECT COUNT(*) FROM recent) AS n, (SELECT SUM(total) FROM recent) AS revenue;
```

**Data-modifying CTEs.** These are Postgres-only and very powerful for atomic multi-step operations in **one statement**:

```sql
-- Move orders older than 2 years to an archive table atomically
WITH moved AS (
  DELETE FROM orders
  WHERE created_at < now() - interval '2 years'
  RETURNING *
)
INSERT INTO orders_archive
SELECT * FROM moved;

-- Insert a customer if missing, and always return its id (race-safe with the unique index on email)
WITH ins AS (
  INSERT INTO customers (name, email) VALUES ('Zaki', 'zaki@example.com')
  ON CONFLICT (email) DO NOTHING
  RETURNING id
)
SELECT id FROM ins
UNION ALL
SELECT id FROM customers WHERE email = 'zaki@example.com'
LIMIT 1;
```

The upsert example assumes a unique index on `email`, which the schema above doesn't define.

**Caveat:** all sub-statements run against **the same snapshot**. A later part can't see rows that an earlier part inserted into the same table, except through `RETURNING`.

### Write recursive CTEs: org chart, hierarchy path, cycle detection 🔥

A recursive CTE has an **anchor** member and a **recursive** member, combined with `UNION ALL`. Execution is iterative:

1. Run the anchor to get the working set.
2. Run the recursive part against the working set to get new rows.
3. Repeat until no new rows are produced.

```sql
-- All reports (direct and indirect) under employee 1, with depth and the path from the top
WITH RECURSIVE chain AS (
  SELECT id, name, manager_id, 0 AS depth, ARRAY[name] AS path
  FROM employees
  WHERE id = 1                                   -- anchor: the root
  UNION ALL
  SELECT e.id, e.name, e.manager_id, c.depth + 1, c.path || e.name
  FROM employees e
  JOIN chain c ON e.manager_id = c.id            -- recursive step: children of the previous level
)
SELECT repeat('  ', depth) || name AS org_chart, depth, array_to_string(path, ' → ') AS path
FROM chain
ORDER BY path;

-- Management chain *upwards* from employee 42 to the CEO
WITH RECURSIVE up AS (
  SELECT id, name, manager_id FROM employees WHERE id = 42
  UNION ALL
  SELECT m.id, m.name, m.manager_id FROM employees m JOIN up ON m.id = up.manager_id
)
SELECT * FROM up;
```

**Cycle protection.** This matters for graph data such as "friends", "routes" or "category parents" where bad data may loop:

```sql
-- PostgreSQL 14+: built-in CYCLE clause
WITH RECURSIVE g AS (
  SELECT id, parent_id FROM categories WHERE id = 1
  UNION ALL
  SELECT c.id, c.parent_id FROM categories c JOIN g ON c.parent_id = g.id
) CYCLE id SET is_cycle USING visited
SELECT * FROM g WHERE NOT is_cycle;

-- Portable: carry the visited path and refuse to revisit
WITH RECURSIVE g AS (
  SELECT id, parent_id, ARRAY[id] AS visited FROM categories WHERE id = 1
  UNION ALL
  SELECT c.id, c.parent_id, g.visited || c.id
  FROM categories c JOIN g ON c.parent_id = g.id
  WHERE NOT c.id = ANY (g.visited)
)
SELECT * FROM g;
```

**Other recursive-CTE uses:**

- Generating sequences (prefer `generate_series` in Postgres).
- Bill of materials, meaning the total quantity of parts.
- Walking a linked list stored in a table.
- Shortest path on small graphs (but use a graph database or application code for real graph workloads).

## Window functions in depth

### `ROW_NUMBER` vs `RANK` vs `DENSE_RANK` vs `NTILE`: show the difference 🔥

Salaries in descending order: 100, 90, 90, 80.

| salary | `ROW_NUMBER()` | `RANK()` | `DENSE_RANK()` | `NTILE(2)` | `PERCENT_RANK()` | `CUME_DIST()` |
|---|---|---|---|---|---|---|
| 100 | 1 | 1 | 1 | 1 | 0 | 0.25 |
| 90 | 2 | 2 | 2 | 1 | 0.333 | 0.75 |
| 90 | 3 | 2 | 2 | 2 | 0.333 | 0.75 |
| 80 | 4 | **4** (gap) | **3** (no gap) | 2 | 1 | 1 |

**What each one means:**

- **`ROW_NUMBER`**: unique and arbitrary among ties. Add a tiebreaker to `ORDER BY` for deterministic results.
- **`RANK`**: ties share a rank and the next rank **skips**, like Olympic medals.
- **`DENSE_RANK`**: ties share a rank and there's **no gap**. Use it for "Nth highest **distinct** salary".
- **`NTILE(n)`**: splits rows into n buckets as evenly as possible, for quartiles.
- **`PERCENT_RANK`** = (rank − 1) / (rows − 1).
- **`CUME_DIST`** = (rows ≤ current, peers included) / rows.

**Which to choose:**

- "Top 3 earners" with ties included: `RANK`/`DENSE_RANK`.
- "Exactly 3 rows": `ROW_NUMBER`.
- "Deduplicate keeping one": `ROW_NUMBER`.

The runnable block reproduces the semantics so you can test edge cases:

```js
// Reproduce SQL ranking functions over rows already sorted by the ORDER BY key
function rankings(sortedValues) {
  const n = sortedValues.length;
  let rank = 0, dense = 0;
  return sortedValues.map((v, i) => {
    const isPeerOfPrev = i > 0 && sortedValues[i - 1] === v;
    if (!isPeerOfPrev) { rank = i + 1; dense++; }
    const peersThrough = sortedValues.lastIndexOf(v) + 1;   // rows <= current, including peers
    return {
      value: v,
      row_number: i + 1,
      rank,
      dense_rank: dense,
      percent_rank: n > 1 ? +((rank - 1) / (n - 1)).toFixed(3) : 0,
      cume_dist: +(peersThrough / n).toFixed(3),
    };
  });
}

const rows = rankings([100, 90, 90, 80]);
console.table(rows);

test('RANK leaves a gap after ties, DENSE_RANK does not', () => {
  expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  expect(rows.map((r) => r.dense_rank)).toEqual([1, 2, 2, 3]);
  expect(rows.map((r) => r.row_number)).toEqual([1, 2, 3, 4]);
});
test('PERCENT_RANK and CUME_DIST', () => {
  expect(rows.map((r) => r.percent_rank)).toEqual([0, 0.333, 0.333, 1]);
  expect(rows.map((r) => r.cume_dist)).toEqual([0.25, 0.75, 0.75, 1]);
});
```

### Explain window frames: `ROWS` vs `RANGE` vs `GROUPS`, and the `LAST_VALUE` trap 🔥

A window has three parts:

```text
FUNC() OVER (
  PARTITION BY …     -- which rows belong to the window (like GROUP BY, without collapsing)
  ORDER BY …         -- the order inside the partition
  frame clause       -- which rows *relative to the current row* the function sees
)
```

**The default frame catches people out:**

- **No `ORDER BY`:** the frame is the **whole partition**. `SUM(x) OVER (PARTITION BY d)` gives the partition total.
- **With `ORDER BY`:** the default is **`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`**. The frame ends at the **last peer** of the current row (rows with the same ORDER BY value).

**Consequences:**

1. A running total over a column with duplicates gives **the same total to tied rows**. Use `ROWS` for a strict row-by-row running total.
2. **`LAST_VALUE(x) OVER (ORDER BY …)` returns the current row (or its last peer), not the partition's last value.** Specify the full frame.

```sql
SELECT day, amount,
       SUM(amount) OVER (ORDER BY day)                                             AS running_range,  -- peers share totals
       SUM(amount) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_rows,
       LAST_VALUE(amount) OVER (ORDER BY day)                                      AS wrong_last,      -- ≈ current row
       LAST_VALUE(amount) OVER (ORDER BY day ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS real_last,
       AVG(amount) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)    AS moving_avg_7_rows,
       AVG(amount) OVER (ORDER BY day RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW) AS moving_avg_7_days
FROM daily_sales;
```

| Frame unit | "1 PRECEDING" means |
|---|---|
| `ROWS` | One physical row back |
| `RANGE` | All rows whose ORDER BY **value** is within the offset (Postgres 11+ supports numeric and interval offsets). Handles missing days correctly |
| `GROUPS` | One **peer group** back (Postgres 11+) |

**Named windows** avoid repetition: `… OVER w … WINDOW w AS (PARTITION BY dept_id ORDER BY salary DESC)`.

The JavaScript below shows exactly how `RANGE` (peers) differs from `ROWS` for a running total:

```js
// Running total with RANGE (peer-aware, the SQL default) vs ROWS
const sales = [
  { day: '2026-10-01', amount: 10 },
  { day: '2026-10-02', amount: 5 },
  { day: '2026-10-02', amount: 7 },   // same ORDER BY value: a "peer" of the previous row
  { day: '2026-10-03', amount: 3 },
];

function runningRows(rows) {
  let acc = 0;
  return rows.map((r) => (acc += r.amount));
}
function runningRange(rows) {
  // frame = all rows with ORDER BY value <= current value (all peers included)
  return rows.map((r) => rows.filter((x) => x.day <= r.day).reduce((s, x) => s + x.amount, 0));
}

console.log('ROWS :', runningRows(sales));
console.log('RANGE:', runningRange(sales));

test('RANGE gives tied rows the same running total', () => {
  expect(runningRows(sales)).toEqual([10, 15, 22, 25]);
  expect(runningRange(sales)).toEqual([10, 22, 22, 25]);
});
```

### Use `LAG` and `LEAD` for period-over-period metrics 🔥

`LAG(expr, offset = 1, default)` reads a **previous row** in the window order, and `LEAD` reads a **following** row. There's no self join and only one scan.

```sql
-- Month-over-month revenue growth
WITH monthly AS (
  SELECT date_trunc('month', created_at) AS month, SUM(total) AS revenue
  FROM orders WHERE status IN ('paid','shipped')
  GROUP BY 1
)
SELECT month, revenue,
       LAG(revenue) OVER (ORDER BY month)                          AS prev_revenue,
       revenue - LAG(revenue) OVER (ORDER BY month)                AS delta,
       ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month))
             / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1)   AS growth_pct
FROM monthly
ORDER BY month;

-- Days between a customer's consecutive orders, and their next order
SELECT customer_id, id, created_at,
       created_at - LAG(created_at) OVER w AS since_previous,
       LEAD(id) OVER w                     AS next_order_id
FROM orders
WINDOW w AS (PARTITION BY customer_id ORDER BY created_at);
```

**Year-over-year on monthly data:** use `LAG(revenue, 12)` only if **no months are missing**. Otherwise, self join on `month - interval '1 year'`, or fill the gaps with `generate_series` first.

### Return the top 3 highest-paid employees in each department (several ways) 🔥

```sql
-- 1. Window function: the most common answer. Choose the ranking function deliberately
SELECT dept_id, name, salary
FROM (
  SELECT e.*, DENSE_RANK() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS rnk
  FROM employees e
) t
WHERE rnk <= 3                         -- DENSE_RANK: top 3 *distinct salaries*, ties included
ORDER BY dept_id, salary DESC;

-- 2. LATERAL: best when there are few departments and many employees, with an index on (dept_id, salary DESC)
SELECT d.name, top.name, top.salary
FROM departments d
CROSS JOIN LATERAL (
  SELECT name, salary FROM employees e WHERE e.dept_id = d.id ORDER BY salary DESC LIMIT 3
) top;

-- 3. Correlated count: portable to ancient databases; O(n²) without good indexes
SELECT e.dept_id, e.name, e.salary
FROM employees e
WHERE (SELECT COUNT(DISTINCT e2.salary) FROM employees e2
       WHERE e2.dept_id = e.dept_id AND e2.salary > e.salary) < 3;

-- 4. Top 1 per group only: DISTINCT ON (Postgres)
SELECT DISTINCT ON (dept_id) dept_id, name, salary FROM employees ORDER BY dept_id, salary DESC;
```

**Clarify before you write.** Ask "should ties be included?", then name the function: `ROW_NUMBER` for exactly 3 rows, `RANK` for top 3 with ties (possibly more than 3 rows), `DENSE_RANK` for the top 3 distinct salary levels. Asking this is exactly what interviewers want to see.

### Gaps and islands: find each user's longest streak of consecutive login days 🔥

**The trick:** for consecutive dates, `date − ROW_NUMBER()` is **constant** within a streak. Group by that constant (the "island key").

```sql
WITH days AS (                                     -- 1. one row per user per day (dedupe multiple logins)
  SELECT DISTINCT user_id, login_at::date AS d
  FROM logins
),
islands AS (                                       -- 2. date minus row number = the same value inside a streak
  SELECT user_id, d,
         d - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY d))::int AS island
  FROM days
),
streaks AS (                                       -- 3. one row per streak
  SELECT user_id, MIN(d) AS start_day, MAX(d) AS end_day, COUNT(*) AS len
  FROM islands
  GROUP BY user_id, island
)
SELECT DISTINCT ON (user_id) user_id, start_day, end_day, len   -- 4. longest per user
FROM streaks
ORDER BY user_id, len DESC, start_day;
```

**Variations:**

- "Users who logged in **3 days in a row**": `HAVING COUNT(*) >= 3` in step 3.
- "Find the **gaps**": `LEAD(d) OVER (…) - d > 1`.
- "Consecutive seat numbers available": the same trick on integers.

Here's the same algorithm in JavaScript, so you can trace the island keys:

```js
// Gaps & islands: dateNumber - rowNumber is constant inside a run of consecutive days
const DAY = 24 * 60 * 60 * 1000;
const toDayNo = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

function longestStreak(isoDates) {
  const days = [...new Set(isoDates.map(toDayNo))].sort((a, b) => a - b);  // DISTINCT + ORDER BY
  const groups = new Map();
  days.forEach((d, i) => {
    const island = d - (i + 1);                                           // d - ROW_NUMBER()
    groups.set(island, [...(groups.get(island) ?? []), d]);
  });
  const streaks = [...groups.values()].map((g) => g.length);
  return { streaks, longest: Math.max(0, ...streaks) };
}

const logins = ['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-09'];
console.log(longestStreak(logins));

test('islands of consecutive days', () => {
  expect(longestStreak(logins)).toEqual({ streaks: [3, 2, 1], longest: 3 });
  expect(longestStreak([]).longest).toBe(0);
});
```

### Sessionise click events with a 30-minute inactivity gap

```sql
WITH flagged AS (
  SELECT user_id, ts,
         CASE WHEN LAG(ts) OVER w IS NULL
                OR ts - LAG(ts) OVER w > interval '30 minutes'
              THEN 1 ELSE 0 END AS is_new_session
  FROM events
  WINDOW w AS (PARTITION BY user_id ORDER BY ts)
)
SELECT user_id, ts,
       SUM(is_new_session) OVER (PARTITION BY user_id ORDER BY ts
                                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS session_no
FROM flagged;
```

This pattern is **"flag the boundaries, then take a running sum of the flags"**. It solves many problems:

- Sessions.
- Grouping status changes.
- "Reset the counter when X happens".

`ROWS` is specified so that events with identical timestamps don't share a session number by accident (the `RANGE` peer behaviour).

## Classic interview queries

### Find the Nth highest salary, returning NULL if it doesn't exist 🔥

```sql
-- DENSE_RANK: Nth highest *distinct* salary (N = 3 here)
SELECT (
  SELECT DISTINCT salary
  FROM (SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS r FROM employees) t
  WHERE r = 3
) AS third_highest;                                -- the scalar subquery yields NULL when there is no 3rd value

-- OFFSET form
SELECT (SELECT DISTINCT salary FROM employees ORDER BY salary DESC OFFSET 2 LIMIT 1) AS third_highest;

-- Without window functions or LIMIT (old-school whiteboard answer)
SELECT MAX(salary) FROM employees
WHERE salary < (SELECT MAX(salary) FROM employees WHERE salary < (SELECT MAX(salary) FROM employees));

-- Nth highest *per department*
SELECT dept_id, salary
FROM (SELECT dept_id, salary, DENSE_RANK() OVER (PARTITION BY dept_id ORDER BY salary DESC) AS r FROM employees) t
WHERE r = 2
GROUP BY dept_id, salary;
```

**Edge cases to mention:**

- **Duplicates.** If the salaries are 100, 100, 90, is the "second highest" 100 or 90? `DENSE_RANK` and `DISTINCT` give 90.
- **NULL salaries.** They sort first in `DESC` order in Postgres, so add `WHERE salary IS NOT NULL` or `NULLS LAST`.
- **Fewer than N distinct values.** Return NULL rather than no row (LeetCode 176/177 expect this).

### Delete duplicate rows but keep one 🔥

```sql
-- Find duplicates first (always look before deleting)
SELECT lower(email) AS email, COUNT(*), array_agg(id ORDER BY created_at) AS ids
FROM customers
GROUP BY lower(email)
HAVING COUNT(*) > 1;

-- Keep the oldest row per email; delete the rest
DELETE FROM customers c
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY created_at, id) AS rn
  FROM customers
) d
WHERE c.id = d.id AND d.rn > 1;

-- Self-join variant
DELETE FROM customers a
USING customers b
WHERE lower(a.email) = lower(b.email) AND a.id > b.id;

-- Then make it impossible to happen again
CREATE UNIQUE INDEX CONCURRENTLY customers_email_lower_uq ON customers (lower(email));
```

**Things to mention:**

- **Tables without a primary key.** Postgres exposes the physical row id `ctid`: `DELETE FROM t a USING t b WHERE a.ctid < b.ctid AND a.email = b.email`. MySQL has no equivalent; copy the distinct rows to a new table and swap.
- **Large tables.** Delete in **batches**, so locks are short and WAL/replication lag stays manageable.
- **Foreign keys.** Rows that reference the duplicates must be **re-pointed to the survivor first**. This is a real-world gotcha.

### Find customers who bought every product in a category (relational division) 🔥

```sql
-- Count-based: did they buy as many distinct Audio products as exist?
SELECT o.customer_id
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
JOIN products p     ON p.id = oi.product_id
WHERE p.category = 'Audio' AND o.status <> 'cancelled'
GROUP BY o.customer_id
HAVING COUNT(DISTINCT p.id) = (SELECT COUNT(*) FROM products WHERE category = 'Audio');

-- Double NOT EXISTS: "there is no Audio product that this customer has not bought"
SELECT c.id, c.name
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM products p
  WHERE p.category = 'Audio'
    AND NOT EXISTS (
      SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id
      WHERE o.customer_id = c.id AND oi.product_id = p.id
    )
);
```

**The empty-category edge case:** if the category has **no products**, the double NOT EXISTS returns **every** customer (a vacuous truth), while the count version returns **nobody**. Saying this impresses interviewers.

### Build a monthly cohort retention table 🔥

**Question:** of the customers who first ordered in month M, what percentage ordered again in month M+1, M+2, and so on?

```sql
WITH first_order AS (
  SELECT customer_id, date_trunc('month', MIN(created_at)) AS cohort
  FROM orders
  GROUP BY customer_id
),
activity AS (
  SELECT DISTINCT o.customer_id, f.cohort,
         (date_part('year', o.created_at) - date_part('year', f.cohort)) * 12
       + (date_part('month', o.created_at) - date_part('month', f.cohort)) AS month_no
  FROM orders o
  JOIN first_order f USING (customer_id)
)
SELECT cohort::date, month_no::int, COUNT(*) AS active_customers,
       ROUND(100.0 * COUNT(*) / FIRST_VALUE(COUNT(*)) OVER (PARTITION BY cohort ORDER BY month_no), 1) AS retention_pct
FROM activity
GROUP BY cohort, month_no
ORDER BY cohort, month_no;
```

The SELECT uses a **window function over an aggregate** (`FIRST_VALUE(COUNT(*)) OVER …`). That's legal because window functions run after `GROUP BY`, and month 0 is the cohort size.

**Timezone caveat:** with `TIMESTAMPTZ`, `date_trunc` uses the **session time zone**, so pin it (`SET TIME ZONE 'Asia/Kolkata'`, or `date_trunc('month', created_at AT TIME ZONE 'Asia/Kolkata')`). Otherwise the month boundaries move with the server's settings.

### Compute medians, percentiles and the Pareto (80/20) split

```sql
-- Median and p95 order value per month (ordered-set aggregates: not window functions in Postgres)
SELECT date_trunc('month', created_at) AS month,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY total) AS median,       -- interpolated
       percentile_disc(0.95) WITHIN GROUP (ORDER BY total) AS p95           -- an actual value from the set
FROM orders GROUP BY 1 ORDER BY 1;

-- Which top customers produce 80% of revenue? (running share)
WITH rev AS (
  SELECT customer_id, SUM(total) AS revenue FROM orders WHERE status <> 'cancelled' GROUP BY customer_id
),
ranked AS (
  SELECT customer_id, revenue,
         SUM(revenue) OVER (ORDER BY revenue DESC, customer_id ROWS UNBOUNDED PRECEDING) / SUM(revenue) OVER () AS cum_share
  FROM rev
)
SELECT * FROM ranked WHERE cum_share - revenue / (SELECT SUM(revenue) FROM rev) < 0.8;   -- rows that start below 80%
```

### Detect overlapping bookings, and prevent them with a constraint 🔥

Two half-open intervals `[a_start, a_end)` and `[b_start, b_end)` **overlap if and only if `a_start < b_end AND b_start < a_end`**. Memorise this. It's the same rule for meeting-room scheduling, webinar slots or driver shifts.

```sql
-- Find conflicting meeting bookings in the same room
SELECT a.id AS booking_a, b.id AS booking_b, a.room_id
FROM bookings a
JOIN bookings b
  ON a.room_id = b.room_id
 AND a.id < b.id
 AND a.start_at < b.end_at
 AND b.start_at < a.end_at;

-- Postgres range types make it declarative
SELECT * FROM bookings
WHERE tstzrange(start_at, end_at, '[)') && tstzrange('2026-10-09 10:00+05:30', '2026-10-09 11:00+05:30', '[)');

-- And an exclusion constraint makes double-booking *impossible*, even under concurrency
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (room_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&);
```

**Why the constraint matters:** a "check then insert" in application code has a **race condition**. Two requests both see "free" and both insert. The exclusion constraint is enforced by the database atomically. PostgreSQL 18 also adds **temporal keys** (`PRIMARY KEY (room_id, during WITHOUT OVERLAPS)`) for the same idea.

### Fill in missing dates so a chart has no gaps 🔥

```sql
-- Daily revenue for September 2026 including days with zero orders
SELECT d::date AS day, COALESCE(SUM(o.total), 0) AS revenue, COUNT(o.id) AS orders
FROM generate_series(date '2026-09-01', date '2026-09-30', interval '1 day') AS d
LEFT JOIN orders o
       ON o.created_at >= d AND o.created_at < d + interval '1 day'   -- sargable range, not o.created_at::date = d
GROUP BY d
ORDER BY d;
```

**Two details matter:**

- **Generate the calendar, then LEFT JOIN the facts.** An inner join, or a `WHERE` on `o.*`, would drop the empty days.
- **Use a half-open range rather than casting the column.** `o.created_at::date = d` prevents a plain index on `created_at` from being used.

### UPSERT, MERGE and UPDATE … FROM 🔥

```sql
-- Upsert a product price; only touch the row if the price really changed
INSERT INTO products (sku, name, category, price)
VALUES ('CAM-01', 'Webcam', 'Video', 49.00)
ON CONFLICT (sku) DO UPDATE
  SET price = EXCLUDED.price, name = EXCLUDED.name
  WHERE products.price IS DISTINCT FROM EXCLUDED.price
RETURNING id, (xmax = 0) AS inserted;      -- xmax = 0 is a well-known Postgres hack to tell insert from update

-- Update using another table (Postgres syntax)
UPDATE orders o
SET status = 'cancelled'
FROM customers c
WHERE c.id = o.customer_id AND c.email LIKE '%@blocked.example' AND o.status = 'pending';

-- MySQL equivalent
-- UPDATE orders o JOIN customers c ON c.id = o.customer_id SET o.status = 'cancelled' WHERE …;

-- MERGE (SQL standard; Postgres 15+, RETURNING since 17): sync a staging table into products
MERGE INTO products p
USING staging_products s ON s.sku = p.sku
WHEN MATCHED AND s.deleted THEN DELETE
WHEN MATCHED THEN UPDATE SET price = s.price, name = s.name
WHEN NOT MATCHED AND NOT s.deleted THEN INSERT (sku, name, category, price) VALUES (s.sku, s.name, s.category, s.price);
```

**`ON CONFLICT` vs `MERGE` under concurrency:**

- `INSERT … ON CONFLICT` is **atomic and race-safe**. It uses the unique index to arbitrate concurrent inserts.
- `MERGE` can still fail with a unique violation if a concurrent transaction inserts the same key. Prefer `ON CONFLICT` for single-row upserts from an API, and `MERGE` for batch syncs.
- **MySQL** uses `INSERT … ON DUPLICATE KEY UPDATE`.

### LeetCode-style drills: consecutive numbers, rising temperature, department top earner

```sql
-- LC 180: numbers that appear at least 3 times consecutively (ids are consecutive)
SELECT DISTINCT num AS consecutive_nums
FROM (
  SELECT num, LAG(num) OVER (ORDER BY id) AS p1, LAG(num, 2) OVER (ORDER BY id) AS p2
  FROM logs
) t
WHERE num = p1 AND num = p2;

-- LC 197: days warmer than the previous calendar day (a self join on date arithmetic handles missing days)
SELECT w.id
FROM weather w
JOIN weather y ON y.record_date = w.record_date - 1
WHERE w.temperature > y.temperature;

-- LC 184: highest earners in each department, ties included
SELECT d.name AS department, e.name AS employee, e.salary
FROM employees e
JOIN departments d ON d.id = e.dept_id
WHERE (e.dept_id, e.salary) IN (SELECT dept_id, MAX(salary) FROM employees GROUP BY dept_id);

-- LC 1484-style: products sold per day as a sorted, comma-separated list
SELECT o.created_at::date AS sell_date,
       COUNT(DISTINCT p.name) AS num_sold,
       string_agg(DISTINCT p.name, ',' ORDER BY p.name) AS products
FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN products p ON p.id = oi.product_id
GROUP BY 1 ORDER BY 1;

-- Mutual friends of users 1 and 2 (friendships stored in both directions)
SELECT f1.friend_id
FROM friendships f1
JOIN friendships f2 ON f1.friend_id = f2.friend_id
WHERE f1.user_id = 1 AND f2.user_id = 2;
```

**Why the LAG version of LC 180 is preferred:** the self join `l1.id = l2.id - 1` breaks when ids have gaps. `LAG` works on row order. To handle gaps **in ids**, use the gaps-and-islands technique.

## PostgreSQL power features

### Query JSONB, and build API-ready JSON directly in SQL 🔥

| Operator / function | Meaning |
|---|---|
| `data -> 'video'` | Get a key as `jsonb` |
| `data ->> 'title'` | Get a key as `text` |
| `data #>> '{video,codec}'` | Path, as text |
| `data @> '{"recording": true}'` | **Containment** (GIN-indexable) |
| `data ? 'lobby'` | Key exists |
| `jsonb_path_query(data, '$.tracks[*] ? (@.kind == "video")')` | SQL/JSON path |
| `jsonb_set(data, '{video,quality}', '"720p"')` | Update a nested value |
| `data - 'secret'` | Remove a key |
| `JSON_TABLE(...)` | Turn JSON into rows (Postgres 17+) |

```sql
-- Meetings that have recording enabled and use VP9
SELECT id, title
FROM meetings
WHERE settings @> '{"recording": true}'
  AND settings #>> '{video,codec}' = 'VP9';

CREATE INDEX meetings_settings_gin ON meetings USING gin (settings jsonb_path_ops);  -- speeds up @>

-- One query → nested JSON for an API response (avoids N+1 from the app)
SELECT json_build_object(
  'id', c.id,
  'name', c.name,
  'orders', COALESCE(
     json_agg(json_build_object('id', o.id, 'total', o.total, 'status', o.status) ORDER BY o.created_at DESC)
       FILTER (WHERE o.id IS NOT NULL),
     '[]'::json)
) AS customer
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE c.id = $1
GROUP BY c.id;
```

**JSONB vs columns:**

- Use **real columns** for anything you filter, join, constrain or aggregate on often.
- Use **JSONB** for genuinely variable attributes: per-meeting settings, feature flags, third-party payloads.
- JSONB is binary, deduplicates keys, doesn't preserve key order, and is indexable. Plain `JSON` keeps the exact text and is only useful for storing payloads verbatim.

### Arrays, `unnest` and `ANY`

```sql
-- Tags stored as text[]
SELECT * FROM products WHERE 'wireless' = ANY (tags);              -- membership
SELECT * FROM products WHERE tags @> ARRAY['wireless','usb-c'];    -- contains all (GIN-indexable)
SELECT tag, COUNT(*) FROM products, unnest(tags) AS tag GROUP BY tag ORDER BY 2 DESC;   -- explode

-- Pass a list of ids from an app as ONE parameter (no string-built IN list)
SELECT * FROM orders WHERE id = ANY ($1::bigint[]);
```

**Arrays vs a join table:**

- **Arrays** suit small, unordered value lists that are always read with the parent.
- Use a **join table** when you need foreign keys, per-item attributes, or queries from the other side ("all products with tag X" at scale).

### How do you implement search: `LIKE`, trigram, or full-text search? 🔥

| Need | Tool | Index |
|---|---|---|
| Prefix search (`'zak%'`) | `LIKE 'zak%'` | B-tree with `text_pattern_ops` (or the C collation) |
| Substring or typo-tolerant search (`'%webrt%'`, "did you mean") | `pg_trgm`: `ILIKE`, `similarity()`, `%` | **GIN/GiST trigram** index |
| Natural-language search with stemming and ranking | Full-text search: `tsvector` / `tsquery` | **GIN** on the tsvector |
| Facets, fuzzy relevance at scale, multi-language analyzers | **OpenSearch / Elasticsearch / Meilisearch** | Inverted index in a separate system |

```sql
-- Full-text search on documents (e.g. SCAI processed documents)
ALTER TABLE documents ADD COLUMN search tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,''))) STORED;
CREATE INDEX documents_search_gin ON documents USING gin (search);

SELECT id, title, ts_rank(search, q) AS rank
FROM documents, websearch_to_tsquery('english', 'invoice -draft "purchase order"') AS q
WHERE search @@ q
ORDER BY rank DESC
LIMIT 20;

-- Trigram fuzzy search for an autocomplete box
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX customers_name_trgm ON customers USING gin (name gin_trgm_ops);
SELECT name, similarity(name, 'zakiudin') AS sim FROM customers WHERE name % 'zakiudin' ORDER BY sim DESC LIMIT 10;
```

### Views vs materialised views; functions, procedures and triggers 🔥

| Object | What it is | Use it for |
|---|---|---|
| **View** | A stored query, expanded at query time | Hiding complexity, column-level security, a stable API over a changing schema |
| **Materialised view** | Stored **results**, refreshed manually | Expensive dashboards. `REFRESH MATERIALIZED VIEW CONCURRENTLY` (needs a unique index) keeps it readable during the refresh |
| **Function** | Returns a value or set; callable in queries | Reusable computations, set-returning functions, RLS helpers |
| **Procedure** (`CALL`) | Can `COMMIT`/`ROLLBACK` inside | Batch jobs that commit in chunks |
| **Trigger** | A function fired on INSERT/UPDATE/DELETE | Audit logs, `updated_at` maintenance, denormalised counters. Use sparingly: triggers hide logic and slow writes |

```sql
-- Audit trigger (generic, stores the old and new row as JSONB)
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY, table_name text, op text, row_old jsonb, row_new jsonb,
  changed_by text DEFAULT current_setting('app.user_id', true), changed_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (table_name, op, row_old, row_new)
  VALUES (TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER orders_audit AFTER INSERT OR UPDATE OR DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION audit();
```

**Business logic in the database or the application?**

- **Keep integrity rules in the database:** constraints, FKs, unique and exclusion constraints. They're the only thing that's race-proof.
- **Keep business workflows in the application:** testable, versioned, observable.
- Triggers are fine for **cross-cutting mechanics** such as auditing or `updated_at`.

### How do you prevent SQL injection in every stack? 🔥

**Never concatenate user input into SQL.** Use **parameterised queries** (prepared statements). The value travels separately from the SQL text, so it can't change the query's structure.

```node
// Node (node-postgres): $1, $2 placeholders
const { rows } = await pool.query('SELECT * FROM orders WHERE customer_id = $1 AND status = $2', [customerId, status]);

// ✗ NEVER
await pool.query(`SELECT * FROM orders WHERE customer_id = ${req.query.id}`);   // ?id=1 OR 1=1
```

```java
// Java JDBC
try (PreparedStatement ps = conn.prepareStatement("SELECT * FROM orders WHERE customer_id = ? AND status = ?")) {
    ps.setLong(1, customerId);
    ps.setString(2, status);
    ResultSet rs = ps.executeQuery();
}
```

```python
# Python (psycopg): %s placeholders; the driver escapes the values
cur.execute("SELECT * FROM orders WHERE customer_id = %s AND status = %s", (customer_id, status))
```

**The parts that can't be parameterised:**

- **Identifiers** (`ORDER BY` column, table names) and keywords (`ASC`/`DESC`). **Whitelist** them:
  ```node
  const SORTABLE = { created: 'created_at', total: 'total' };
  const col = SORTABLE[req.query.sort] ?? 'created_at';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  await pool.query(`SELECT * FROM orders ORDER BY ${col} ${dir} LIMIT $1`, [limit]);
  ```
- **`LIKE` patterns:** parameterise the value **and** escape `%` and `_` if users shouldn't be able to use wildcards.
- **Dynamic SQL inside PL/pgSQL:** use `format('%I', ident)` for identifiers and `%L` or `USING` for values.
- **ORMs aren't automatically safe.** Raw-query escape hatches (`sequelize.query`, `knex.raw`, `$queryRawUnsafe`, Hibernate string-built HQL) reintroduce injection.

**Defence in depth:** least-privilege database users (the app user can't `DROP`), **row-level security** for multi-tenant data, and input validation.

### PostgreSQL vs MySQL: what differences should you know? 🔥

| Area | PostgreSQL | MySQL (InnoDB) |
|---|---|---|
| MVCC | New row versions stored **in the heap**; old versions cleaned by **VACUUM** | Updates in place; old versions in the **undo log**, purged automatically |
| Table storage | Heap; all indexes point to the tuple (ctid) | **Clustered index on the PK**: rows live in the PK B-tree, and secondary indexes store the PK. Random UUID PKs hurt more |
| Default isolation | **READ COMMITTED** | **REPEATABLE READ** (with gap/next-key locks) |
| JSON | **JSONB** with GIN indexes and rich operators | JSON type, functional and multi-valued indexes |
| Upsert | `ON CONFLICT … DO UPDATE` | `ON DUPLICATE KEY UPDATE` |
| Extras | Arrays, ranges, exclusion constraints, partial/expression indexes, `DISTINCT ON`, LATERAL, rich extensions (PostGIS, pgvector, pg_trgm, TimescaleDB) | Simpler operations, very common in LAMP stacks; invisible indexes |
| DDL | **Transactional DDL** (roll back a migration) | DDL causes an implicit commit; online DDL with `ALGORITHM=INPLACE/INSTANT` |
| Case and collation | Identifiers are folded to lower case; `=` is case-sensitive | Default collations are **case-insensitive** for string comparison |
| Replication | Physical streaming plus logical replication | Binlog-based (row/statement), Group Replication |

**One-liner for the interview:** "Postgres is my default for its correctness, rich types and extensions. MySQL is equally fine for straightforward OLTP. The differences that bite are MVCC/VACUUM vs undo logs, MySQL's clustered PK, and the default isolation levels."

### Which SQL syntax differs between dialects?

| Task | PostgreSQL | MySQL | SQL Server | Oracle |
|---|---|---|---|---|
| First N rows | `LIMIT 10` / `FETCH FIRST 10 ROWS ONLY` | `LIMIT 10` | `TOP 10` / `OFFSET … FETCH` | `FETCH FIRST 10 ROWS ONLY` (12c+) |
| Concatenate strings | `a \|\| b`, `concat()` | `CONCAT(a, b)` (`\|\|` means OR by default) | `a + b`, `CONCAT()` | `a \|\| b` |
| Auto-increment | `GENERATED … AS IDENTITY` | `AUTO_INCREMENT` | `IDENTITY(1,1)` | `GENERATED AS IDENTITY` |
| Current time | `now()` | `NOW()` | `SYSDATETIME()` | `SYSTIMESTAMP` |
| Group concatenation | `string_agg` | `GROUP_CONCAT` | `STRING_AGG` | `LISTAGG` |
| Case-insensitive match | `ILIKE` | `LIKE` (default collation) | `LIKE` (collation-dependent) | `UPPER(a) LIKE UPPER(b)` |
| Boolean type | `boolean` | `TINYINT(1)` | `BIT` | `BOOLEAN` (23ai+) |

### How do you approach a live SQL interview question? 🔥

A repeatable method, which is worth saying out loud:

1. **Restate the grain of the output:** "one row per customer per month".
2. **Clarify edge cases:**
   - Ties: include or not?
   - NULLs: are there any?
   - Zero rows: should those groups be included?
   - Time zones: which one defines day boundaries?
   - Cancelled or refunded orders: counted or not?
3. **Pick the building blocks:** joins for relationships, `GROUP BY` for the grain, window functions for "relative to other rows", CTEs for steps.
4. **Write it in CTE steps** with meaningful names. It's readable, and each step can be tested on its own (`SELECT * FROM step1 LIMIT 10`).
5. **Sanity-check the cardinality:** does any join fan out? Does a LEFT JOIN become inner because of `WHERE`?
6. **Talk about performance:**
   - Which index supports this (for example `orders (customer_id, created_at)`)?
   - Is the predicate sargable?
   - Should the result be a materialised view for a dashboard?

**Tie it to your own experience** (only what you really did): *[e.g. "For the LoadOTR dashboard's Node API I wrote the per-vendor aggregate queries; I learned to pre-aggregate before joining and to keep date ranges half-open so they use the index."]*
