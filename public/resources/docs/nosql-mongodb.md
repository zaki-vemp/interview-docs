# NoSQL Fundamentals & MongoDB

Your production NoSQL experience is **DynamoDB** (Nebraska Draw, SCAI). Full-stack JavaScript roles, especially anything that says "MERN", will also ask about **MongoDB**, and senior rounds ask *when* to pick a document, wide-column, search or graph store.

This doc covers:

- The NoSQL landscape.
- MongoDB in depth: data modelling, queries, aggregation, indexes, replica sets, sharding, change streams, Mongoose, security.
- Cassandra, Elasticsearch/OpenSearch and graph databases at interview depth.

> **Be honest about the MongoDB depth you have.** A good framing: *"I've used DynamoDB in production. The modelling mindset is the same (design for access patterns, embed what's read together), and here's how it maps to MongoDB…"*

> Mongo shell queries aren't runnable here. A **mini aggregation-pipeline engine**, an **ObjectId decoder** and a **NoSQL-injection demo** are runnable JavaScript with tests.

## NoSQL fundamentals

### What does "NoSQL" mean, and what are the main families? 🔥

"NoSQL" ("not only SQL") covers databases that trade some relational features (joins, a rigid schema, multi-row ACID by default) for **horizontal scale**, **flexible data models**, or **specialised query capabilities**.

| Family | Data model | Examples | Sweet spot |
|---|---|---|---|
| **Key-value** | `key → opaque value` | **Redis**, **DynamoDB** (also a document store), Memcached, etcd | Caching, sessions, rate limits, feature flags, lookups by key |
| **Document** | `key → JSON/BSON document`, queryable by fields | **MongoDB**, Couchbase, Firestore, DocumentDB, Cosmos DB | Aggregates read and written together: user profiles, product catalogues, CMS content, meeting settings |
| **Wide-column** | Partition key → sorted rows of columns | **Cassandra**, ScyllaDB, HBase, Bigtable | Huge write throughput, time-series, messages, IoT; known queries at massive scale |
| **Graph** | Nodes + relationships with properties | **Neo4j**, Amazon Neptune, ArangoDB | Deep relationship traversal: social graphs, recommendations, fraud rings, permissions graphs |
| **Search** | Inverted index over documents | **Elasticsearch**, **OpenSearch**, Meilisearch, Typesense, Solr | Full-text, fuzzy and faceted search; log analytics |
| **Time-series** | Timestamped measurements | InfluxDB, TimescaleDB (a Postgres extension), Timestream | Metrics, IoT, monitoring |
| **Vector** | Embeddings + ANN indexes | Pinecone, Qdrant, Weaviate, Milvus, **pgvector**, OpenSearch k-NN | Semantic search, RAG for LLM features |

**The key insight:** NoSQL is not one thing. Comparing "SQL vs NoSQL" is less useful than asking "**which access patterns, consistency needs and scale do I have**, and which data model fits them?"

### "NoSQL is schemaless," true or false? And when is NoSQL the wrong choice? 🔥

**False, or at least misleading.** It's **schema-on-read** rather than schema-on-write:

- The schema still exists, in your **application code**: Mongoose schemas, TypeScript types, DynamoDB item shapes.
- Without discipline you get **schema drift**: documents of version 1, 2 and 3 mixed together, and every reader must handle all of them.
- MongoDB supports **`$jsonSchema` validation** on collections, so schema enforcement can live in the database too.

**When NoSQL is the wrong choice:**

1. **Many-to-many relationships with ad-hoc queries.** Reporting across entities ("revenue by product category by region by month") is what SQL joins and aggregates are for.
2. **Strong multi-entity invariants.** Ledgers, inventory and bookings that need multi-row transactions *by default* (MongoDB and DynamoDB support transactions, but with cost and limits).
3. **Unknown or evolving access patterns.** DynamoDB and Cassandra **punish unplanned queries** (scans). Relational databases let you add an index later.
4. **Small or medium data.** Postgres with JSONB handles flexible attributes *and* relational integrity. "We might need web scale" is not a reason.

**When NoSQL clearly wins:**

- Predictable single-digit-millisecond latency at very high scale (DynamoDB).
- Massive write throughput (Cassandra).
- Aggregates naturally read as one document (MongoDB).
- Global multi-region active-active writes (DynamoDB global tables, Cassandra, Cosmos DB).
- A **serverless** fit: no connection pools, pay per request.

### What are BASE and eventual consistency, and how do they relate to CAP? 🔥

**ACID vs BASE:**

| ACID (traditional relational) | BASE (many distributed NoSQL stores) |
|---|---|
| Atomic, Consistent, Isolated, Durable | **B**asically **A**vailable, **S**oft state, **E**ventual consistency |
| Correctness first; may refuse or block during failures | Availability first; replicas converge over time |

**Eventual consistency:** if no new writes happen, all replicas *eventually* return the same value. In between, reads may be **stale**.

**Stronger client-centric guarantees** that eventually-consistent systems can still offer:

- **Read-your-writes:** after I write, I see my write.
- **Monotonic reads:** I never see data go backwards.
- **Causal consistency:** if B depends on A, everyone sees A before B. MongoDB **causally consistent sessions** provide this.

**Modern systems make consistency *tunable* per request, instead of a fixed choice:**

- DynamoDB: `ConsistentRead: true`.
- Cassandra: consistency levels such as `QUORUM`.
- MongoDB: `readConcern` and `writeConcern`.

CAP and PACELC are covered in depth in [Replication, Sharding & Distributed Databases](/docs/distributed-data).

## MongoDB data modelling

### Explain MongoDB's data model: documents, BSON, collections and ObjectId 🔥

**The building blocks:**

- A **document** is a BSON object: binary JSON with extra types such as `ObjectId`, `Date`, `Decimal128`, `Int64` and `BinData`.
- **Maximum size: 16 MB** per document. Use **GridFS** for larger files, or better, store files in **S3** and keep the key in the document.
- A **collection** is a group of documents. There's no enforced schema unless you add a validator.
- A **database** is a group of collections.
- **`_id`** is the primary key. It's required, unique and automatically indexed, and defaults to an **ObjectId**.

