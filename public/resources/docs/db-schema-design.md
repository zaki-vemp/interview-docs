# Schema Design, Normalization & Migrations

Design questions ("Design the schema for X", "How would you store Y?") test whether you can turn requirements into tables that stay **correct under concurrency**, are **fast for the real access patterns**, and can **evolve without downtime**.

This doc covers:

- Normalisation, worked properly.
- The modelling patterns that come up again and again: trees, polymorphism, soft delete, multi-tenancy, ledgers, time zones, ordered lists.
- Five full schema case studies tied to your projects.
- Zero-downtime migrations and backups.

> Schemas are in **PostgreSQL** DDL. The ordering-list algorithm (fractional indexing) is implemented in **runnable JavaScript with tests**.

## Modelling fundamentals

### How do you approach a "design the schema" question? 🔥

A repeatable process, worth saying out loud:

1. **Clarify the domain and scale.**
   - What are the **entities** (nouns) and **actions** (verbs)?
   - How many users, rows per day, and what read/write ratio?
   - Is it multi-tenant?
2. **List the access patterns** before you draw tables:
   - "Show a user's upcoming meetings".
   - "List participants of a live meeting".
   - "Monthly usage report per org".
   These drive indexes, and possibly denormalisation.
3. **Model entities and relationships.** Decide each relationship's **cardinality** (1:1, 1:N, M:N) and **optionality**. M:N always becomes a **junction table**, often with its own attributes (role, joined_at).
4. **Normalise to 3NF by default.** Every fact is stored once. Then denormalise **deliberately** where an access pattern needs it.
5. **Make invariants database-enforced:** NOT NULL, UNIQUE, FK, CHECK, EXCLUDE. The application can't guarantee them under concurrency.
6. **Choose keys and types:**
   - `bigint` identity or UUID v7.
   - `timestamptz`, `numeric` for money, `text` with CHECK constraints.
7. **Add indexes for each access pattern**, composite and in the right column order.
8. **Plan for change and growth:**
   - Partitioning for time-series.
   - Archival and retention.
   - Soft delete and audit history.
   - How a migration would look.

**What interviewers listen for:** asking about access patterns first, naming constraints explicitly, and discussing trade-offs ("I'd normalise this, but snapshot the price on the order line because prices change").

### Explain 1NF, 2NF, 3NF and BCNF with one evolving example 🔥

Start with a spreadsheet-style table of meeting registrations:

| reg_id | meeting_id | meeting_title | host_email | attendee_email | attendee_name | tags |
|---|---|---|---|---|---|---|
| 1 | 10 | React Deep Dive | zaki@x.com | asha@y.com | Asha | react, hooks |
| 2 | 10 | React Deep Dive | zaki@x.com | ravi@y.com | Ravi | react |

**1NF: atomic values, no repeating groups.**

- `tags` holds a list. Move the tags to a separate table: `meeting_tags(meeting_id, tag)`.
- **Violation symptom:** you can't index or constrain individual tags, and `LIKE '%react%'` queries appear.

**2NF: 1NF, plus no partial dependency on part of a composite key.**

- Suppose the key were `(meeting_id, attendee_email)`.
- `meeting_title` depends only on `meeting_id` (part of the key), so move it to `meetings`.
- **Symptom:** renaming a meeting means updating N registration rows (an **update anomaly**).

**3NF: 2NF, plus no transitive dependency (non-key → non-key).**

- `host_email` depends on `meeting_id → host_id → email`. Store `host_id` in `meetings` and the email in `users`.
- `attendee_name` depends on `attendee_email`, not on the registration. Move it to `users` (or an attendees table).
- **Symptom:** a user changes their name and old registrations show stale names (an inconsistency).

**BCNF: every determinant is a candidate key.**

- This is stricter than 3NF and rarely different in practice.
- Classic example: `(student, course, instructor)`, where each instructor teaches exactly one course.
  - `instructor → course` is a dependency.
  - But `instructor` isn't a key of the table.
  - Fix: split into `(instructor, course)` and `(student, instructor)`.

**Normalised result:**

```sql
CREATE TABLE users    (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email citext NOT NULL UNIQUE, name text NOT NULL);
CREATE TABLE meetings (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, host_id bigint NOT NULL REFERENCES users(id), title text NOT NULL);
CREATE TABLE meeting_tags (meeting_id bigint REFERENCES meetings(id) ON DELETE CASCADE, tag text, PRIMARY KEY (meeting_id, tag));
CREATE TABLE registrations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id  bigint NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, user_id)               -- a user registers once per meeting
);
```

**The three anomalies normalisation prevents:**

- **Update anomaly:** one fact changed in many places.
- **Insert anomaly:** you can't store a meeting until someone registers.
- **Delete anomaly:** deleting the last registration loses the meeting's title.

### When should you denormalise, and how do you keep it correct? 🔥

**Denormalise when a measured access pattern needs it** (not "for performance" by default):

| Technique | Example | Keeping it correct |
|---|---|---|
| **Cached aggregates** | `meetings.participant_count`, `posts.comment_count` | Update in the same transaction, a trigger, or recompute periodically. Beware hot-row contention |
| **Duplicated attributes** to avoid joins | `orders.customer_email` for fast search | Accept staleness, or sync via events |
| **Materialised views / summary tables** | Daily usage per org | Refresh on a schedule, or incrementally via CDC |
| **Read models (CQRS)** | A search index or dashboard store built from events | Rebuildable from the source of truth |
| **JSON documents** | API-ready JSON per entity | Regenerate on change |

**Not denormalisation, but correct modelling: historical snapshots.**

- An order line must store the **unit price at purchase time**.
- An invoice must store the **billing address as it was**.
- Joining to the *current* product price would rewrite history.
- Say this explicitly. It shows you understand the difference between **current state** and **facts about the past**.

**The rule:** there's always **one source of truth**. Denormalised copies are derived and rebuildable, and you know their staleness bounds.

### How do you model 1:1, 1:N, M:N and self-referential relationships? 🔥

| Relationship | Model | Example |
|---|---|---|
| **1:N** | FK on the **many** side | `meetings.host_id → users.id` |
| **M:N** | **Junction table** with a composite PK or unique key, plus its own attributes | `meeting_participants(meeting_id, user_id, role, joined_at)` |
| **1:1** | FK on the dependent side **with UNIQUE**, or a shared PK | `user_profiles(user_id PRIMARY KEY REFERENCES users)` for optional or large data |
| **Self-referential** | FK to the same table | `employees.manager_id`, `messages.reply_to_id`, `categories.parent_id` |