**ObjectId (12 bytes):**

| Bytes | Content |
|---|---|
| 4 | **Seconds since the Unix epoch** (so ObjectIds are roughly time-ordered) |
| 5 | A random value per process |
| 3 | An incrementing counter |

**Consequences:**

- You can extract the creation time (`ObjectId.getTimestamp()`).
- Sorting by `_id` ≈ sorting by creation time, which is useful for pagination.
- Values are generated **client-side by the driver**, with no round trip.

```js
// Decode the timestamp inside an ObjectId (first 4 bytes = 8 hex chars = Unix seconds)
const objectIdToDate = (hex) => new Date(parseInt(hex.slice(0, 8), 16) * 1000);
const dateToObjectIdPrefix = (date) => Math.floor(date.getTime() / 1000).toString(16).padStart(8, '0');

// Build the smallest ObjectId for a time: useful for "_id >= <time>" range queries without a createdAt field
const minObjectIdFor = (date) => dateToObjectIdPrefix(date) + '0000000000000000';

const created = new Date('2026-10-09T10:15:30Z');
const id = minObjectIdFor(created);
console.log(id, '→', objectIdToDate(id).toISOString());

test('ObjectId round-trips its timestamp (second precision)', () => {
  expect(id).toHaveLength(24);
  expect(objectIdToDate(id).toISOString()).toBe('2026-10-09T10:15:30.000Z');
});
test('ObjectIds sort by creation time', () => {
  const earlier = minObjectIdFor(new Date('2026-01-01T00:00:00Z'));
  expect(earlier < id).toBe(true);           // hex strings of equal length compare like numbers
});
```

### Embedding vs referencing: how do you decide? 🔥

**The guiding principle: data that is accessed together should be stored together**, unless that makes documents unbounded or causes heavy duplication of frequently changing data.

| Relationship | Recommendation | Example |
|---|---|---|
| **One-to-few** (bounded, small) | **Embed** an array of subdocuments | A user's addresses (2–3); meeting settings |
| **One-to-many** (hundreds, bounded) | **Embed references** (array of ids) in the parent, or put a parent id in the children | A product's parts list |
| **One-to-squillions** (unbounded) | **The child references the parent**; never an array in the parent | Log events or chat messages for a meeting (`{ meetingId, … }`) |
| **Many-to-many** | Arrays of references on one or both sides, or a linking collection | Users ↔ groups |
| Data that changes independently and is shared widely | **Reference** | The author profile shown on 10,000 posts |

**Embed when:**

- The data is read together.
- It has the same lifecycle (deleted with the parent).
- It's bounded in size.
- It needs **atomic updates together**. Single-document writes are always atomic.

**Reference when:**

- The data is unbounded or large.
- It's queried independently.
- It's shared by many parents and updated often.
- It's needed in many-to-many relations.

**The anti-pattern to name:** **unbounded arrays.** Pushing every chat message into `meeting.messages[]` grows the document toward 16 MB. Every update rewrites a large document, and indexes on that array explode (multikey).

```mongo
// Embedded (one-to-few): the whole meeting card in one read
{
  _id: ObjectId("..."),
  title: "Sprint Review",
  host: { id: 7, name: "Zaki", avatar: "https://…" },      // extended reference: a copy of hot fields
  settings: { lobby: true, recording: "auto", e2ee: false },
  coHosts: [ { id: 9, name: "Asha" } ],
  scheduledStart: ISODate("2026-10-09T04:30:00Z")
}

// Referenced (one-to-squillions): messages point to their meeting
{ _id: ObjectId("..."), meetingId: ObjectId("..."), senderId: 7, body: "Hi all", sentAt: ISODate("…") }
```

### Which MongoDB schema design patterns do you know? 🔥

| Pattern | Problem it solves | How |
|---|---|---|
| **Extended Reference** | Avoid a `$lookup` for commonly displayed fields | Copy a few stable fields (author name, avatar) into the referencing doc; refresh on change |
| **Subset** | A document is too big because of rarely used data | Keep the **N most recent or relevant** items embedded (last 10 reviews); the rest in another collection |
| **Bucket** | Too many tiny documents (IoT, metrics, chat) | Group by time window: one doc per sensor per hour with an array of readings and precomputed `count`/`sum`. **Time-series collections** (5.0+) do this automatically |
| **Computed** | Expensive repeated aggregation | Precompute and store (`participantCount`, `totalDuration`) on write or periodically |
| **Outlier** | A few documents are huge (a celebrity with 10M followers) | Flag `hasOverflow: true` and move the excess to overflow documents |
| **Polymorphic** | Different shapes in one collection | A `type` field; queries and indexes shared across shapes (e.g. `events` of many kinds) |
| **Attribute** | Many similar fields to index (`size_eu`, `size_us`, …) | Convert to an array of `{k, v}` pairs with **one compound index** on `{ "attrs.k": 1, "attrs.v": 1 }` |
| **Schema Versioning** | Evolving document shapes without downtime | A `schemaVersion` field; the app handles both versions and migrates lazily on read or write, or in a background job |
| **Tree** | Hierarchies | Parent references, child references, an **array of ancestors**, or a materialised path |
| **Approximation** | High-frequency counters | Update the counter every N events instead of on every one |
| **Archive** | Old data slows the working set | Move old docs to an archive collection or cluster, or to Atlas Online Archive |

### How do you enforce a schema in MongoDB, and how do you migrate document shapes?

```mongo
db.createCollection("meetings", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["title", "hostId", "kind", "status"],
      properties: {
        title:  { bsonType: "string", maxLength: 200 },
        hostId: { bsonType: "long" },
        kind:   { enum: ["meeting", "webinar"] },
        status: { enum: ["scheduled", "live", "ended", "cancelled"] },
        settings: {
          bsonType: "object",
          properties: { lobby: { bsonType: "bool" }, recording: { enum: ["off", "manual", "auto"] } }
        }
      }
    }
  },
  validationLevel: "moderate",       // existing invalid docs can still be updated; new ones are validated
  validationAction: "error"          // or "warn" while rolling out
});
```

**Migrating shapes** (there's no `ALTER TABLE`):

1. **Lazy migration:** the code reads `schemaVersion` and upgrades the document when it next writes it.
2. **Background backfill:** `updateMany` in batches, with a filter on `schemaVersion < 3`, idempotent.
3. Both paths must work during the transition. **Expand/contract** applies here too: add the new field, write both, backfill, read the new one, remove the old one.

### Model a real-time meeting chat and webinar analytics in MongoDB 🔥

**Access patterns:**

1. Load the meeting card with settings.
2. Load the last 50 chat messages, then scroll back.
3. Show who is in the meeting now.
4. Per-org monthly attendance analytics.

```mongo
// meetings: the aggregate root, embedded small and bounded data
{ _id, orgId, title, kind: "webinar", host: { id, name }, settings: {...},
  stats: { peakParticipants: 248, totalJoins: 391 },            // computed pattern
  scheduledStart, status }

// messages: one doc per message (unbounded → child references parent)
{ _id: ObjectId, meetingId, sender: { id, name }, body, sentAt }   // extended reference for the sender name
db.messages.createIndex({ meetingId: 1, _id: -1 })                 // newest first, keyset pagination by _id

// presence: ephemeral, TTL-cleaned; one doc per live participant session
{ _id: sessionId, meetingId, userId, role: "visitor", joinedAt, lastHeartbeat }
db.presence.createIndex({ lastHeartbeat: 1 }, { expireAfterSeconds: 120 })   // stale sessions vanish
db.presence.createIndex({ meetingId: 1 })

// attendance: bucket pattern per meeting per day for analytics
{ meetingId, day: ISODate("2026-10-09"), orgId, joins: 391, uniqueUsers: 248, minutes: 18240 }
```

**Talking points:**

- **Messages aren't embedded**, because they're unbounded.
- **Pagination** uses `_id < lastSeenId` with `limit(50)`, never `skip`.
- **TTL** cleans up presence rows.
- **Computed stats and buckets** avoid scanning messages for dashboards.
- **Live updates** come from change streams on `messages` fanned out over WebSockets, or the XMPP MUC carries chat live and the database is the history.

## Querying

### Show the essential CRUD operations and update operators 🔥

```mongo
// Find with filter, projection, sort, limit
db.meetings.find(
  { orgId: 42, status: { $in: ["scheduled", "live"] }, scheduledStart: { $gte: ISODate("2026-10-09") } },
  { title: 1, scheduledStart: 1, "host.name": 1 }          // projection (_id included by default)
).sort({ scheduledStart: 1 }).limit(20)

// Arrays: match an element that satisfies multiple conditions at once
db.meetings.find({ coHosts: { $elemMatch: { id: 9, role: "presenter" } } })
// ⚠ without $elemMatch, { "coHosts.id": 9, "coHosts.role": "presenter" } can match DIFFERENT elements

// Update operators (atomic on a single document)
db.meetings.updateOne(
  { _id: id, status: "scheduled" },                         // the condition doubles as an optimistic guard
  {
    $set: { status: "live", startedAt: new Date() },
    $inc: { "stats.totalJoins": 1 },
    $addToSet: { tags: "all-hands" },                       // add if not present
    $push: { recentEvents: { $each: [evt], $slice: -20 } }  // keep only the last 20 (subset pattern)
  }
)

// Update a specific array element with arrayFilters
db.meetings.updateOne(
  { _id: id },
  { $set: { "coHosts.$[h].role": "moderator" } },
  { arrayFilters: [{ "h.id": 9 }] }
)

// Upsert + return the new document atomically (e.g. a per-day counter)
db.dailyStats.findOneAndUpdate(
  { orgId: 42, day: "2026-10-09" },
  { $inc: { meetings: 1 }, $setOnInsert: { createdAt: new Date() } },
  { upsert: true, returnDocument: "after" }
)

// Bulk writes: one round trip, ordered: false continues past individual errors
db.events.bulkWrite([{ insertOne: { document: e1 } }, { updateOne: { filter: {...}, update: {...} } }], { ordered: false })
```

**Atomicity:**

- **Single-document operations are atomic**, including updates to embedded arrays and subdocuments.
- That's why good modelling (embedding what changes together) often removes the need for transactions.
- **`findOneAndUpdate`** is the building block for queues, counters and state transitions.

### Explain the aggregation pipeline and how to write an efficient one 🔥

A pipeline is an array of **stages**. Each stage transforms the stream of documents.

| Stage | SQL analogue | Notes |
|---|---|---|
| `$match` | `WHERE` | **Put it first**, so it can use indexes |
| `$project` / `$addFields` / `$set` | `SELECT` expressions | Reshape and compute fields |
| `$group` | `GROUP BY` + aggregates | `$sum`, `$avg`, `$min`, `$max`, `$push`, `$addToSet`, `$first`, `$last`, `$count` |
| `$sort` / `$limit` / `$skip` | `ORDER BY` / `LIMIT` | `$sort` followed by `$limit` uses a top-k sort; a `$sort` at the start can use an index |
| `$unwind` | Join to an array's elements | One output doc per array element |
| `$lookup` | `LEFT OUTER JOIN` | Index the `foreignField`. Supports pipelines and correlated subqueries |
| `$facet` | Several queries in one | Search results + counts per category in one round trip |
| `$bucket` / `$bucketAuto` | Histogram | Price ranges |
| `$setWindowFields` (5.0+) | Window functions | Running totals, moving averages, ranks |
| `$merge` / `$out` | `INSERT INTO … SELECT` | Materialise results (on-demand materialised views) |

```mongo
// Monthly attendance per org for ended webinars, top 10 orgs
db.meetings.aggregate([
  { $match: { kind: "webinar", status: "ended", scheduledStart: { $gte: ISODate("2026-09-01"), $lt: ISODate("2026-10-01") } } },
  { $group: { _id: "$orgId", webinars: { $sum: 1 }, attendees: { $sum: "$stats.totalJoins" }, avgPeak: { $avg: "$stats.peakParticipants" } } },
  { $sort: { attendees: -1 } },
  { $limit: 10 },
  { $lookup: { from: "orgs", localField: "_id", foreignField: "_id", as: "org", pipeline: [{ $project: { name: 1 } }] } },
  { $set: { org: { $first: "$org" } } }
])
```

**Performance rules:**

- **`$match` and `$sort` as early as possible.** Only stages at the **start** of the pipeline can use indexes.
- **`$project` away unneeded fields early** to shrink documents. The optimiser often does this for you.
- **Memory:** each stage has a 100 MB limit, after which it spills to disk. `allowDiskUse` is the default since 6.0.
- **Pre-aggregate** (computed or bucket patterns, `$merge` into summary collections) for dashboards rather than aggregating raw events on every page load.

This mini pipeline engine implements `$match`, `$unwind`, `$group`, `$sort`, `$limit` and `$project`, so you can see exactly what each stage does:

```js
const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? undefined : v[k]), doc);
const val = (doc, expr) => (typeof expr === 'string' && expr.startsWith('$') ? get(doc, expr.slice(1)) : expr);

function matches(doc, filter) {
  return Object.entries(filter).every(([path, cond]) => {
    const v = get(doc, path);
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      return Object.entries(cond).every(([op, arg]) => ({
        $eq: () => v === arg, $ne: () => v !== arg, $gt: () => v > arg, $gte: () => v >= arg,
        $lt: () => v < arg, $lte: () => v <= arg, $in: () => arg.includes(v),
      })[op]());
    }
    return Array.isArray(v) ? v.includes(cond) : v === cond;   // arrays match if any element equals
  });
}

const accumulators = {
  $sum: (docs, e) => docs.reduce((s, d) => s + (val(d, e) ?? 0), 0),
  $avg: (docs, e) => docs.reduce((s, d) => s + val(d, e), 0) / docs.length,
  $max: (docs, e) => Math.max(...docs.map((d) => val(d, e))),
  $push: (docs, e) => docs.map((d) => val(d, e)),
  $addToSet: (docs, e) => [...new Set(docs.map((d) => val(d, e)))],
};

function aggregate(docs, pipeline) {
  return pipeline.reduce((stream, stage) => {
    const [[op, spec]] = Object.entries(stage);
    switch (op) {
      case '$match': return stream.filter((d) => matches(d, spec));
      case '$unwind': {
        const f = spec.slice(1);
        return stream.flatMap((d) => (d[f] ?? []).map((item) => ({ ...d, [f]: item })));
      }
      case '$group': {
        const groups = new Map();
        for (const d of stream) {
          const key = JSON.stringify(val(d, spec._id) ?? null);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(d);
        }
        return [...groups].map(([key, ds]) => {
          const out = { _id: JSON.parse(key) };
          for (const [field, acc] of Object.entries(spec)) {
            if (field === '_id') continue;
            const [[accOp, expr]] = Object.entries(acc);
            out[field] = accumulators[accOp](ds, expr);
          }
          return out;
        });
      }
      case '$sort': return stream.slice().sort((a, b) => {
        for (const [k, dir] of Object.entries(spec)) {
          const x = get(a, k), y = get(b, k);
          if (x !== y) return (x < y ? -1 : 1) * dir;
        }
        return 0;
      });
      case '$limit': return stream.slice(0, spec);
      case '$project': return stream.map((d) => Object.fromEntries(
        Object.entries(spec).filter(([, v]) => v !== 0).map(([k, v]) => [k, v === 1 ? get(d, k) : val(d, v)])));
      default: throw new Error(`unsupported stage ${op}`);
    }
  }, docs);
}

const meetings = [
  { _id: 1, orgId: 'acme', kind: 'webinar', status: 'ended', minutes: 60, participants: ['asha', 'ravi', 'meera'] },
  { _id: 2, orgId: 'acme', kind: 'meeting', status: 'ended', minutes: 30, participants: ['asha', 'john'] },
  { _id: 3, orgId: 'globex', kind: 'webinar', status: 'ended', minutes: 90, participants: ['ravi'] },
  { _id: 4, orgId: 'globex', kind: 'meeting', status: 'live', minutes: 15, participants: ['zaki'] },
];

const perOrg = aggregate(meetings, [
  { $match: { status: 'ended' } },
  { $unwind: '$participants' },
  { $group: { _id: '$orgId', joins: { $sum: 1 }, people: { $addToSet: '$participants' } } },
  { $sort: { joins: -1 } },
]);
const minutesByKind = aggregate(meetings, [
  { $group: { _id: '$kind', total: { $sum: '$minutes' }, avg: { $avg: '$minutes' }, longest: { $max: '$minutes' } } },
  { $sort: { _id: 1 } },
  { $project: { kind: '$_id', total: 1, avg: 1, _id: 0 } },
]);
console.log(perOrg, minutesByKind);

test('$unwind + $group counts one row per array element', () => {
  expect(perOrg).toEqual([
    { _id: 'acme', joins: 5, people: ['asha', 'ravi', 'meera', 'john'] },
    { _id: 'globex', joins: 1, people: ['ravi'] },
  ]);
});
test('$group accumulators and $project reshaping', () => {
  expect(minutesByKind).toEqual([
    { kind: 'meeting', total: 45, avg: 22.5 },
    { kind: 'webinar', total: 150, avg: 75 },
  ]);
});
test('array fields match if any element equals the value', () => {
  expect(aggregate(meetings, [{ $match: { participants: 'ravi' } }]).map((m) => m._id)).toEqual([1, 3]);
});
```

### `$lookup` vs embedding: should you "join" in MongoDB?

**`$lookup` exists and works.** It's indexed on `foreignField` and supported on sharded collections since 5.1. But:

- **It's per-document work.** A `$lookup` on 100,000 documents means 100,000 index probes. That's fine for a page of results, but bad for bulk analytics.
- **If you `$lookup` on almost every read, the model is probably wrong.** Use **extended references** (copy the 2–3 displayed fields) or embed.
- **Cross-shard `$lookup`s** fan out to every shard.

**A reasonable answer:** "Model so the hot reads need no join. Use `$lookup` for less frequent views and admin screens. Use **pre-joined read models** (`$merge` into a view collection, or app-side denormalisation) for heavy dashboards."

### How do you paginate efficiently in MongoDB?

```mongo
// ✗ skip gets slower linearly: the server walks and discards 100,000 index entries
db.messages.find({ meetingId }).sort({ _id: -1 }).skip(100000).limit(50)

// ✓ Range (keyset) pagination: remember the last _id of the page
db.messages.find({ meetingId, _id: { $lt: lastSeenId } }).sort({ _id: -1 }).limit(50)
// index: { meetingId: 1, _id: -1 }

// Sorting by a non-unique field: add _id as a tiebreaker to both the sort and the cursor
db.posts.find({ $or: [ { score: { $lt: s } }, { score: s, _id: { $lt: id } } ] }).sort({ score: -1, _id: -1 }).limit(20)
```

`countDocuments()` with a filter scans matching index entries. For "page X of Y" on big collections, use `estimatedDocumentCount()` (metadata, no filter) or cached counts.

## Indexing & performance

### Which index types does MongoDB support, and what is the ESR rule? 🔥

| Index | Use |
|---|---|
| Single-field | `{ email: 1 }` |
| **Compound** | `{ orgId: 1, status: 1, scheduledStart: -1 }`. Order matters (prefix rule, like SQL) |
| **Multikey** | Automatically created when an indexed field is an **array**. One entry per element. A compound index can include **at most one array field per document** |
| Text | `{ title: "text", body: "text" }`. Basic full-text with stemming. **Atlas Search** (Lucene) is far more capable |
| **2dsphere** | Geospatial `$near`, `$geoWithin` |
| **Hashed** | `{ userId: "hashed" }`. Even distribution for **hashed sharding**; equality only |
| **Wildcard** | `{ "attrs.$**": 1 }`. Index unknown or dynamic subfields (custom fields) |
| **TTL** | `{ lastHeartbeat: 1 }, { expireAfterSeconds: 120 }`. A background thread deletes expired docs (about every 60 s) |
| **Partial** | `{ email: 1 }, { partialFilterExpression: { deleted: false } }` |
| Unique / sparse | Uniqueness, or only docs that have the field |
| **Vector search** | Atlas Vector Search for embeddings (RAG) |

**The ESR rule for compound index field order:**

1. **E**quality fields first (`orgId`, `status`).
2. Then **S**ort fields (`scheduledStart`).
3. Then **R**ange fields (`price: { $gte }`).

**Why:** after a range, the index entries aren't ordered by the next field, so a sort would need an in-memory `SORT` stage.

```mongo
// Query: { orgId: 42, status: "ended", durationMin: { $gte: 30 } } sort { scheduledStart: -1 }
db.meetings.createIndex({ orgId: 1, status: 1, scheduledStart: -1, durationMin: 1 })   // E, E, S, R
```

### How do you read `explain()` output in MongoDB? 🔥

```mongo
db.meetings.find({ orgId: 42, status: "ended" }).sort({ scheduledStart: -1 }).limit(20).explain("executionStats")
```

| Field / stage | Meaning |
|---|---|
| `winningPlan.stage: "IXSCAN"` → `FETCH` | Index scan, then fetch the documents ✅ |
| `COLLSCAN` | **Full collection scan** ❌ (fine only for tiny collections) |
| `SORT` (in-memory) | No index provides the order. Watch out for memory limits and big latency |
| `PROJECTION_COVERED` | **Covered query**: answered from the index only (the filter and projected fields are all in the index, `_id` excluded) |
| `nReturned` | Documents returned |
| `totalKeysExamined` | Index entries scanned |
| `totalDocsExamined` | Documents fetched |
| `executionTimeMillis` | Server execution time |

**The health ratio:** ideally **`totalKeysExamined ≈ totalDocsExamined ≈ nReturned`**. Examining 100,000 docs to return 20 means a missing or poorly ordered index. The **database profiler** (`db.setProfilingLevel(1, { slowms: 100 })`) and Atlas Query Insights find slow queries in production.

### What are common MongoDB performance anti-patterns?

| Anti-pattern | Why it hurts | Fix |
|---|---|---|
| **Unbounded arrays** | Huge documents, slow updates, multikey index bloat, 16 MB limit | Child references, the subset pattern |
| **Massive documents read for one field** | Network and memory waste | Projection, split hot and cold data |
| **Too many collections** (one per user/tenant) | Each collection plus its indexes costs files and RAM | A shared collection with a `tenantId` field |
| **Unnecessary indexes** | Slower writes, RAM pressure (the working set must fit) | `$indexStats` to find unused ones |
| **Unanchored or case-insensitive `$regex`** | Can't use the index efficiently | Anchored prefix `^abc`, a **collation index** for case-insensitive search, or Atlas Search |
| **`$lookup` everywhere** | Join-heavy workloads fight the model | Embed or use extended references |
| **Working set > RAM** | WiredTiger cache misses, so disk reads | Bigger instance, better indexes, archive old data |
| **Not using `lean()`** in Mongoose for read-only queries | Full document hydration is slow | `.lean()` |

## Consistency, replication & sharding

### How do replica sets, write concern and read concern work? 🔥

**A replica set** is one **primary** (which takes all writes) plus **secondaries** that replicate its **oplog** (an operation log, itself a capped collection).

**Elections:**

- If the primary is unreachable (about 10 s election timeout by default), the secondaries hold an **election** using a Raft-like protocol.
- The member with the most up-to-date oplog and enough votes becomes primary.
- Drivers retry writes automatically (**retryable writes**).
- Use an **odd number of voting members**, at least 3, so a majority exists.

**Write concern** answers "when is a write acknowledged?":

| `w` | Meaning |
|---|---|
| `w: 1` | Acknowledged by the primary only. **Can be rolled back** if the primary fails before replicating |
| **`w: "majority"`** | Acknowledged by a majority. **Survives failover.** The default since MongoDB 5.0 |
| `j: true` | Also wait for the on-disk journal |
| `wtimeout` | Give up waiting after N ms (the write may still eventually apply!) |

**Read concern** answers "what data may I see?":

| Level | Returns |
|---|---|
| `local` (default) | The node's latest data, which may be rolled back later |
| **`majority`** | Data acknowledged by a majority: never rolled back |
| `linearizable` | Reflects all majority writes that completed before the read started (primary only, slow) |
| `snapshot` | Point-in-time view (transactions, and reads at `atClusterTime`) |

**Read preference** answers "which node?": `primary` (default), `primaryPreferred`, `secondary`, `secondaryPreferred`, `nearest`. **Secondary reads may be stale**, by the replication lag. Use them for analytics, never for read-after-write.

**Causal consistency:** in a session with `causalConsistency: true`, combined with majority read and write concerns, you read your own writes even from secondaries.

### How does sharding work, and how do you choose a shard key? 🔥

**Architecture:**

- Each **shard** is a replica set.
- **`mongos`** routers direct queries.
- **Config servers** store the metadata: which **chunk** of key ranges lives on which shard.
- The **balancer** moves chunks to even out data. The default chunk size is 128 MB since 6.0.

**Shard key strategies:**

| Strategy | Distribution | Range queries | Risk |
|---|---|---|---|
| **Ranged** | Contiguous key ranges | ✅ efficient (targeted to one or a few shards) | **Monotonic keys** (timestamps, ObjectIds) send every insert to the **last chunk**: a hot shard |
| **Hashed** | Even (hash of the key) | ❌ range queries scatter to every shard | Lost locality |
| **Zone** | Ranges pinned to specific shards | — | Data residency (EU data on EU shards), tiered hardware |

**What makes a good shard key:**

- **High cardinality:** many distinct values, so the data can split into many chunks.
- **Even frequency:** no single value dominates. A "celebrity" tenant creates a **jumbo chunk**.
- **Non-monotonic**, or hashed, for write-heavy collections.
- **Present in most queries**, so queries are **targeted** rather than **scatter-gather** (broadcast to all shards and merged by `mongos`).

**The usual answer for a multi-tenant SaaS:** a **compound key** `{ tenantId: 1, _id: 1 }` (or `{ tenantId: 1, createdAt: 1 }`). Queries are tenant-scoped and targeted, and big tenants can still split across chunks.

**Changing the shard key:** **resharding** (5.0+) rewrites the collection online, but it's expensive. Choose carefully, and don't shard until you need to; a large replica set goes a long way.

### What are change streams, and what would you use them for? 🔥

**Change streams** let applications **subscribe to inserts, updates, deletes and replaces** on a collection, database or cluster. They're built on the oplog and need a replica set or sharded cluster.

```node
const pipeline = [{ $match: { operationType: 'insert', 'fullDocument.meetingId': meetingId } }];
const stream = db.collection('messages').watch(pipeline, { fullDocument: 'updateLookup', resumeAfter: lastToken });

for await (const change of stream) {
  io.to(`meeting:${meetingId}`).emit('chat', change.fullDocument);   // fan out over WebSockets
  await saveResumeToken(change._id);                                  // resume exactly where you left off after a restart
}
```

**Use cases:**

- Real-time UI updates (chat, dashboards).
- **Syncing to a search index** (Elasticsearch, Atlas Search) or a cache.
- **CDC into a warehouse.**
- Event-driven workflows: an outbox without polling.
- Audit trails.

**Gotchas:**

- **Resume tokens expire** when the oplog rolls over. Size the oplog for your maximum downtime.
- `updateLookup` fetches the **current** document, which may be newer than the change. Use pre- and post-images (6.0+) for exact before/after values.
- **Delivery is at-least-once** across restarts, so consumers must be idempotent.

### What are TTL indexes, capped collections and time-series collections?

| Feature | What it does | Use |
|---|---|---|
| **TTL index** | Deletes documents when `dateField + expireAfterSeconds` has passed (background, about every 60 s) | Sessions, OTP codes, presence, temporary uploads |
| **Capped collection** | Fixed size; insertion order; the oldest docs are overwritten (a circular buffer) | Recent-logs buffers. Rarely used now |
| **Time-series collection** (5.0+) | Internally buckets measurements by `metaField` + time; column-compressed | Metrics, IoT, meeting quality stats (bitrate, jitter, packet loss per participant) |

```mongo
db.createCollection("callStats", {
  timeseries: { timeField: "ts", metaField: "meta", granularity: "seconds" },
  expireAfterSeconds: 60 * 60 * 24 * 30
})
db.callStats.insertOne({ ts: new Date(), meta: { meetingId, participantId }, bitrateKbps: 1450, rttMs: 82, packetLoss: 0.4 })
```

## Node.js + MongoDB

### What should you know about Mongoose (and its pitfalls)? 🔥

```node
const meetingSchema = new mongoose.Schema({
  orgId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Org', required: true, index: true },
  title:   { type: String, required: true, trim: true, maxlength: 200 },
  status:  { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },
  host:    { id: Number, name: String },
  settings:{ lobby: { type: Boolean, default: true }, recording: { type: String, enum: ['off', 'manual', 'auto'] } },
  scheduledStart: Date,
}, { timestamps: true, optimisticConcurrency: true });           // adds createdAt/updatedAt; version checks on save()

meetingSchema.index({ orgId: 1, status: 1, scheduledStart: -1 });
meetingSchema.virtual('isLive').get(function () { return this.status === 'live'; });
meetingSchema.pre('save', function () { if (this.isModified('title')) this.title = this.title.replace(/\s+/g, ' '); });

const Meeting = mongoose.model('Meeting', meetingSchema);

// Read-only queries: lean() returns plain objects (much faster, no getters/virtuals/save)
const list = await Meeting.find({ orgId, status: 'ended' }).sort({ scheduledStart: -1 }).limit(20).lean();

// populate = a SECOND query using $in over the referenced ids (not a join, not per document)
const withOrg = await Meeting.find({ status: 'live' }).populate('orgId', 'name').lean();
```

**Pitfalls to mention:**

- **`populate` is not a join.** One extra query per populated path. Nested populates and large `$in` lists add up.
- **Hooks don't run on every operation.** `updateOne`/`findOneAndUpdate` skip document `save` middleware; they have separate query middleware. `insertMany` and `bulkWrite` have their own rules.
- **`strictQuery`:** in Mongoose 7+ it defaults to `false`, so filter properties that aren't in the schema are passed to MongoDB. Combined with user input, that enables injection (next question). Turn on **`sanitizeFilter`**.
- **Connections in serverless:**
  - **Create the connection outside the handler** and reuse it across warm Lambda invocations.
  - Set `maxPoolSize` small.
  - `bufferCommands: false` fails fast instead of queuing queries when disconnected.
- **Validation runs on `save()`**, but only runs on updates with `runValidators: true`.
- **Discriminators** model the polymorphic pattern (several schemas in one collection).

### What is NoSQL injection, and how do you prevent it? 🔥

When a server builds query filters directly from JSON input, an attacker can send **query operators instead of values**:

```http
POST /login
Content-Type: application/json

{ "email": "admin@example.com", "password": { "$ne": null } }
```

```node
// ✗ Vulnerable: password becomes an operator, which matches any non-null password
const user = await User.findOne({ email: req.body.email, password: req.body.password });
```

Other forms:

- **`$where`** / `$function` with user strings (server-side JavaScript execution).
- **`$regex`** from user input (ReDoS, data probing).
- Operator keys smuggled through query strings: `?email[$ne]=x` parses to an object with Express's `qs`.

**Prevention:**

1. **Validate types** with Zod, Joi or class-validator. Email and password **must be strings**.
2. **Sanitise:** reject or strip keys starting with `$` or containing `.`. Use Mongoose `sanitizeFilter: true` (wraps values in `$eq`), or `express-mongo-sanitize`-style middleware.
3. **Never compare passwords in the query.** Fetch by email, then `bcrypt.compare`/`argon2.verify`. That alone defeats this attack.
4. **Disable server-side JavaScript** (`security.javascriptEnabled: false`) and avoid `$where`.
5. **Least-privilege database users**, network rules (private endpoints, IP allowlists), and TLS.

```js
// Demonstrate operator injection against a tiny Mongo-like matcher, and two defences
const users = [
  { email: 'admin@example.com', password: 'S3cret!' },
  { email: 'zaki@example.com', password: 'hunter2' },
];
function matches(doc, filter) {
  return Object.entries(filter).every(([k, cond]) => {
    if (cond && typeof cond === 'object') {
      return Object.entries(cond).every(([op, arg]) => (op === '$ne' ? doc[k] !== arg : op === '$eq' ? doc[k] === arg : false));
    }
    return doc[k] === cond;
  });
}
const findOne = (filter) => users.find((u) => matches(u, filter)) ?? null;

// Defence 1: schema validation — credentials must be strings
function validateLogin(body) {
  if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new Error('400: invalid body');
  return body;
}
// Defence 2: sanitizeFilter-style — wrap every value in $eq so operators are treated as literal values
const sanitizeFilter = (filter) => Object.fromEntries(Object.entries(filter).map(([k, v]) => [k, { $eq: v }]));

const attack = { email: 'admin@example.com', password: { $ne: null } };

test('naive filter lets the attacker in without the password', () => {
  expect(findOne({ email: attack.email, password: attack.password })?.email).toBe('admin@example.com');
});
test('type validation rejects the operator object', () => {
  expect(() => validateLogin(attack)).toThrow('400');
});
test('$eq-wrapping turns the operator into a literal (no match)', () => {
  expect(findOne(sanitizeFilter({ email: attack.email, password: attack.password }))).toBeNull();
  expect(findOne(sanitizeFilter({ email: 'zaki@example.com', password: 'hunter2' }))?.email).toBe('zaki@example.com');
});
```

*(Real systems store **hashes**, never plaintext passwords. The plaintext here only keeps the demo short.)*

## Other NoSQL systems

### Compare MongoDB, DynamoDB and Cassandra 🔥

| | **MongoDB** | **DynamoDB** | **Cassandra / ScyllaDB** |
|---|---|---|---|
| Model | Rich documents, secondary indexes on anything | Key-value/document: **PK + optional sort key**, GSIs/LSIs | Wide-column: **partition key + clustering columns** |
| Queries | Ad-hoc filters, aggregation pipeline, `$lookup` | **Key-based** `Query`/`GetItem`; `Scan` is expensive; PartiQL | CQL, **only by partition key** (plus clustering ranges); one table per query |
| Consistency | Tunable (read/write concern); strong on the primary | Eventually consistent reads by default; **strongly consistent** reads optional (not on GSIs) | **Tunable per query** (`ONE`, `QUORUM`, `ALL`, `LOCAL_QUORUM`) |
| Transactions | Multi-document ACID | `TransactWriteItems` (100 items) | Lightweight transactions (Paxos) per partition; no multi-partition ACID |
| Scaling | Replica sets + sharding (you choose the shard key) | **Fully managed**, automatic partitioning; on-demand capacity | Masterless ring; linear write scaling; multi-DC |
| Operations | Self-hosted or **Atlas** | Serverless, zero ops | Heavy ops (compaction, repairs) unless managed (Keyspaces, Astra) |
| Item limit | 16 MB document | **400 KB item** | Practical partition < ~100 MB |
| Best at | Flexible app data, rapid iteration | Serverless apps with known access patterns at any scale | Massive write throughput, time-series, multi-region |

### How does Cassandra work, and how do you model data for it? 🔥

**Architecture:**

- A **masterless ring**: every node is equal.
- Data is placed by **consistent hashing** of the partition key, with a **replication factor** (RF, typically 3) across nodes and data centres.

**Write path (an LSM tree):**

1. Append to the **commit log** (durability).
2. Write to the in-memory **memtable**.
3. Flush to immutable **SSTables** on disk.
4. **Compaction** merges SSTables in the background.
5. Writes are **very fast** (sequential I/O, no read-before-write).

**Read path:**

- Check the memtable, then SSTables.
- **Bloom filters** skip SSTables that can't contain the key.
- Results are merged by timestamp: last write wins.

**Deletes write tombstones** (markers):

- Tombstones are purged only after `gc_grace_seconds` (10 days by default), and only once repairs have run.
- **Lots of deletes**, such as queue-like usage, cause **tombstone-heavy reads** and timeouts.

**Tunable consistency:**

- With RF = 3, **`QUORUM` = 2 replicas**.
- **`W + R > RF`** (QUORUM writes + QUORUM reads) gives strong consistency for a key.
- `LOCAL_QUORUM` keeps latency within one data centre.

**Modelling = one table per query.** Denormalise; there are no joins.

```cql
-- Query: "messages of a conversation, newest first, paginated"
CREATE TABLE messages_by_conversation (
  conversation_id uuid,
  bucket          int,          -- e.g. yyyymm, so one partition doesn't grow forever
  message_id      timeuuid,
  sender_id       uuid,
  body            text,
  PRIMARY KEY ((conversation_id, bucket), message_id)       -- (partition key), clustering column
) WITH CLUSTERING ORDER BY (message_id DESC);

SELECT * FROM messages_by_conversation WHERE conversation_id = ? AND bucket = 202610 LIMIT 50;
```

**Rules:**

- **Every query must specify the partition key.**
- Keep partitions bounded: use **time buckets**.
- Avoid `ALLOW FILTERING` (a scan).
- Secondary indexes are rarely a good idea.

This is the model Discord used for messages before it moved to ScyllaDB.

### How does Elasticsearch/OpenSearch work, and how should you use it? 🔥

**Core concepts:**

- An **inverted index** maps **term → list of documents (postings)**, like a book's index.
- **Analysers** tokenise and normalise text at index *and* query time: lowercase, stemming (`running → run`), stop words, synonyms, n-grams for autocomplete.
- **Mapping** is the schema. `text` fields are analysed (full-text search). `keyword` fields are exact (filters, sorting, aggregations). Index a field as both when you need both.
- **Relevance** uses **BM25** by default. Boost fields (`title^3`), use function scores (recency).
- **Near-real-time:** new documents become searchable after a **refresh**, about 1 s by default. It's not a database with read-your-writes.
- **Shards and replicas:** an index is split into primary shards, each with replicas. The primary shard count is fixed at creation; changing it means a reindex (or split/shrink).

```esquery
GET /documents/_search
{
  "query": {
    "bool": {
      "must":   [{ "multi_match": { "query": "purchase order invoice", "fields": ["title^3", "body"], "fuzziness": "AUTO" } }],
      "filter": [{ "term": { "tenantId": "acme" } }, { "range": { "createdAt": { "gte": "now-30d" } } }]
    }
  },
  "aggs": { "by_type": { "terms": { "field": "docType" } } },
  "highlight": { "fields": { "body": {} } }
}
```

**Use it as a secondary index, not the source of truth:**

1. Keep the data in Postgres, DynamoDB or MongoDB.
2. **Sync** to the search index via CDC, DynamoDB Streams → Lambda, change streams, or the outbox pattern.
3. Make re-indexing possible from the source.

**Common uses:**

- Product and document search with facets (SCAI-style document search).
- **Log analytics** (the ELK/OpenSearch stack).
- Autocomplete.

**Pitfalls:**

- **Mapping explosion** from dynamic fields.
- Deep pagination: use `search_after`, not `from`/`size` beyond 10,000.
- Treating it as a primary store.
- Under-provisioned JVM heap.

### When would you use a graph database instead of SQL?

**Use a graph database when the query is about *paths and relationships of unknown depth*:**

- Friends-of-friends.
- "How is this account connected to known fraudsters within 4 hops?"
- Recommendations: "users who attended the same webinars also attended…".
- Permission inheritance graphs.
- Network topologies.

```cypher
// Suggest people Zaki may know: friends of friends ranked by mutual friends
MATCH (me:User {id: 1})-[:FRIEND]-(f:User)-[:FRIEND]-(fof:User)
WHERE fof <> me AND NOT (me)-[:FRIEND]-(fof)
RETURN fof.name, count(DISTINCT f) AS mutualFriends
ORDER BY mutualFriends DESC
LIMIT 10;
```

**Why it's faster for deep traversals:**

- **Index-free adjacency:** each node points directly to its neighbours, so traversal cost depends on the **size of the neighbourhood**, not the table size.
- In SQL each hop is a join, so recursive CTEs get expensive at depth 4–6.

**Stay with SQL when:** the depth is fixed and small (1–2 hops), or the workload is mostly aggregates and reports.

### Which time-series and vector databases do you know, and when do you use them?

**Time-series** (metrics, IoT, call-quality stats):

- **TimescaleDB:** Postgres plus hypertables, compression and continuous aggregates. Keeps SQL and joins.
- **InfluxDB**, **Amazon Timestream**, **Prometheus** (monitoring metrics, pull-based).
- MongoDB time-series collections.
- **What they provide:** automatic time partitioning, compression, downsampling and retention policies.

**Vector databases** (semantic search, RAG for document-processing features like SCAI or RBF):

- **pgvector** (in Postgres: joins, filters and transactions alongside the data).
- **OpenSearch k-NN** / Atlas Vector Search.
- Dedicated stores: **Pinecone**, **Qdrant**, **Weaviate**, **Milvus**.

**Choosing:**

- **Start with pgvector** if the data is already in Postgres and has fewer than tens of millions of vectors.
- Move to a dedicated store for very large scale, heavy filtering plus ANN, or multi-tenant isolation features.

### What is polyglot persistence, and how do you keep several data stores in sync? 🔥

**Polyglot persistence** means using the right store per workload:

- **Postgres** for transactional truth.
- **Redis** for cache and sessions.
- **OpenSearch** for search.
- **S3** for files.
- **DynamoDB** for high-scale key access.
- A **warehouse** for analytics.

**Keeping the stores in sync:**

| Approach | How | Notes |
|---|---|---|
| **Dual writes** in application code | Write to the DB, then to the search index | ❌ Inconsistent on partial failure. Avoid |
| **Transactional outbox** | Write the event in the same DB transaction; a relay publishes it | ✅ At-least-once; consumers are idempotent |
| **CDC** | Debezium (WAL/binlog) → Kafka → consumers; DynamoDB Streams; Mongo change streams | ✅ No application changes; ordered per key |
| **Periodic rebuild** | Nightly reindex from the source | Simple; stale between runs; a fallback for repairs |

**The senior caveat:** every extra store adds operational cost, consistency lag and failure modes.

- Start with Postgres (JSONB, full-text search, pgvector, partitioning) and add specialised stores **when a measured need appears**.
- Be explicit about which store is the **source of truth** for each piece of data.