**`ON DELETE` choices:**

| Action | Use when |
|---|---|
| `RESTRICT` / `NO ACTION` (default) | The parent must not disappear while children exist (customers with orders) |
| `CASCADE` | Children are part of the parent (meeting → its tags, order → its items) |
| `SET NULL` | The child survives without the parent (a message's `reply_to_id` when the original is deleted) |
| `SET DEFAULT` | Rare |

**Index your foreign keys.** Postgres doesn't do it automatically. Without the index:

- **Every parent delete scans the child table.**
- Joins from parent to children are slow.
- Lock contention increases (MySQL InnoDB requires FK indexes and creates them).

### Natural vs surrogate keys, composite keys, and IDs in public URLs 🔥

| Key style | Example | Pros | Cons |
|---|---|---|---|
| **Natural** | `email`, `sku`, ISO country code | Meaningful; prevents duplicates | **Values change** (emails, SKUs), and changes cascade everywhere; often wide |
| **Surrogate** | `bigint` identity, UUID | Stable, compact, meaningless | Needs a **separate UNIQUE constraint** on the natural key to prevent duplicates |
| **Composite** | `(meeting_id, user_id)` on a junction table | Natural for junction tables; enforces uniqueness | Wide FKs if other tables reference it |

**Default:** a surrogate PK **plus** UNIQUE constraints on natural keys. Junction tables use the composite PK.

**Public identifiers:**

- **Sequential IDs in URLs** (`/meetings/1043`) leak volume ("they have about 1,000 meetings"). They also invite **enumeration attacks**, which is IDOR when authorisation is weak.
- **Options:**
  - Expose a separate random `public_id` (UUID or a short NanoID/Hashid) and keep the internal `bigint` PK.
  - Use **UUID v7** throughout: time-ordered, so it's index-friendly, and not guessable enough to enumerate. It does encode the creation time.
- **Meeting room names** (like Jitsi's) are public identifiers too. Make them unguessable, or protect them with JWT auth.

**ID generation options:**

| Option | Size | Ordered? | Notes |
|---|---|---|---|
| `bigint` identity | 8 B | Yes | Simplest; one database must generate it |
| UUID v4 | 16 B | No | Random: poor index locality |
| **UUID v7** | 16 B | **Yes (time)** | Native `uuidv7()` in PostgreSQL 18; libraries elsewhere |
| ULID | 16 B (26-char string) | Yes | Lexicographically sortable string |
| Snowflake (Twitter/Discord) | 8 B | Yes | timestamp + machine id + sequence; needs worker-id coordination |

### Which data types should you use for money, time, text, enums and flags? 🔥

| Data | Use | Avoid | Why |
|---|---|---|---|
| **Money** | `numeric(19,4)`, or **integer minor units** (`bigint` paise/cents) plus a `currency` column | `float`/`double`, Postgres `money` | Floats can't represent 0.1 exactly. `money` is locale-dependent |
| **Instants** (when something happened) | **`timestamptz`** | `timestamp` (without time zone) | `timestamptz` stores a UTC instant and converts on display. A plain `timestamp` is ambiguous |
| **Local wall-clock times** (store opens at 09:00, a recurring meeting at 10:00 IST) | `time` / `timestamp` **plus an IANA zone** (`Asia/Kolkata`) | Storing only UTC for future local events | DST and zone rule changes. See the time-zone question |
| **Text** | `text`, with a `CHECK (char_length(x) <= 200)` if a limit matters | `varchar(255)` by habit | No performance difference in Postgres; a CHECK is easier to change |
| **Case-insensitive identity** | `citext`, or a `lower(email)` unique index | Plain `text` + UNIQUE | Stops `Zaki@x.com` and `zaki@x.com` both registering |
| **Enumerations** | `text` + **CHECK**, or a **lookup table** with an FK | Native `ENUM` if values change often | Values can't easily be removed from a native ENUM; a lookup table can hold labels and order |
| **Flags vs status** | A `status` column with a CHECK for lifecycles | Several booleans (`is_paid`, `is_shipped`, `is_cancelled`) | Booleans allow impossible combinations |
| **Semi-structured** | `jsonb` | `json` (unless you must preserve text) | Indexable, deduplicated |
| **IP addresses, ranges** | `inet`, `cidr`, `tstzrange` | text | Validation, operators, indexes |
| **UUID** | `uuid` | `text`/`varchar(36)` | 16 bytes vs 37+, faster comparisons |

### Which constraints should you use, and what are deferrable constraints?

**Constraints are executable documentation, and the last line of defence:**

```sql
CREATE TABLE webinar_registrations (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id    bigint NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  status        text   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','attended')),
  approved_at   timestamptz,
  join_token    uuid   NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  UNIQUE (meeting_id, email),
  CHECK ((status = 'approved') = (approved_at IS NOT NULL) OR status IN ('attended','rejected'))   -- cross-column rule
);
```

**Deferrable constraints** are checked at **COMMIT** instead of per statement. You need them for:

- **Circular FKs:** `departments.head_id → employees` and `employees.dept_id → departments`. Insert both rows, then commit.
- **Swapping unique values:** reordering `position` values that must be unique.

```sql
ALTER TABLE playlist_items ADD CONSTRAINT uq_position UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE;
BEGIN;
SET CONSTRAINTS uq_position DEFERRED;
UPDATE playlist_items SET position = position + 1 WHERE playlist_id = 1 AND position >= 3;   -- temporary duplicates are fine
COMMIT;                                                                                       -- checked here
```

## Common modelling patterns

### How do you store trees and hierarchies? Compare the four approaches 🔥

| Approach | Structure | Read subtree | Move subtree | Best for |
|---|---|---|---|---|
| **Adjacency list** | `parent_id` FK | **Recursive CTE** | Update one row | Default choice: simple and normalised. Fine for depths under ~10 and moderate size |
| **Materialised path** | `path = '1/4/9/'`, or Postgres **`ltree`** `'electronics.audio.mics'` | `path <@ 'electronics.audio'` (GiST index), or `LIKE '1/4/%'` | Rewrite the paths of every descendant | Read-heavy categories, breadcrumbs |
| **Nested sets** | `lft`, `rgt` numbers | `WHERE lft BETWEEN p.lft AND p.rgt` | **Renumber half the tree** | Rarely changing trees with heavy subtree reads (legacy) |
| **Closure table** | `(ancestor, descendant, depth)` with all pairs | A simple join | Delete and insert the path rows | Frequent subtree and ancestor queries, any depth; costs O(n·depth) rows |

```sql
-- Closure table: every ancestor/descendant pair, including self (depth 0)
CREATE TABLE category_paths (
  ancestor_id   bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  descendant_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  depth         int    NOT NULL,
  PRIMARY KEY (ancestor_id, descendant_id)
);
-- All descendants of category 4
SELECT c.* FROM categories c JOIN category_paths p ON p.descendant_id = c.id WHERE p.ancestor_id = 4 AND p.depth > 0;
-- Insert a new leaf 12 under parent 9: copy the parent's ancestor rows, plus the self row
INSERT INTO category_paths (ancestor_id, descendant_id, depth)
SELECT ancestor_id, 12, depth + 1 FROM category_paths WHERE descendant_id = 9
UNION ALL SELECT 12, 12, 0;
```

**Practical answer:** "Adjacency list plus recursive CTEs first. If subtree reads dominate and the tree is big, switch to `ltree` or a closure table."

**Use cases from your work:**

- Threaded chat replies.
- Organisation units for RBAC.
- Folder structures for documents (SCAI).
- Annotation layers.

### How do you model polymorphic associations (comments on posts, videos or meetings)? 🔥

**Requirement:** a `comments` (or `attachments`, `reactions`) table that can belong to several parent types.

| Option | Schema | Integrity | Notes |
|---|---|---|---|
| **1. Exclusive FK columns** | `post_id`, `video_id`, `meeting_id` (nullable FKs) + `CHECK (num_nonnulls(post_id, video_id, meeting_id) = 1)` | ✅ **Real FKs** | Simple and safe; a new column per new type |
| **2. Separate tables per parent** | `post_comments`, `meeting_comments` | ✅ | Cleanest integrity; duplicated structure; UNION for "all comments" |
| **3. Shared supertype** | `commentables(id)`; posts, videos and meetings each have a `commentable_id` FK; comments reference `commentables` | ✅ | Classic "class table inheritance"; an extra join |
| **4. Type + id** (Rails/Laravel "polymorphic") | `commentable_type text`, `commentable_id bigint` | ❌ **No FK possible** | Popular in ORMs, but orphans happen. Needs triggers or app checks |

```sql
CREATE TABLE comments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  author_id   bigint NOT NULL REFERENCES users(id),
  body        text   NOT NULL,
  post_id     bigint REFERENCES posts(id)    ON DELETE CASCADE,
  video_id    bigint REFERENCES videos(id)   ON DELETE CASCADE,
  meeting_id  bigint REFERENCES meetings(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exactly_one_parent CHECK (num_nonnulls(post_id, video_id, meeting_id) = 1)
);
CREATE INDEX ON comments (post_id)    WHERE post_id IS NOT NULL;     -- partial indexes stay small
CREATE INDEX ON comments (video_id)   WHERE video_id IS NOT NULL;
CREATE INDEX ON comments (meeting_id) WHERE meeting_id IS NOT NULL;
```

### How do you store user-defined custom fields? EAV vs JSONB vs columns

**The scenario:** each tenant defines custom fields on documents or contacts (SCAI-style extracted fields, CRM attributes).

| Option | Pros | Cons |
|---|---|---|
| **EAV** (`entity_id, attribute_id, value text`) | Fully dynamic; one generic schema | Every value is text (no types or constraints); reassembling a record takes N joins or a pivot; query nightmare at scale |
| **JSONB column** `custom_fields jsonb` | One row per entity, flexible, **GIN-indexable** containment, expression indexes for hot keys | Types are validated in the app or with JSON Schema checks; huge documents are rewritten on every update |
| **Typed EAV** (`value_text`, `value_num`, `value_date` columns + `field_definitions`) | Typed and sortable | Still complex queries |
| **Real columns via migrations** | Fastest, typed, constrained | Requires DDL per field. Fine for a few, admin-managed fields |

**A good modern answer:**

- Use **JSONB for custom fields**, plus a `field_definitions` table that describes each tenant's fields (type, label, required, options).
- Validate in the application.
- Add expression indexes for the few fields that are heavily filtered.

### Soft delete vs hard delete vs archiving: what are the trade-offs? 🔥

**Soft delete** (`deleted_at timestamptz`) keeps the row and hides it.

**Pros:**

- Undo and restore.
- Audit and history.
- Referential integrity stays intact (old orders still point to the "deleted" product).

**Cons:**

- **Every query must filter `deleted_at IS NULL`.** Forgetting it leaks data. Mitigate with:
  - Views.
  - ORM global scopes (Prisma middleware/extensions, Hibernate `@SQLRestriction`, Django managers).
  - Row-level security.
- **Unique constraints break:** a deleted user's email blocks re-registration. **Fix: a partial unique index:**

  ```sql
  CREATE UNIQUE INDEX users_email_live_uq ON users (lower(email)) WHERE deleted_at IS NULL;
  ```
- The table and its indexes keep growing. Use partial indexes `WHERE deleted_at IS NULL` for the hot paths.
- **Privacy law conflicts:** GDPR, and India's **DPDP Act 2023**, give a right to erasure. Soft-deleted PII still exists. You need real deletion or anonymisation (scrubbing PII columns) within the required time.

**Alternatives:**

- **Archive table:** move deleted rows to `users_archive` (data-modifying CTE) and keep the live table clean.
- **Event or audit log** for history, with a hard delete in the main table.
- **Status-based lifecycles** (`status = 'cancelled'`) for business states. "Cancelled order" isn't a deletion.

### How do you keep an audit trail or history of changes?

| Approach | How | Use |
|---|---|---|
| **Audit log table via trigger** | A generic `audit_log(table, op, old jsonb, new jsonb, actor, at)` | Compliance and "who changed what". See the trigger in [SQL Mastery](/docs/sql-mastery) |
| **History table per entity** | `prices_history(product_id, price, valid_from, valid_to)` | Point-in-time queries ("price on 1 Sept") |
| **SCD Type 2** (slowly changing dimension) | A new row per version with `valid_during tstzrange` + `is_current` | Analytics and data warehousing |
| **Event sourcing** | Store events as the source of truth; derive state | Ledgers, complex domains that need full replay. High complexity |
| **CDC to a lake** | Debezium → Kafka → S3 | Org-wide history without touching app code |

**Passing the actor to a trigger:** set `SET LOCAL app.user_id = '42'` per request, and read `current_setting('app.user_id', true)` inside the trigger.

**Temporal tables** (`SYSTEM VERSIONING`) are built into SQL Server and MariaDB. Postgres needs triggers or an extension. Postgres 18 adds temporal **constraints** (`WITHOUT OVERLAPS`), not system versioning.

### Multi-tenancy: shared tables, schema per tenant, or database per tenant? 🔥

| Model | Isolation | Cost and operations | Best for |
|---|---|---|---|
| **Shared tables + `tenant_id`** | Logical. **One missed WHERE leaks data** unless RLS is used | Cheapest; one migration path; easy cross-tenant analytics | SaaS with many small tenants (the default) |
| **Schema per tenant** | Better; `search_path` per tenant | Migrations × N schemas; catalog bloat beyond a few thousand schemas | Hundreds of mid-size tenants |
| **Database (or cluster) per tenant** | Strongest; per-tenant backup/restore, residency, noisy-neighbour isolation | Most expensive; fleet management | Enterprise or regulated tenants, data residency |

**Hybrid is common:** shared tables for most tenants, with dedicated databases for large or regulated ones.

**Row-level security** makes the shared model safe:

```sql
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;          -- apply even to the table owner

CREATE POLICY tenant_isolation ON documents
  USING      (tenant_id = current_setting('app.tenant_id')::bigint)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::bigint);

-- Per request, inside the transaction (SET LOCAL: safe with PgBouncer transaction pooling)
BEGIN;
SET LOCAL app.tenant_id = '42';
SELECT * FROM documents WHERE id = $1;                   -- other tenants' rows are invisible
COMMIT;
```

**Also:**

- **Lead every index with `tenant_id`**, for example `(tenant_id, created_at)`. Every query is tenant-scoped, and later sharding by tenant becomes easy (Citus).
- Superusers and roles with `BYPASSRLS` skip the policies. The app must connect as a normal role.

### How do you model a status lifecycle, or state machine?

```sql
CREATE TABLE loads (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status     text NOT NULL DEFAULT 'posted'
             CHECK (status IN ('posted','booked','in_transit','delivered','cancelled')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  version    int NOT NULL DEFAULT 1
);

-- Allowed transitions as data (or enforce them in code)
CREATE TABLE load_status_transitions (from_status text, to_status text, PRIMARY KEY (from_status, to_status));
INSERT INTO load_status_transitions VALUES
  ('posted','booked'), ('posted','cancelled'), ('booked','in_transit'), ('booked','cancelled'), ('in_transit','delivered');

-- History of every transition (the audit + analytics: "average time from booked to delivered")
CREATE TABLE load_status_history (
  load_id bigint REFERENCES loads(id) ON DELETE CASCADE,
  from_status text, to_status text, changed_by bigint, changed_at timestamptz DEFAULT now()
);

-- Transition atomically and race-safely: only move if still in the expected state
UPDATE loads SET status = 'in_transit', status_changed_at = now(), version = version + 1
WHERE id = $1 AND status = 'booked'
RETURNING id;                                     -- 0 rows → invalid or concurrent transition
```

**Principles:**

- **One status column**, not a set of booleans.
- **Conditional transitions:** `WHERE status = expected` gives optimistic, race-safe moves.
- **A history table** for analytics.
- **Explicit transitions:** code with a state-machine library (XState on the frontend, Spring Statemachine), or a transitions table.

### Design a ledger for money movements (double-entry) 🔥

**Never store just `balance` and mutate it.** You lose the audit trail, and concurrency bugs silently corrupt the money. Use an **append-only ledger**:

```sql
CREATE TABLE ledger_accounts (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id  bigint,
  kind      text NOT NULL CHECK (kind IN ('user_wallet','platform_revenue','payment_gateway','refunds')),
  currency  char(3) NOT NULL
);

CREATE TABLE journal_entries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  description     text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,              -- the same business event can't be booked twice
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE postings (
  entry_id    bigint NOT NULL REFERENCES journal_entries(id),
  account_id  bigint NOT NULL REFERENCES ledger_accounts(id),
  amount      bigint NOT NULL CHECK (amount <> 0),   -- minor units; + debit, − credit
  PRIMARY KEY (entry_id, account_id)
);
-- Invariant: postings of every entry sum to zero (enforce in the same transaction, or with a deferred constraint trigger)

-- A webinar ticket purchase of ₹499.00: gateway (asset) +49900, platform revenue −49900
-- Balance of an account = SUM(amount); keep periodic balance snapshots for speed
SELECT account_id, SUM(amount) AS balance FROM postings WHERE account_id = $1 GROUP BY account_id;
```

**Properties:**

- **Immutable:** corrections are **new reversing entries**, never UPDATEs.
- **Every movement is balanced**, so money is never created or destroyed.
- **Idempotent** per business event.
- **Auditable:** any balance at any time can be recomputed.

### How do you store times for scheduling across time zones? 🔥

This is very relevant to a meeting platform: hosts in IST and attendees in the US and EU.

**Two kinds of time:**

| Kind | Example | Store as |
|---|---|---|
| **An instant** (it happened at, or must happen at, an absolute moment) | A one-off meeting at a fixed moment; `created_at`; recording start | **`timestamptz`** (a UTC instant) |
| **A local, civil time with rules** | "Every Monday at 10:00 **New York time**", "office hours 09:00–18:00 local" | **Local time + IANA zone + recurrence rule** (`RRULE`) |

**Why not just UTC for recurring meetings?**

- **DST.** 10:00 New York is 14:00 UTC in summer and 15:00 UTC in winter. A recurring series stored as "14:00 UTC every Monday" drifts by an hour twice a year.
- **Time zone rules change.** Governments change DST rules, and the IANA database is updated. Future instants computed today can become wrong. Store the **intent** (local time + zone) and compute occurrences.

```sql
CREATE TABLE meeting_series (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  host_id      bigint NOT NULL REFERENCES users(id),
  title        text NOT NULL,
  local_start  time NOT NULL,                 -- 10:00
  duration     interval NOT NULL,             -- 01:00:00
  time_zone    text NOT NULL,                 -- 'America/New_York' (IANA name, never 'EST' or '+05:30')
  rrule        text NOT NULL,                 -- 'FREQ=WEEKLY;BYDAY=MO;COUNT=10' (RFC 5545)
  starts_on    date NOT NULL
);
-- Materialised occurrences (generated ahead of time) are instants: easy to query "what's on today?"
CREATE TABLE meeting_occurrences (
  series_id  bigint REFERENCES meeting_series(id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  is_exception boolean NOT NULL DEFAULT false,   -- moved or cancelled single occurrences
  PRIMARY KEY (series_id, starts_at)
);

-- Converting for display: the instant shown in a user's zone
SELECT starts_at AT TIME ZONE 'Asia/Kolkata' AS local_ist FROM meeting_occurrences WHERE series_id = 1;
```

**Rules:**

- Use **IANA names**, never abbreviations (IST is both India and Israel/Irish Standard Time) or fixed offsets.
- Keep the **database session time zone as UTC**.
- **Convert at the edges:** the browser uses `Intl.DateTimeFormat` with the user's zone.
- **Day-boundary reports** ("meetings per day") must specify *whose* day.

### How do you store user-ordered lists (drag-and-drop) efficiently? 🔥

This covers Kanban columns, playlist order, slide order and agenda items.

| Approach | Reorder cost | Notes |
|---|---|---|
| Integer `position` (1, 2, 3, …) | Moving an item **renumbers many rows** | Simple; fine for short lists; use a deferrable unique constraint |
| Gapped integers (1000, 2000, …) | Insert between 1000 and 2000 → 1500, until the gaps run out, then rebalance | Easy; occasional rebalance |
| Floats (midpoint) | One row update | **Precision runs out** after ~50 repeated insertions at the same spot |
| **Fractional indexing (string keys)** | **One row update, never exhausted** | Used by Figma, Linear, and Jira's LexoRank. Keys compare as strings: `ORDER BY sort_key` |

Fractional indexing generates a string strictly between two neighbours. Strings can always grow longer, so you can always insert:

```js
// Fractional indexing: a key strictly between a and b (base-26 digits a..z; '' = start, null = end)
const DIGITS = 'abcdefghijklmnopqrstuvwxyz';
function keyBetween(a = '', b = null) {
  if (b !== null && !(a < b)) throw new Error(`need a < b, got ${a} / ${b}`);
  let prefix = '';
  for (let i = 0; ; i++) {
    const da = i < a.length ? DIGITS.indexOf(a[i]) : 0;
    const db = b === null ? DIGITS.length : i < b.length ? DIGITS.indexOf(b[i]) : 0;
    if (da === db) { prefix += DIGITS[da]; continue; }          // shared prefix
    const mid = Math.floor((da + db) / 2);
    if (mid > da) return prefix + DIGITS[mid];                  // room at this digit
    prefix += DIGITS[da];                                       // adjacent digits: go one level deeper,
    b = null;                                                   // now only bounded below by the rest of a
  }
}

// Floats run out of precision when you keep inserting at the same spot
function floatInsertionsUntilCollision() {
  let lo = 1, hi = 2, n = 0;
  while (true) { const mid = (lo + hi) / 2; if (mid === lo || mid === hi) return n; hi = mid; n++; }
}

// Simulate a drag-and-drop list: always insert right after the first item (the worst case)
let keys = [keyBetween(), ];
keys.push(keyBetween(keys[0]));
for (let i = 0; i < 200; i++) keys.splice(1, 0, keyBetween(keys[0], keys[1]));
console.log('first keys:', keys.slice(0, 4), '… longest key length:', Math.max(...keys.map((k) => k.length)));
console.log('float insertions before precision runs out:', floatInsertionsUntilCollision());

test('keyBetween is strictly between its neighbours', () => {
  expect(keyBetween()).toBe('n');
  expect(keyBetween('n')).toBe('t');
  expect(keyBetween('', 'n')).toBe('g');
  const k = keyBetween('n', 'o');
  expect('n' < k && k < 'o').toBe(true);
});
test('200 inserts at the same position keep keys unique and sorted', () => {
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys.slice().sort()).toEqual(keys);
});
test('floats only survive ~52 repeated midpoint inserts', () => {
  expect(floatInsertionsUntilCollision()).toBeLessThanOrEqual(53);
});
```

**For collaborative editing** (two users reordering at once), fractional keys can collide when both users generate the same key. Add a tiebreaker (the item id) to `ORDER BY`, or use a jittered or client-unique suffix.

## Schema case studies

### Design the schema for a video-conferencing and webinar platform (MeetHour-style) 🔥

**Requirements to confirm:**

- Organisations and users with roles.
- Scheduled and recurring meetings.
- Instant rooms.
- Webinars with registration, visitors and backstage.
- Participants' join/leave sessions.
- Recordings (Jibri) and live streams.
- In-meeting chat.

Present it as **one way you'd model it**, not as MeetHour's actual schema.

```sql
CREATE TABLE organizations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL, plan text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email citext NOT NULL UNIQUE, name text NOT NULL, time_zone text NOT NULL DEFAULT 'Asia/Kolkata'
);

CREATE TABLE org_members (
  org_id bigint REFERENCES organizations(id) ON DELETE CASCADE,
  user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','admin','member')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE meetings (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id     text NOT NULL UNIQUE,                       -- unguessable room id used in URLs and XMPP MUC names
  org_id        bigint NOT NULL REFERENCES organizations(id),
  host_id       bigint NOT NULL REFERENCES users(id),
  kind          text NOT NULL CHECK (kind IN ('meeting','webinar')),
  title         text NOT NULL,
  series_id     bigint REFERENCES meeting_series(id),       -- recurring meetings (see the time-zone question)
  scheduled_start timestamptz,                              -- NULL for instant meetings
  scheduled_end   timestamptz,
  settings      jsonb NOT NULL DEFAULT '{}',                -- lobby, e2ee, auto-record, visitors enabled…
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','live','ended','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (scheduled_end IS NULL OR scheduled_end > scheduled_start)
);
CREATE INDEX meetings_org_start ON meetings (org_id, scheduled_start);
CREATE INDEX meetings_host_start ON meetings (host_id, scheduled_start);

-- Who is (or was) in the room: one row per join session (people drop and rejoin)
CREATE TABLE participant_sessions (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id  bigint NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id),                   -- NULL for guests
  display_name text NOT NULL,
  role        text NOT NULL CHECK (role IN ('host','cohost','presenter','participant','visitor')),
  joined_at   timestamptz NOT NULL,
  left_at     timestamptz,
  client      jsonb                                          -- browser/electron/mobile, version, region
);
CREATE INDEX ON participant_sessions (meeting_id, joined_at);
CREATE INDEX ON participant_sessions (meeting_id) WHERE left_at IS NULL;   -- "who is in the room now"

CREATE TABLE webinar_registrations (
  meeting_id bigint REFERENCES meetings(id) ON DELETE CASCADE,
  email citext NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  join_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, email)
);

CREATE TABLE recordings (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id    bigint NOT NULL REFERENCES meetings(id),
  started_by    bigint REFERENCES users(id),
  recorder_node text,                                       -- which Jibri instance handled it
  status        text NOT NULL CHECK (status IN ('starting','recording','uploading','ready','failed')),
  storage_key   text,                                       -- S3 object key
  duration_s    int,
  size_bytes    bigint,
  started_at    timestamptz NOT NULL DEFAULT now(),
  ended_at      timestamptz
);
CREATE INDEX ON recordings (meeting_id, started_at DESC);

CREATE TABLE live_streams (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  meeting_id    bigint NOT NULL REFERENCES meetings(id),
  platform      text NOT NULL CHECK (platform IN ('youtube','facebook','rtmp')),
  rtmp_url      text NOT NULL,
  stream_key_encrypted bytea NOT NULL,                      -- secrets encrypted at the application level (KMS)
  status        text NOT NULL,
  started_at    timestamptz, ended_at timestamptz
);

CREATE TABLE chat_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY,
  meeting_id  bigint NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  sender_session_id bigint REFERENCES participant_sessions(id),
  body        text NOT NULL,
  is_private_to bigint REFERENCES participant_sessions(id),
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, sent_at)                                 -- a partitioned table's PK must include the partition key
) PARTITION BY RANGE (sent_at);                             -- high volume, retention by month
```

**Talking points:**

- **Join sessions, not just participants:** this is what enables attendance reports and duration billing.
- **Partial index for live presence.**
- **The recording state machine:** multiple concurrent Jibri recordings means multiple rows per meeting.
- **Stream keys encrypted at the application level.**
- **Partitioned chat** for retention.
- **Live presence is ephemeral.** The source of truth for "who's in the room right now" is **Prosody/XMPP**. The database records sessions for analytics.

### Design an e-commerce order schema that preserves history 🔥

```sql
CREATE TABLE orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id      bigint NOT NULL REFERENCES customers(id),
  status           text NOT NULL CHECK (status IN ('pending','paid','shipped','delivered','cancelled','refunded')),
  currency         char(3) NOT NULL,
  subtotal         bigint NOT NULL,                -- minor units
  tax              bigint NOT NULL,
  shipping         bigint NOT NULL,
  total            bigint GENERATED ALWAYS AS (subtotal + tax + shipping) STORED,
  shipping_address jsonb NOT NULL,                 -- a SNAPSHOT: the address as it was at purchase
  idempotency_key  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  order_id    bigint REFERENCES orders(id) ON DELETE CASCADE,
  line_no     int,
  product_id  bigint NOT NULL REFERENCES products(id),
  product_name text NOT NULL,                      -- snapshot for invoices
  unit_price  bigint NOT NULL,                     -- snapshot: price at purchase time
  qty         int NOT NULL CHECK (qty > 0),
  PRIMARY KEY (order_id, line_no)
);

CREATE TABLE payments (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id      bigint NOT NULL REFERENCES orders(id),
  provider      text NOT NULL,                     -- razorpay, stripe
  provider_ref  text NOT NULL,                     -- the provider's payment id
  amount        bigint NOT NULL,
  status        text NOT NULL CHECK (status IN ('authorized','captured','failed','refunded')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)                  -- webhook retries can't create duplicates
);

CREATE TABLE inventory (
  product_id bigint PRIMARY KEY REFERENCES products(id),
  available  int NOT NULL CHECK (available >= 0),
  reserved   int NOT NULL DEFAULT 0 CHECK (reserved >= 0)
);
```

**Key points:**

- **Snapshots** of price, name and address.
- **Money in minor units.**
- **A generated column** for the total.
- **Idempotency keys**, plus a unique `(provider, provider_ref)` for webhooks.
- **A non-negative CHECK** as the overselling backstop.
- **One order → many payments**, for retries and partial captures.

### Design a chat or messaging schema with unread counts 🔥

```sql
CREATE TABLE conversations (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind       text NOT NULL CHECK (kind IN ('direct','group')),
  direct_key text UNIQUE,                    -- 'min(userA,userB):max(userA,userB)' → at most one DM per pair
  title      text,
  last_message_at timestamptz                -- denormalised for "sort my inbox"
);

CREATE TABLE conversation_members (
  conversation_id bigint REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         bigint REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL DEFAULT 'member',
  last_read_message_id bigint NOT NULL DEFAULT 0,   -- ONE cursor per member, not a row per message per reader
  muted_until     timestamptz,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX ON conversation_members (user_id);

CREATE TABLE messages (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- monotonic: usable as a cursor
  conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       bigint NOT NULL REFERENCES users(id),
  body            text,
  reply_to_id     bigint REFERENCES messages(id) ON DELETE SET NULL,
  client_msg_id   uuid NOT NULL,                  -- idempotent sends from flaky mobile networks
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  deleted_at      timestamptz,
  UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX messages_conv_id_desc ON messages (conversation_id, id DESC);   -- history pagination

-- Unread count for every conversation of a user
SELECT cm.conversation_id,
       (SELECT COUNT(*) FROM messages m
        WHERE m.conversation_id = cm.conversation_id AND m.id > cm.last_read_message_id AND m.sender_id <> cm.user_id) AS unread
FROM conversation_members cm
WHERE cm.user_id = $1;
```

**Design choices to explain:**

- **A read cursor per member** (O(members)), instead of per-message read receipts (O(messages × members)).
- **`client_msg_id`** makes sends idempotent.
- **Keyset pagination** on `(conversation_id, id)`.
- **Denormalised `last_message_at`** for inbox ordering.
- **At massive scale**, messages move to a wide-column store (Cassandra or ScyllaDB, partitioned by conversation and time bucket), which is what Discord did.

### Design a role-based access control (RBAC) schema 🔥

```sql
CREATE TABLE permissions (key text PRIMARY KEY);                 -- 'meeting.create', 'recording.download', 'org.billing'
CREATE TABLE roles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id bigint REFERENCES organizations(id),                    -- NULL = built-in system role
  name text NOT NULL,
  UNIQUE (org_id, name)
);
CREATE TABLE role_permissions (
  role_id bigint REFERENCES roles(id) ON DELETE CASCADE,
  permission_key text REFERENCES permissions(key),
  PRIMARY KEY (role_id, permission_key)
);
CREATE TABLE memberships (                                       -- a user's role within an org (scope)
  user_id bigint REFERENCES users(id) ON DELETE CASCADE,
  org_id  bigint REFERENCES organizations(id) ON DELETE CASCADE,
  role_id bigint NOT NULL REFERENCES roles(id),
  PRIMARY KEY (user_id, org_id)
);

-- Can user 7 download recordings in org 3?
SELECT EXISTS (
  SELECT 1 FROM memberships m
  JOIN role_permissions rp ON rp.role_id = m.role_id
  WHERE m.user_id = 7 AND m.org_id = 3 AND rp.permission_key = 'recording.download'
);
```

**Extensions and trade-offs:**

- **Resource-level grants:** `meeting_grants(meeting_id, user_id, permission)` for "co-host of this meeting only".
- **ABAC (attribute-based)** for rules like "same department and business hours". Use a policy engine (OPA/Cedar).
- **Caching permissions in the JWT:**
  - Pros: no DB lookup per request.
  - Cons: stale until the token expires, and token bloat. Short-lived tokens, or cache in Redis with invalidation on role change.
- **SSO mapping:** with Azure AD (scQuill), map **group or app-role claims** from the ID token to internal roles at login.

### Design a load board or logistics schema (LoadOTR-style)

```sql
CREATE TABLE companies (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, kind text CHECK (kind IN ('shipper','carrier','broker')), name text NOT NULL, mc_number text UNIQUE);

CREATE TABLE loads (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shipper_id     bigint NOT NULL REFERENCES companies(id),
  equipment      text NOT NULL CHECK (equipment IN ('dry_van','reefer','flatbed')),
  weight_kg      int CHECK (weight_kg > 0),
  rate_cents     bigint,
  pickup_window  tstzrange NOT NULL,
  status         text NOT NULL DEFAULT 'posted',
  assigned_carrier_id bigint REFERENCES companies(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX loads_open_by_pickup ON loads USING gist (pickup_window) WHERE status = 'posted';

CREATE TABLE load_stops (
  load_id  bigint REFERENCES loads(id) ON DELETE CASCADE,
  seq      int NOT NULL,
  kind     text NOT NULL CHECK (kind IN ('pickup','dropoff')),
  address  jsonb NOT NULL,
  location point,                                  -- or PostGIS geography(Point) for radius search
  appointment tstzrange,
  PRIMARY KEY (load_id, seq)
);

CREATE TABLE bids (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  load_id    bigint NOT NULL REFERENCES loads(id) ON DELETE CASCADE,
  carrier_id bigint NOT NULL REFERENCES companies(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  status     text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (load_id, carrier_id)                     -- one active bid per carrier (update it to change the amount)
);

CREATE TABLE tracking_pings (                       -- time-series: partition by month, BRIN on recorded_at
  load_id bigint NOT NULL, recorded_at timestamptz NOT NULL, lat double precision, lng double precision
) PARTITION BY RANGE (recorded_at);
```

**Talking points:**

- **Range types for time windows**, with GiST indexes.
- **Geospatial search** with PostGIS: "loads within 100 km of me".
- **Tracking pings as partitioned time-series.**
- **Bid acceptance as a conditional transition:**

  ```sql
  UPDATE loads SET status = 'booked', assigned_carrier_id = $2 WHERE id = $1 AND status = 'posted';
  ```

*[Replace these with what LoadOTR actually stored, if you know the real schema.]*

## Migrations & evolution

### How do you make a schema change with zero downtime? (expand and contract) 🔥

**The constraint:** during a rolling deploy, **old and new application versions run at the same time**. So every schema change must be compatible with **both**.

**Expand/contract**, for example to rename `users.name` to `users.full_name`:

| Step | Schema | Application |
|---|---|---|
| 1. **Expand** | `ADD COLUMN full_name text` (nullable: instant) | — |
| 2. Dual write | — | Deploy v2: **write both** `name` and `full_name`; read `name` |
| 3. **Backfill** | `UPDATE users SET full_name = name WHERE full_name IS NULL` **in batches** | — |
| 4. Switch reads | — | Deploy v3: read `full_name`, still write both |
| 5. Stop the old writes | — | Deploy v4: only `full_name` |
| 6. **Contract** | Add NOT NULL safely (CHECK … NOT VALID → VALIDATE → SET NOT NULL), then `DROP COLUMN name` | — |

**Rules for every migration:**

- **Additive changes are safe:** new tables, nullable columns, constant defaults, indexes built `CONCURRENTLY`.
- **Destructive changes go last:** drop, rename, type change, NOT NULL. Only once no running code depends on the old shape.
- **Never rename in one step.** Old pods querying the old column name start failing immediately.
- **Set `lock_timeout`** and retry. Avoid long `ACCESS EXCLUSIVE` locks (see [Transactions & Locking](/docs/db-transactions-locking)).
- **Separate the migration from the deploy:** run migrations as a pipeline step before the new version rolls out.
- **Feature flags** decouple deploy from release.

### Your `int` primary key is about to overflow. What do you do? 🔥

A real-world incident class: an `int`/`serial` PK maxes out at **2,147,483,647**. Inserts then fail with "integer out of range".

**Monitor it:**

```sql
SELECT sequencename, last_value, round(100.0 * last_value / 2147483647, 1) AS pct_of_int_max
FROM pg_sequences WHERE data_type = 'integer' ORDER BY last_value DESC NULLS LAST;
```

**The naive fix is `ALTER TABLE t ALTER COLUMN id TYPE bigint`.** It **rewrites the whole table and all its indexes** under an `ACCESS EXCLUSIVE` lock: hours of downtime for a big table. FKs in other tables need the same change.

**The online approach:**

1. Add `id_new bigint`. Add a **trigger** that copies `id` into `id_new` on insert and update.
2. **Backfill** `id_new` in batches.
3. `CREATE UNIQUE INDEX CONCURRENTLY t_id_new_uq ON t (id_new)`.
4. Do the same for referencing FK columns, using `NOT VALID` constraints plus `VALIDATE`.
5. In one short transaction:
   - Drop the old PK.
   - `ALTER TABLE t ADD CONSTRAINT t_pkey PRIMARY KEY USING INDEX t_id_new_uq`.
   - Swap the column names.
   - Point the sequence at the new column and alter the sequence to `bigint`.
6. Drop the old column later.

**Prevention:** use **`bigint` for every PK and FK by default**. The 4 extra bytes are irrelevant next to a future migration.

### Which migration tools have you used, and what practices matter? 🔥

| Ecosystem | Tools |
|---|---|
| Java/Kotlin | **Flyway** (versioned SQL: `V3__add_recordings.sql`), **Liquibase** (XML/YAML/SQL changelogs, rollbacks) |
| Node.js | **Prisma Migrate**, Knex migrations, TypeORM migrations, Drizzle Kit, node-pg-migrate |
| Python | **Alembic** (SQLAlchemy, autogenerate), **Django migrations** (`makemigrations` / `migrate`) |
| Declarative | **Atlas**, Prisma's schema diffing, Skeema (MySQL): you describe the desired state and the tool plans the diff |

**Practices:**

- **Migrations are code:** in git, reviewed, run in CI against a production-like database. Tools like `squawk` lint Postgres migrations for dangerous locks.
- **Never edit a migration that has already run** in a shared environment. Add a new one. Checksums (Flyway) catch edits.
- **Forward-only in production.** "Down" migrations are rarely safe once data has been written. Roll back by **deploying a fix forward**, which is what expand/contract makes possible.
- **Review generated SQL.** ORMs happily generate a table-rewriting `ALTER` or a non-concurrent index.
- **Separate the schema change from the data backfill**, and make backfills **idempotent, batched, throttled, and resumable**: track the last processed id, and watch replication lag.
- **One migration runner at a time.** Most tools take an advisory lock. Don't run migrations from every pod on startup in Kubernetes without that lock.

### ORMs vs query builders vs raw SQL: how do you choose? 🔥

| Layer | Examples | Pros | Cons |
|---|---|---|---|
| **Full ORM** | Hibernate/JPA, Prisma, TypeORM, Sequelize, Django ORM, SQLAlchemy ORM, Exposed DAO | Productivity, relationships, migrations, a unit of work, less boilerplate | Hidden queries (**N+1**), leaky abstractions, hard to optimise complex queries, memory overhead |
| **Query builder** | **Knex**, **Kysely** (type-safe), **Drizzle**, **jOOQ** (Java), SQLAlchemy Core, Exposed DSL | Composable, close to SQL, type-safe options | You manage mapping and relationships |
| **Raw SQL** | `pg`, JDBC, psycopg, MyBatis (mapped SQL) | Full power: CTEs, window functions, Postgres features | Mapping boilerplate; injection risk if you're careless |

**A pragmatic answer:**

- "An ORM for CRUD and simple relations, with **query logging on** in development to catch N+1."
- "A query builder or raw SQL for reporting, complex aggregations and performance-critical paths."
- Most ORMs let you mix them (`prisma.$queryRaw` with tagged templates, `@Query(nativeQuery = true)`, Django `.raw()`), always **parameterised**.

### What's your backup and restore strategy? Explain RPO and RTO 🔥

- **RPO** (Recovery Point Objective) is **how much data you can afford to lose**: "at most 5 minutes".
- **RTO** (Recovery Time Objective) is **how long recovery may take**: "back within 1 hour".

| Backup type | Tool | Pros | Cons |
|---|---|---|---|
| **Logical** | `pg_dump` / `pg_restore`, `mysqldump` | Portable across versions; selective tables | Slow for large databases; restore rebuilds indexes; RPO = the dump interval |
| **Physical + WAL archiving** | `pg_basebackup`, **pgBackRest**, WAL-G, Barman | Fast; **PITR (point-in-time recovery)** to any second | Same major version; whole-cluster |
| **Managed** | RDS/Aurora automated backups + PITR (up to 35 days), snapshots | Zero effort; cross-region copies | Vendor-specific; restore creates a **new instance** (so update connection strings) |

**Principles:**

- **Replicas are not backups.** A `DROP TABLE` or a bad `UPDATE` replicates instantly. Delayed replicas help a little; PITR is the real answer.
- **A backup you haven't restored is a hope, not a backup.** Automate **restore tests** and measure the RTO.
- Follow **3-2-1:** 3 copies, 2 media, 1 off-site (a different region or account).
- Encrypt backups. Restrict who can delete them (AWS Backup Vault Lock, object lock).
- **Know the PITR runbook:**
  1. Find the bad transaction's time in the logs or audit trail.
  2. Restore to just before it, into a new instance.
  3. Copy the lost rows back, or cut over.

### How do you protect sensitive data (PII) in the database?

**Encryption layers:**

| Layer | What it protects against | How |
|---|---|---|
| **In transit** | Network sniffing | TLS (`sslmode=verify-full`) |
| **At rest** | Stolen disks or snapshots | Storage encryption (RDS with KMS, LUKS) |
| **Column / application-level** | DBAs, SQL injection dumps, backups | Encrypt in the app with **envelope encryption** (a KMS data key), or `pgcrypto`. Searchable fields need a deterministic hash (a blind index) |

**Access control and minimisation:**

- **Least privilege:**
  - The app role can read and write its tables but not run DDL.
  - Migrations run as a separate role.
  - Read-only roles for analytics.
  - No shared superuser.
- **Minimise:**
  - Don't store what you don't need.
  - Tokenise card data (never store PANs; use the payment provider's tokens).
  - Mask PII in logs and non-production copies.
- **Retention and erasure:** automated deletion and anonymisation jobs. Know which tables hold PII, which is a **data inventory**, required by GDPR and India's **DPDP Act**.
- **Audit access** to sensitive tables (pgAudit), and alert on bulk exports.

In RBF-style document redaction work, **the redacted output and the original are different data classes**. Store originals encrypted, with tighter access and shorter retention. *[Adjust to what RBF actually did.]*
