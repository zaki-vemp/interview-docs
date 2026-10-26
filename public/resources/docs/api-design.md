# API Design: REST, GraphQL, gRPC & Webhooks

As a frontend-heavy full-stack developer, you've **consumed** many APIs: React clients, Electron apps, SWR and RTK Query, the Jitsi signalling layer. Interviewers now want to know whether you can **design** them. They ask questions like these:

- Status codes and error formats.
- PUT vs PATCH.
- Pagination.
- Versioning.
- Concurrency control.
- Long-running operations.
- GraphQL and its N+1 problem.
- When gRPC beats REST.
- How to build webhooks that providers and consumers can trust.

> **JSON Merge Patch, list-query parsing with opaque cursors, ETag concurrency control, a DataLoader and HMAC-signed webhooks** are implemented in **runnable JavaScript with tests**.

## REST fundamentals

### What makes an API RESTful, and how RESTful do APIs need to be? 🔥

**REST** (Roy Fielding, 2000) is an **architectural style** defined by six constraints:

1. **Client–server:** UI and data storage concerns are separated.
2. **Stateless:** each request carries everything needed to process it (auth token, parameters). The server keeps no client session state between requests. This is what lets you put any instance behind a load balancer.
3. **Cacheable:** responses say whether they can be cached (`Cache-Control`, `ETag`).
4. **Uniform interface:**
   - Resources are identified by URIs.
   - They're manipulated through **representations** (JSON).
   - Messages are **self-descriptive** (methods, media types, status codes).
   - **HATEOAS** (hypermedia drives state transitions).
5. **Layered system:** clients can't tell whether they're talking to the server or to proxies, caches or gateways.
6. **Code on demand** (optional): servers can send executable code.

**The Richardson Maturity Model:**

| Level | What it means |
|---|---|
| **Level 0** | One endpoint, RPC over HTTP (`POST /api` with an action in the body) |
| **Level 1** | Resources (`/meetings/42`) |
| **Level 2** | **HTTP verbs and status codes used properly.** Most "REST APIs" are here, and that's fine |
| **Level 3** | Hypermedia controls: responses include links to the next possible actions |

**Pragmatic answer:** "I aim for Level 2: resource-oriented URLs, correct methods, correct status codes, standard error format, caching headers. I add links where they help (pagination `next` links), but full HATEOAS is rarely worth it for first-party SPAs."

### How do you design resource URLs, including actions that aren't CRUD? 🔥

**Conventions:**

- **Nouns, plural collections:** `/meetings`, `/meetings/42`, `/meetings/42/participants`.
- **Nest one level** for true sub-resources (`/meetings/42/recordings`). Beyond that, use top-level resources plus filters: `/recordings?meetingId=42`, not `/orgs/1/meetings/42/recordings/9/files/3`.
- **lowercase-kebab-case paths**. Pick camelCase or snake_case for JSON fields and **be consistent**.
- **IDs are opaque strings** to clients, even if they're numbers internally.
- **No verbs in paths** for CRUD: `POST /meetings`, not `/createMeeting`.

**Actions that aren't CRUD.** Real APIs have operations like "start recording", "admit from lobby" and "approve a webinar registration". The options:

| Style | Example | Notes |
|---|---|---|
| **Model the action as a resource (noun)** | `POST /meetings/42/recordings` → 201 with a recording resource; `DELETE /meetings/42/recordings/7` to stop | The most RESTful. The action produces something you can GET (status, duration, file) |
| **State change via PATCH** | `PATCH /webinar-registrations/9 { "status": "approved" }` | Good when the action **is** a state transition on an existing resource |
| **Controller sub-resource** | `POST /meetings/42/actions/end`, or Google-style `POST /meetings/42:end` | Accepted for genuinely procedural operations (end, resend-invite, regenerate-key) |

**Avoid:** `GET /meetings/42/delete` (GET must be safe), and RPC-style endpoint soup (`/api/doThing`).

### What are the semantics of HTTP methods? PUT vs PATCH 🔥

| Method | Safe (no state change) | Idempotent (repeating has the same effect) | Typical use |
|---|---|---|---|
| `GET` | ✅ | ✅ | Read |
| `HEAD` | ✅ | ✅ | Headers only (existence, size, ETag) |
| `OPTIONS` | ✅ | ✅ | Capabilities, **CORS preflight** |
| `POST` | ❌ | ❌ | Create (server assigns the id), actions, non-idempotent operations |
| `PUT` | ❌ | ✅ | **Replace** the whole resource at a known URI (or create it there) |
| `PATCH` | ❌ | ❌ by definition (can be idempotent depending on the format) | **Partial update** |
| `DELETE` | ❌ | ✅ | Remove (a second DELETE: 404 or 204, same end state) |

**Why idempotency matters:**

- Clients, proxies and SDKs **retry on timeouts**.
- Retrying a PUT or DELETE is safe.
- Retrying a POST can create duplicates, unless you use **Idempotency-Key** (see [Transactions & Locking](/docs/db-transactions-locking)).

**PATCH formats:**

- **JSON Merge Patch** (RFC 7396, `application/merge-patch+json`): send the fields to change, and **`null` means delete**. Simple. Arrays are replaced wholesale, and you can't set a value to `null`.
- **JSON Patch** (RFC 6902, `application/json-patch+json`): a list of operations (`[{ "op": "replace", "path": "/title", "value": "x" }, { "op": "add", "path": "/tags/-", "value": "demo" }, { "op": "test", … }]`). Precise array edits and atomic `test` preconditions, but more complex.

```js
// JSON Merge Patch (RFC 7396): null removes a member, objects merge recursively, everything else replaces
function mergePatch(target, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const result = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

const meeting = { title: 'Standup', settings: { lobby: true, recording: 'manual' }, tags: ['team', 'daily'], notes: 'old' };
const patch = { title: 'Daily standup', settings: { recording: 'auto' }, tags: ['team'], notes: null };

test('merges objects, replaces arrays, and deletes on null', () => {
  expect(mergePatch(meeting, patch)).toEqual({
    title: 'Daily standup',
    settings: { lobby: true, recording: 'auto' },   // nested merge keeps lobby
    tags: ['team'],                                 // arrays are replaced, not merged
  });
});
test('a merge patch is idempotent (safe to retry)', () => {
  const once = mergePatch(meeting, patch);
  expect(mergePatch(once, patch)).toEqual(once);
});
test('RFC 7396 examples', () => {
  expect(mergePatch({ a: 'b' }, { a: 'c' })).toEqual({ a: 'c' });
  expect(mergePatch({ a: ['b'] }, { a: 'c' })).toEqual({ a: 'c' });
  expect(mergePatch({ a: { b: 'c' } }, { a: { b: 'd', c: null } })).toEqual({ a: { b: 'd' } });
  expect(mergePatch(['a', 'b'], ['c', 'd'])).toEqual(['c', 'd']);
});
```

### Which status codes should an API use, and when? 🔥

| Code | Use it for | Common mistakes |
|---|---|---|
| **200 OK** | Successful GET/PUT/PATCH with a body | Returning 200 with `{ "error": … }` in the body |
| **201 Created** | POST that created a resource. Include a **`Location`** header with the new URL, plus the body | Returning 200 for creates |
| **202 Accepted** | The request was accepted for **async processing** (return a status URL) | Doing the long work synchronously and timing out |
| **204 No Content** | Success with no body (DELETE, some PUTs) | Sending a body with 204 |
| 301 / 308 | Permanent redirect (308 keeps the method and body) | Using 301/302 for POST, which turns it into a GET |
| 302 / 307 | Temporary redirect (307 keeps the method) | |
| **304 Not Modified** | Conditional GET: the cached copy is still valid | |
| **400 Bad Request** | Malformed syntax: invalid JSON, wrong types, a bad query parameter | |
| **401 Unauthorized** | **Not authenticated**: missing or invalid or expired credentials (send `WWW-Authenticate`) | Using 401 for "logged in but not allowed" |
| **403 Forbidden** | **Authenticated but not allowed** | |
| **404 Not Found** | The resource doesn't exist, **or you don't want to reveal it exists** (other tenants' data) | Returning 403 for other tenants' ids, which leaks their existence |
| 405 Method Not Allowed | Wrong method for this resource (include an `Allow` header) | |
| 406 / 415 | Can't produce the `Accept` type / unsupported `Content-Type` | |
| **409 Conflict** | A conflict with the current state: duplicate unique value, invalid state transition (ending an already-ended meeting) | |
| 410 Gone | Permanently removed (deprecated API versions) | |
| **412 Precondition Failed** | An `If-Match` ETag didn't match: someone else changed the resource | |
| **422 Unprocessable Content** | Syntactically valid, but **semantically invalid** (end before start, business rule failed) | Many APIs simply use 400 for all validation errors. Pick one rule and be consistent |
| 428 Precondition Required | The server requires a conditional request (`If-Match`) | |
| **429 Too Many Requests** | Rate limited. Send **`Retry-After`** | |
| **500** | An unexpected server bug | Leaking stack traces |
| **502 Bad Gateway** | An upstream returned an invalid response (proxy/gateway view) | |
| **503 Service Unavailable** | Overloaded or in maintenance; temporary (send `Retry-After`) | |
| **504 Gateway Timeout** | An upstream didn't answer in time | |

**Retries:** clients should retry **408, 429, 502, 503, 504** (with backoff) but **not 4xx validation errors**. Design SDKs and frontends accordingly.

### How should an API return errors? (RFC 9457 Problem Details) 🔥

Use a **consistent, machine-readable error format**. The standard is **Problem Details for HTTP APIs (RFC 9457**, which obsoletes RFC 7807), with media type `application/problem+json`:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json

{
  "type": "https://api.meethour.example/problems/validation-error",
  "title": "Your request is not valid.",
  "status": 422,
  "detail": "2 fields failed validation.",
  "instance": "/meetings",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    { "pointer": "/start", "code": "must_be_future", "message": "start must be in the future" },
    { "pointer": "/durationMin", "code": "too_small", "message": "must be at least 5" }
  ]
}
```

**Guidelines:**

- **`type`** is a stable URI identifying the error class. It's documented, and clients branch on it (or on a stable `code`), **never on the message text**.
- Add **extension members** for details: a field errors array, `traceId`, `retryAfter`.
- **Never leak internals:** no stack traces, SQL or internal hostnames. Log them server-side with the `traceId`, and return the id so support can correlate.
- **Map errors in one place** (error middleware or exception filter), from typed domain errors to status and problem type.
- **Field errors should point to the input location** (a JSON Pointer `/start`), so a React form can highlight the exact field.

Spring 6+/Boot 3+ ships `ProblemDetail`. In NestJS, use exception filters. In Express, use error middleware.

### How do you design pagination, filtering and sorting for list endpoints? 🔥

**Pagination styles:**

| Style | Request | Pros | Cons |
|---|---|---|---|
| **Offset / limit** | `?offset=40&limit=20` (or `page`/`pageSize`) | Jump to page N; easy totals | Slow at deep offsets; **items shift** when data changes (duplicates or skips) |
| **Cursor (keyset)** | `?cursor=eyJjIjoi…&limit=20` | **Stable and fast at any depth**; good for feeds and infinite scroll | No random page access; cursors are opaque |

**Response shape:**

```json
{
  "data": [ { "id": "m_981", "title": "Sprint review", "startsAt": "2026-10-09T05:30:00Z" } ],
  "page": { "nextCursor": "eyJzIjoiMjAyNi0xMC0wOVQwNTozMDowMFoiLCJpZCI6OTgxfQ", "hasMore": true, "limit": 20 }
}
```

Optionally add a `Link: <https://api.example.com/meetings?cursor=…>; rel="next"` header (RFC 8288).

**Filtering, sorting and fields:**

- **Filtering:** `?status=live&hostId=7`, or a bracket style: `?filter[status]=live&filter[startsAt][gte]=2026-10-01`.
- **Sorting:** `?sort=-startsAt,title` (a `-` prefix means descending). **Whitelist sortable fields**, because each needs an index (and it prevents SQL injection via ORDER BY).
- **Sparse fieldsets:** `?fields=id,title,startsAt` reduces payload size.
- **Expansion:** `?expand=host,recordings` embeds related resources on demand (Stripe-style). Cap the depth.
- **Limits:** a default `limit` (20) and a **maximum** (100). Clamp silently or return 400, but never let clients request 1,000,000 rows.

```js
// Parse and validate list query params; opaque base64url cursors
class ApiError extends Error { constructor(status, detail) { super(detail); this.status = status; } }
const SORTABLE = new Set(['startsAt', 'createdAt', 'title']);

const encodeCursor = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function decodeCursor(s) {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const obj = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    if (typeof obj !== 'object' || obj === null || !('id' in obj)) throw new Error('shape');
    return obj;
  } catch {
    throw new ApiError(400, 'Invalid cursor');
  }
}

function parseListQuery(queryString) {
  const p = new URLSearchParams(queryString);
  const rawLimit = Number.parseInt(p.get('limit') ?? '20', 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? 20 : rawLimit, 1), 100);
  const sort = (p.get('sort') ?? '-startsAt').split(',').map((s) => ({ field: s.replace(/^-/, ''), dir: s.startsWith('-') ? 'desc' : 'asc' }));
  const unknown = sort.filter((s) => !SORTABLE.has(s.field)).map((s) => s.field);
  if (unknown.length) throw new ApiError(400, `Unsupported sort field(s): ${unknown.join(', ')}`);
  const filters = {};
  for (const [key, value] of p) {
    const m = key.match(/^filter\[(\w+)\]$/);
    if (m) filters[m[1]] = value;
  }
  const cursor = p.has('cursor') ? decodeCursor(p.get('cursor')) : null;
  return { limit, sort, filters, cursor };
}

test('defaults and clamping', () => {
  expect(parseListQuery('')).toEqual({ limit: 20, sort: [{ field: 'startsAt', dir: 'desc' }], filters: {}, cursor: null });
  expect(parseListQuery('limit=5000').limit).toBe(100);
  expect(parseListQuery('limit=abc').limit).toBe(20);
});
test('sort whitelist and filters', () => {
  const q = parseListQuery('sort=-createdAt,title&filter[status]=live&filter[hostId]=7');
  expect(q.sort).toEqual([{ field: 'createdAt', dir: 'desc' }, { field: 'title', dir: 'asc' }]);
  expect(q.filters).toEqual({ status: 'live', hostId: '7' });
  expect(() => parseListQuery('sort=password')).toThrow('Unsupported sort field(s): password');
});
test('cursors round-trip and reject garbage', () => {
  const c = encodeCursor({ s: '2026-10-09T05:30:00Z', id: 981 });
  expect(c).not.toMatch(/[+/=]/);                               // URL-safe
  expect(parseListQuery(`cursor=${c}`).cursor).toEqual({ s: '2026-10-09T05:30:00Z', id: 981 });
  expect(() => parseListQuery('cursor=%%%not-base64')).toThrow('Invalid cursor');
});
```

**Cursor security:**

- Cursors are **opaque, not secret**. Clients can decode base64.
- If tampering matters, **sign them** (HMAC) or keep server-side cursor state.
- Never put authorisation decisions inside a cursor.

### How do you version an API and evolve it without breaking clients? 🔥

**Versioning strategies:**

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| **URL path** | `/v1/meetings` | Obvious, easy to route and cache, easy to test in a browser | Version is in every URL; "v2 of everything" |
| **Header / media type** | `Accept: application/vnd.meethour.v2+json`, or `Api-Version: 2026-10-01` | Clean URLs; version per representation | Less visible; caches need `Vary` |
| **Query parameter** | `?api-version=2` | Simple (Azure uses it) | Easy to forget |
| **Date-based** (Stripe) | Each account is pinned to a version date; requests can override with a header | Clients upgrade on their own schedule; the server translates between versions | Server-side complexity (version "gates") |

**Breaking vs non-breaking changes:**

| ✅ Non-breaking (additive) | ❌ Breaking |
|---|---|
| Adding an endpoint | Removing or renaming a field or endpoint |
| Adding an **optional** request field | Making an optional field required |
| Adding a response field | Changing a type (`id` number → string), format, or meaning |
| Adding an enum value (*only if clients handle unknown values!*) | Changing default behaviour or status codes |
| Relaxing validation | Tightening validation |

**How to evolve:**

1. **Prefer additive change**, and design clients as **tolerant readers**: ignore unknown fields, and handle unknown enum values with a default branch.
2. Introduce a new version only for real breaking changes. **Run old and new versions side by side.**
3. **Announce deprecation:**
   - Use the `Deprecation` header, plus **`Sunset: Sat, 31 Jan 2027 00:00:00 GMT`** (RFC 8594) with a `Link` to the migration guide.
   - Track which clients still call the old version.
   - Contact them, and **only then** remove it (410 Gone).
4. **Mobile and desktop apps (Electron)** live for years in the wild, so support old API versions longer than you'd support web clients, or force-update with a minimum version check.

### How do you prevent lost updates in an API? ETags and conditional requests 🔥

**The scenario:**

1. Two hosts open the same meeting settings page.
2. Host A saves.
3. Host B saves a few seconds later and **silently overwrites A's changes**.

**Optimistic concurrency with ETags:**

1. `GET /meetings/42` returns `ETag: "v17"` (a version number or a hash of the representation).
2. The client sends `PUT /meetings/42` with **`If-Match: "v17"`**.
3. If the resource changed meanwhile (the ETag is now `"v18"`), the server responds **`412 Precondition Failed`**. The client re-fetches, shows the conflict or merges, and retries.
4. **`If-None-Match: *`** on a PUT means "create only if it doesn't exist" (prevents overwrites).
5. The server can **require** conditional updates by returning `428 Precondition Required` when `If-Match` is missing.

```js
// ETag-based optimistic concurrency control
function etagOf(obj) {                                   // FNV-1a hash of the canonical JSON
  let h = 2166136261;
  for (const ch of JSON.stringify(obj)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `"${(h >>> 0).toString(16)}"`;
}
function createApi(initial) {
  let doc = structuredClone(initial);
  return {
    get: () => ({ status: 200, body: structuredClone(doc), etag: etagOf(doc) }),
    put(body, headers = {}) {
      if (!headers['if-match']) return { status: 428 };
      if (headers['if-match'] !== etagOf(doc)) return { status: 412, body: structuredClone(doc), etag: etagOf(doc) };
      doc = structuredClone(body);
      return { status: 200, body: structuredClone(doc), etag: etagOf(doc) };
    },
  };
}

test('the second writer with a stale ETag gets 412 instead of overwriting', () => {
  const api = createApi({ title: 'Webinar', lobby: true });
  const a = api.get(), b = api.get();                              // both hosts load the same version
  const saveA = api.put({ ...a.body, title: 'Product Webinar' }, { 'if-match': a.etag });
  const saveB = api.put({ ...b.body, lobby: false }, { 'if-match': b.etag });
  expect(saveA.status).toBe(200);
  expect(saveB.status).toBe(412);
  // B reloads, re-applies its change, and succeeds; A's title is preserved
  const fresh = api.get();
  const retry = api.put({ ...fresh.body, lobby: false }, { 'if-match': fresh.etag });
  expect(retry.status).toBe(200);
  expect(retry.body).toEqual({ title: 'Product Webinar', lobby: false });
});
test('unconditional writes can be refused', () => {
  expect(createApi({}).put({ x: 1 }).status).toBe(428);
});
```

**Where it's used:** the same idea is behind **S3 conditional writes**, the **Kubernetes `resourceVersion`**, **CouchDB `_rev`**, the JPA `@Version` column, and document editors (scQuill-style transcripts edited by several people).

### How do you design long-running operations (document processing, exports, recordings)? 🔥

**Don't hold an HTTP request open for minutes.** Proxies time out, clients disconnect, and retries duplicate the work.

**The async request-reply pattern:**

```http
POST /documents/88/redactions
Idempotency-Key: 3a7f…                         → 202 Accepted
                                                  Location: /operations/op_51
                                                  Retry-After: 5
                                                  { "id": "op_51", "status": "queued" }

GET /operations/op_51                           → 200 { "id": "op_51", "status": "running", "progress": 0.4 }
GET /operations/op_51                           → 200 { "id": "op_51", "status": "succeeded",
                                                        "result": { "href": "/documents/88/redactions/12" } }
                                                  (or "failed" with a Problem Details error)
```

**How clients learn the result:**

| Mechanism | When |
|---|---|
| **Polling** with `Retry-After` | Simplest, works everywhere |
| **Webhooks / callbacks** | Server-to-server integrations |
| **Server-Sent Events or WebSockets** | Live progress in a UI (an RBF redaction progress bar, recording processing status) |

**Design details:**

- The operation is a **resource**, with a status lifecycle (`queued → running → succeeded | failed | cancelled`).
- Support **cancellation**: `POST /operations/op_51:cancel` or `DELETE`.
- Make the creation **idempotent**.
- **Expire** old operation records.

**This maps to RBF:** upload a PDF, start a redaction job (202), stream progress, then download the redacted file. *[Describe how your RBF pipeline actually reported progress.]*

### How do you design bulk or batch endpoints?

```http
POST /participants:batchInvite
{ "meetingId": "m_42", "invitees": [ { "email": "a@x.com" }, { "email": "bad-email" }, { "email": "c@x.com" } ] }

200 OK
{
  "results": [
    { "index": 0, "status": "created", "id": "inv_1" },
    { "index": 1, "status": "error", "error": { "type": ".../validation-error", "detail": "invalid email" } },
    { "index": 2, "status": "created", "id": "inv_3" }
  ],
  "summary": { "succeeded": 2, "failed": 1 }
}
```

**Decide and document whether a batch is:**

- **Atomic:** all succeed or all fail (one transaction; return 4xx on any failure).
- **Partial:** per-item results. Some APIs use `207 Multi-Status`, but a 200 with per-item statuses is simpler for clients.

**Limits:**

- **Cap the batch size** (e.g. 100 items, with a body size limit).
- **Very large imports** (10,000-row CSVs) become async jobs: upload the file, process it in the background, then report results as a downloadable file.

### How do you serve files and video recordings through an API? 🔥

**Downloads:**

- Prefer **presigned S3/CloudFront URLs**, generated after an authorisation check: `GET /recordings/7/download` returns `302 Location: https://cdn…?signature…`, or JSON with the URL.
- The API server never streams gigabytes.

**Video playback and seeking** uses **HTTP Range requests**:

```http
GET /recordings/7/file
Range: bytes=1048576-2097151

206 Partial Content
Accept-Ranges: bytes
Content-Range: bytes 1048576-2097151/734003200
Content-Length: 1048576
Content-Type: video/mp4
```

- The `<video>` element and download managers rely on `206` responses to seek and resume.
- S3 and CloudFront support this natively.
- For adaptive streaming, use **HLS/DASH** (segments plus a manifest) via MediaConvert or ffmpeg packaging.

**Content headers:**

- `Content-Disposition: attachment; filename="meeting-2026-10-09.mp4"` forces a download.
- `inline` displays the file.
- **Sanitise filenames**, and use `filename*=UTF-8''…` for non-ASCII names.

**Uploads:** use presigned PUT/POST URLs with size and type conditions (see [Node.js in Production](/docs/nodejs-production)).

### How do you authenticate API clients? Compare the options 🔥

| Method | How | Use for |
|---|---|---|
| **Session cookie** | `HttpOnly; Secure; SameSite` cookie → server-side session | **First-party web apps** (BFF). Needs CSRF protection for state-changing requests |
| **Bearer JWT (OAuth 2.0 access token)** | `Authorization: Bearer eyJ…`, verified with the issuer's public keys (JWKS) | SPAs, mobile apps and services behind an IdP (Cognito, Azure AD/Entra ID, Auth0). Short-lived, with refresh tokens |
| **OAuth 2.0 client credentials** | A service exchanges `client_id`/`secret` (or a private-key JWT) for an access token | **Machine-to-machine** calls |
| **API keys** | `Authorization: ApiKey …` or `X-API-Key` | Simple partner integrations and usage metering. **Hash keys at rest**, show them once, scope them, rotate them, prefix them (`mh_live_…`) so leaks can be detected by secret scanners |
| **HMAC request signing** | Sign method + path + body + timestamp with a shared secret (AWS **SigV4**-style) | Tamper-proof requests, webhooks |
| **mTLS** | Client certificates verified at TLS | Internal service meshes, B2B, regulated environments |

**Authorisation, separately:**

- **Scopes** in tokens (`meetings:read`, `recordings:write`) express coarse permissions.
- **Object-level checks** happen on every request (tenant and ownership). **Broken object-level authorisation (BOLA/IDOR) is the #1 API risk in the OWASP API Security Top 10.**

See [Web Security & Authentication](/docs/web-security-auth) for OAuth, PKCE, CORS and CSRF in depth.

### How do you document APIs and keep the contract and implementation in sync? 🔥

**OpenAPI 3.1** is the standard description format for REST: paths, schemas (JSON Schema), auth, examples.

| Approach | How | Pros / cons |
|---|---|---|
| **Design-first** | Write the OpenAPI spec, review it as an API design, then generate server stubs and clients, or validate against the spec | The contract is agreed before the code; parallel FE/BE work with mock servers (Prism); more upfront work |
| **Code-first** | Generate the spec from code: NestJS `@nestjs/swagger`, springdoc-openapi, FastAPI (automatic), `zod-to-openapi` | Always matches the code; design discussions happen in PRs |

**Tooling that keeps the contract honest:**

- **Client generation:** `openapi-typescript` (types), **orval** or openapi-generator (SWR/React Query hooks for the React app).
- **Linting:** **Spectral** with style rules (naming, error format, pagination).
- **Breaking-change detection** in CI: `oasdiff`.
- **Contract tests:** Pact, or validating responses against the schema in integration tests.
- **Docs UIs:** Swagger UI, Redoc, Scalar. **Mock servers:** Prism.

**For GraphQL** the schema *is* the contract (SDL), plus codegen (`graphql-codegen`). **For gRPC**, `.proto` files are the contract.

## GraphQL

### What is GraphQL, and how does it compare to REST? 🔥

**GraphQL** is a query language and runtime:

- The server publishes a **typed schema**.
- Clients send queries that select **exactly the fields they need**, usually to **one endpoint** (`POST /graphql`).
- **Mutations** change data. **Subscriptions** push updates.

```graphql
type Meeting {
  id: ID!
  title: String!
  startsAt: DateTime!
  host: User!
  participants(first: Int = 20, after: String): ParticipantConnection!
  recordings: [Recording!]!
}
type Query { meeting(id: ID!): Meeting, meetings(filter: MeetingFilter, first: Int, after: String): MeetingConnection! }
type Mutation { scheduleMeeting(input: ScheduleMeetingInput!): ScheduleMeetingPayload! }

# Client query: one round trip, only the fields the screen needs
query MeetingCard($id: ID!) {
  meeting(id: $id) {
    title
    startsAt
    host { name avatarUrl }
    recordings { id durationSec }
  }
}
```

| | **REST** | **GraphQL** |
|---|---|---|
| Endpoints | Many resources | One endpoint, one schema |
| Fetching | Fixed shapes: **over-fetching** (too many fields) or **under-fetching** (many round trips) | **Client-selected fields**; nested data in one request |
| Typing | Optional (OpenAPI) | **Built-in typed schema**, introspection, great codegen |
| Caching | **HTTP caching works** (GET + URL) | HTTP caching is hard (POST, one URL). Normalised **client caches** (Apollo, urql, Relay) and persisted queries help |
| Versioning | Versions or additive changes | **Evolve the schema** with `@deprecated`, no versions |
| Errors | HTTP status codes | Usually **200 with an `errors` array**, and partial data is possible |
| Server complexity | Simple per endpoint | Resolvers, **N+1**, query cost control, auth per field |
| Best for | Public APIs, simple CRUD, cacheable resources, file transfer | **Many clients with different data needs** (web, mobile, Electron), aggregating microservices, rapidly evolving product UIs |

### How do resolvers work, and how does DataLoader fix the N+1 problem? 🔥

**Each field has a resolver.** For a list of 50 meetings, the `host` resolver runs **50 times**, which means 50 queries for users: the **N+1 problem**.

**DataLoader** solves it with two mechanisms:

- **Batching:** it collects every `load(key)` call made in the same tick and calls your **batch function once** with all the keys (`SELECT … WHERE id = ANY($1)`).
- **Per-request caching:** the same key requested twice in one request is loaded once. Create **a new loader per request**, so users' data never leaks across requests.

```js
// A minimal DataLoader: batch all loads issued in the same tick, dedupe keys, keep result order
class DataLoader {
  constructor(batchFn) {
    this.batchFn = batchFn;
    this.queue = [];
    this.cache = new Map();
  }
  load(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const promise = new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });
      if (this.queue.length === 1) setTimeout(() => this.dispatch(), 0);   // after the current tick's resolvers have run
    });
    this.cache.set(key, promise);
    return promise;
  }
  loadMany(keys) { return Promise.all(keys.map((k) => this.load(k))); }
  async dispatch() {
    const batch = this.queue;
    this.queue = [];
    try {
      const values = await this.batchFn(batch.map((b) => b.key));
      if (values.length !== batch.length) throw new Error('batchFn must return one value per key, in order');
      batch.forEach((b, i) => (values[i] instanceof Error ? b.reject(values[i]) : b.resolve(values[i])));
    } catch (err) {
      batch.forEach((b) => b.reject(err));
    }
  }
}

// "Database"
const users = { 7: { id: 7, name: 'Zaki' }, 9: { id: 9, name: 'Asha' } };
const queries = [];
async function batchUsers(ids) {
  queries.push(`SELECT * FROM users WHERE id = ANY('{${ids.join(',')}}')`);
  return ids.map((id) => users[id] ?? new Error(`user ${id} not found`));   // same order as the keys
}

// Resolvers for: meetings { title host { name } }
const meetings = [{ title: 'A', hostId: 7 }, { title: 'B', hostId: 9 }, { title: 'C', hostId: 7 }, { title: 'D', hostId: 9 }];

test('N resolvers → ONE batched query, deduplicated keys', async () => {
  queries.length = 0;
  const loader = new DataLoader(batchUsers);                       // per request!
  const hosts = await Promise.all(meetings.map((m) => loader.load(m.hostId)));
  expect(hosts.map((h) => h.name)).toEqual(['Zaki', 'Asha', 'Zaki', 'Asha']);
  expect(queries).toEqual(["SELECT * FROM users WHERE id = ANY('{7,9}')"]);
});
test('a missing key rejects only that load', async () => {
  const loader = new DataLoader(batchUsers);
  const [ok, missing] = await Promise.allSettled([loader.load(7), loader.load(404)]);
  expect(ok.status).toBe('fulfilled');
  expect(missing.status).toBe('rejected');
  expect(missing.reason.message).toBe('user 404 not found');
});
```

**Other N+1 strategies:**

- **Join in the parent resolver** when the child field is requested: look ahead with `info` and a field selection.
- **Persisted JSON from SQL.**
- **Join-monster or Prisma-style query planning.**

**For federation**, the router batches entity lookups (`_entities` queries).

### How do you secure and keep a GraphQL API fast? 🔥

**Risks:**

- Clients control the query, so **one request can be arbitrarily expensive**: deeply nested or cyclic queries (`meeting { participants { user { meetings { participants … } } } }`), huge lists, aliases repeating an expensive field 1,000 times.

**Defences:**

| Defence | How |
|---|---|
| **Depth limit** | Reject queries nested deeper than ~10 levels |
| **Cost / complexity analysis** | Assign costs per field (lists multiply by `first`), reject queries over a budget, and rate-limit by **cost**, not by request count (GitHub's GraphQL API does this) |
| **Pagination required** on lists | `first` max 100; Relay connections |
| **Persisted queries / allowlisting** | Clients send a **hash** of a pre-registered query (APQ, or trusted documents). Arbitrary queries are blocked in production, and payloads get smaller and CDN-cacheable via GET |
| **Introspection off** in public production (or restricted) | Reduces reconnaissance; not real security on its own |
| **Field-level authorisation** | Check permissions in resolvers or with directives (`@auth(requires: HOST)`). Every path to sensitive data must be guarded, including nested ones |
| **Timeouts and batching limits** | Cap batched operations per request; cap alias counts |

**Caching:**

- **Client side:** a normalised cache by `__typename:id` (Apollo, urql, Relay). Mutations update the cache automatically.
- **Server side:** DataLoader (per request), response caching per field (`@cacheControl`), and CDN caching of persisted GET queries.

**Pagination convention:** **Relay connections** (`edges { node cursor } pageInfo { hasNextPage endCursor }`).

### How do errors and schema evolution work in GraphQL?

**Errors:**

- The default is HTTP 200 with `{ "data": {…partial…}, "errors": [{ "message", "path", "extensions": { "code": "FORBIDDEN" } }] }`. A failing field becomes `null` (if nullable) while the rest of the data is returned.
- **Errors as data** for expected business failures, modelled in the schema as **result unions**:

```graphql
union ScheduleMeetingResult = ScheduleMeetingSuccess | ValidationError | QuotaExceededError
type Mutation { scheduleMeeting(input: ScheduleMeetingInput!): ScheduleMeetingResult! }
```

The client gets typed, exhaustive handling of expected errors. Unexpected errors stay in `errors`.

**Evolution:**

- **Add fields freely.**
- **Deprecate** with `@deprecated(reason: "Use startsAt")`, monitor field usage (Apollo Studio / schema analytics), then remove.
- Never change a field's type or nullability incompatibly. **Making a field non-null in output is safe; making an input field non-null is breaking.**

**Federation:**

- **Apollo Federation** (or GraphQL Mesh, or Cosmo) composes **subgraphs owned by different teams/services** into one **supergraph** behind a router.
- Entities are extended across services (`@key(fields: "id")`).
- It's a common microservices front door.

### How do GraphQL subscriptions work, and when would you use them?

**How they work:**

- Subscriptions push events matching a selection set over a **WebSocket**, using the **`graphql-ws`** protocol (the older `subscriptions-transport-ws` is deprecated) or over SSE.
- The server publishes events (via Redis pub/sub or Kafka across instances), and each subscriber's selection set is resolved per event.

**When to use them:**

- **Use** them when the app is already GraphQL-first and needs live updates: chat messages, participant joins, recording status.
- **Consider SSE or plain WebSockets** for very high-frequency streams (media stats, cursor positions), where GraphQL's per-event resolution overhead adds up.
- **Consider** them where you need custom binary protocols. Video and real-time signalling (XMPP/Jingle in Jitsi) stay on dedicated protocols.

## gRPC & other styles

### What is gRPC, and when should you use it? 🔥

**gRPC** is a high-performance RPC framework:

- **Protocol Buffers** (binary, schema-first) are carried over **HTTP/2**, with multiplexed streams and header compression.
- Client and server code is **generated** in many languages from `.proto` files.

```proto
syntax = "proto3";
package meethour.recording.v1;

service RecordingService {
  rpc StartRecording(StartRecordingRequest) returns (Recording);                 // unary
  rpc WatchRecording(WatchRecordingRequest) returns (stream RecordingEvent);     // server streaming
  rpc UploadChunks(stream Chunk) returns (UploadSummary);                        // client streaming
  rpc LiveTranscribe(stream AudioFrame) returns (stream TranscriptSegment);      // bidirectional streaming
}

message StartRecordingRequest {
  string meeting_id = 1;
  RecordingMode mode = 2;
  optional string storage_prefix = 3;
}
enum RecordingMode { RECORDING_MODE_UNSPECIFIED = 0; FILE = 1; STREAM = 2; }
message Recording { string id = 1; string meeting_id = 2; string status = 3; int64 started_at_unix_ms = 4; }
```

**Strengths:**

- Compact binary payloads and fast serialisation.
- **Strong contracts with codegen.**
- **Streaming in both directions.**
- **Deadlines** propagated across calls.
- Standard status codes (`DEADLINE_EXCEEDED`, `UNAVAILABLE`, `NOT_FOUND`…), interceptors, and built-in load balancing.

**Weaknesses:**

- **Browsers can't speak native gRPC.** They need **gRPC-Web** via a proxy (Envoy) or **Connect RPC**.
- Not human-readable: you need `grpcurl` to debug.
- HTTP/2 load balancing needs L7 awareness: long-lived connections pin to one backend.
- A less mature caching story.

**Use it for:**

- **Internal service-to-service** communication in polyglot microservices: a Node API calling a Java or Kotlin recording service, or Python ML services.
- Low-latency, high-throughput, or streaming workloads (live transcription, telemetry).
- Mobile clients with strict bandwidth budgets.

**Keep REST or GraphQL for** public APIs and browsers.

### What are the rules for evolving Protobuf schemas safely?

**Wire compatibility:**

- Protobuf identifies fields by **field number**, not by name.
- **Old readers skip unknown fields**, and **new readers see defaults for missing fields**.
- This gives forward and backward compatibility, **if you follow the rules**.

| ✅ Safe | ❌ Breaking |
|---|---|
| Adding fields with **new numbers** | **Reusing or changing a field number** |
| Removing a field **and reserving its number and name** (`reserved 3; reserved "storage_prefix";`) | Changing a field's type incompatibly (int32 ↔ string) |
| Renaming a field (wire-safe; breaks JSON mapping and generated code) | Changing `repeated` ↔ singular for messages |
| Adding enum values (clients must handle unknown ones; keep `…_UNSPECIFIED = 0`) | Changing the meaning of an existing field |

**Other rules:**

- Use **`optional`** (proto3) when you need to distinguish "unset" from the default (0, `""`).
- **Package versioning:** put the version in the package (`meethour.recording.v1`) and add `v2` for breaking redesigns.
- **Buf** lints protos and detects breaking changes in CI (`buf breaking`).

### REST vs GraphQL vs gRPC vs tRPC vs WebSockets: how do you choose? 🔥

| Need | Best fit | Why |
|---|---|---|
| Public or partner API, cacheable resources, broad tooling | **REST + OpenAPI** | Universal, HTTP caching, easy to consume from anything |
| Many client types (web, mobile, desktop) with different data needs; aggregating many services | **GraphQL** | Client-shaped queries, one round trip, typed schema |
| Internal service-to-service, polyglot, low latency, streaming | **gRPC** | Binary, HTTP/2, codegen, deadlines |
| **Full-stack TypeScript monorepo** (Next.js + Node), one team | **tRPC** | End-to-end types with **no schema or codegen**: call server functions like local functions. TS clients only |
| Real-time bidirectional events (chat, presence, collaborative editing, signalling) | **WebSockets** (Socket.IO, XMPP over WS) | Persistent two-way connection |
| Server → client streaming only (progress, LLM tokens, notifications) | **SSE** | Simple, HTTP-native, auto-reconnect |
| Async integrations between companies | **Webhooks** (+ a REST pull fallback) | Event-driven; no polling |

**Mixing them is normal:**

- REST for the public API.
- GraphQL or a BFF for the React and Electron apps.
- gRPC between internal services.
- WebSockets or XMPP for live meeting features.
- Webhooks for integrations.

### What is tRPC, and when is it a good choice?

**What it is:**

- **tRPC** exposes server procedures (queries and mutations, with zod validation) to TypeScript clients.
- **The types flow straight from the server code into the client** through TypeScript inference. There's no OpenAPI, GraphQL schema or codegen step, and a renamed field is a compile error in the frontend immediately.
- It integrates with **TanStack Query** (`trpc.meeting.byId.useQuery({ id })`).

**Good fit:**

- A full-stack TypeScript monorepo (Next.js, T3 stack).
- One team owns both the frontend and the backend.
- Rapid iteration.

**Poor fit:**

- Public APIs, or non-TypeScript clients (mobile in Kotlin or Swift).
- Strict contract governance across teams.
- **Mitigations exist:** tRPC can expose OpenAPI through adapters, or you can use **oRPC / ts-rest**, which are contract-first with OpenAPI output.

## Webhooks & integration

### How do you design webhooks as a provider? 🔥

**Webhooks** are HTTP callbacks: your system POSTs **events** to customer URLs when something happens (`recording.ready`, `webinar.registration.created`).

**A robust webhook design:**

| Concern | Design |
|---|---|
| **Authenticity** | Sign each delivery: **HMAC-SHA256 over `timestamp + "." + rawBody`** with a per-endpoint secret. Send `Webhook-Signature: t=…,v1=…` (Stripe style) or follow the **Standard Webhooks** spec |
| **Replay protection** | A timestamp in the signature; receivers reject anything older than ~5 minutes |
| **Delivery** | **At-least-once** with **exponential backoff** retries over hours or days (e.g. 1 min, 5 min, 30 min, 2 h …). Timeout each attempt (10 s). Treat any 2xx as success |
| **Idempotency** | A unique **event id** in every payload; receivers dedupe by it |
| **Ordering** | **Not guaranteed** (because of retries). Include `occurredAt` and the resource version, or send **thin events** |
| **Thin vs fat payloads** | **Thin:** `{ type, id, resource: "/recordings/7" }`, and the receiver fetches the current state (always fresh, authorised, ordering-safe). **Fat:** the full object (fewer calls, but it can be stale or out of order) |
| **Versioning** | Versioned event types or payload versions, chosen per endpoint |
| **Operations** | Delivery logs and a dashboard, **manual replay**, auto-disabling endpoints that keep failing (with email), secret rotation (sign with two secrets during rotation) |
| **Security** | Block **SSRF**: validate customer URLs, disallow private IP ranges, resolve DNS **at delivery time** and recheck. HTTPS only |

**Receivers** must verify the signature over the **raw body bytes**. Re-serialising parsed JSON changes whitespace and key order, which breaks the HMAC.

```js
// Signing and verifying webhooks (HMAC-SHA256 over "timestamp.body") with Web Crypto
const enc = new TextEncoder();
async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function timingSafeEqual(a, b) {                              // compare without leaking timing information
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sign(secret, rawBody, timestamp) {
  return `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}
async function verify(secret, rawBody, header, nowSec, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = await hmacHex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, parts.v1 ?? '') ? { ok: true } : { ok: false, reason: 'signature mismatch' };
}

const secret = 'whsec_test_123';
const body = JSON.stringify({ id: 'evt_1', type: 'recording.ready', data: { recordingId: 'rec_7' } });

test('valid signature within the tolerance window', async () => {
  const header = await sign(secret, body, 1_760_000_000);
  expect(await verify(secret, body, header, 1_760_000_100)).toEqual({ ok: true });
});
test('tampered body, wrong secret and replayed deliveries are rejected', async () => {
  const header = await sign(secret, body, 1_760_000_000);
  expect((await verify(secret, body.replace('rec_7', 'rec_8'), header, 1_760_000_000)).reason).toBe('signature mismatch');
  expect((await verify('whsec_other', body, header, 1_760_000_000)).reason).toBe('signature mismatch');
  expect((await verify(secret, body, header, 1_760_000_000 + 3600)).reason).toBe('timestamp outside tolerance');
});
```

### How do you consume webhooks reliably as a receiver? 🔥

This applies to payment providers, Azure AD events, Zoom/YouTube live notifications, and S3 events via HTTP.

1. **Verify the signature on the raw body** before anything else. In Express, use `express.raw({ type: 'application/json' })` on that route, or keep a `verify` callback that stores `req.rawBody`.
2. **Respond 2xx quickly** (in under a few seconds). **Enqueue** the event for background processing. Don't do slow work inline, or the provider times out and retries, causing duplicates.
3. **Dedupe by event id:** a unique constraint on `processed_events(event_id)`, inserted in the same transaction as the side effects.
4. **Handle out-of-order and duplicate events:**
   - Compare versions or timestamps before applying.
   - Or **re-fetch the resource from the provider's API** and act on its current state, which is the most robust approach.
5. **Reconcile periodically.** Webhooks can be lost when endpoints are down for longer than the retry window, so run a nightly job that lists recent objects from the provider's API and fixes drift.
6. **Monitor:** alert on signature failures (a misconfigured secret, or an attack), processing failures and queue backlog.

```node
app.post('/webhooks/payments', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = await verifyAndParse(req.body, req.get('Webhook-Signature'));     // throws → 400
  await db.query(
    `INSERT INTO inbox (event_id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (event_id) DO NOTHING`,
    [event.id, event.type, event]);
  res.sendStatus(200);                                   // ack fast; a worker processes the inbox table
});
```

### What do API gateways and the Backend-for-Frontend pattern do? 🔥

**An API gateway** is a single entry point in front of services. Products include AWS API Gateway, Kong, Apigee, Envoy, NGINX and Azure APIM. It handles cross-cutting concerns:

- **Routing and versioning** (`/v1/recordings/*` → recording service).
- **Authentication** (JWT validation, API keys) and coarse authorisation.
- **Rate limiting, quotas**, usage plans and metering.
- TLS termination, **request/response transformation**, CORS.
- Caching, **observability** (access logs, tracing headers).
- Canary or weighted routing.

**Backend-for-Frontend (BFF):** a backend **per client type** (web, mobile, Electron), owned by the frontend team:

- **Aggregates** several service calls into the exact shape a screen needs, cutting chatty round trips from React.
- Handles **auth sessions** for SPAs: the **BFF holds OAuth tokens server-side** and gives the browser an `HttpOnly` cookie. This is the recommended pattern for browser security, because no tokens live in JS.
- Adapts protocols: GraphQL or REST for the UI, gRPC to internal services.
- Next.js route handlers or server actions often **are** the BFF.

**Risks:**

- Business logic creeping into gateways or BFFs. Keep domain rules in services.
- **Duplicated logic across BFFs.**
- **Gateway as a single point of failure:** make it highly available and keep it thin.

### How do you keep an API backward compatible over years? 🔥

**A checklist:**

1. **Additive changes only** within a version. Treat removal and renaming as breaking.
2. **Tolerant reader on both sides:**
   - Servers ignore unknown request fields (or reject them on purpose, consistently).
   - Clients ignore unknown response fields and **unknown enum values**.
3. **Never change the meaning of an existing field.** Add a new field instead (`startsAt` alongside the deprecated `start`).
4. **Defaults are part of the contract.** Changing a default (page size, sort order) is a behaviour change.
5. **Contract tests** (Pact, consumer-driven) and **breaking-change diffing** in CI (`oasdiff`, `buf breaking`, GraphQL Inspector).
6. **Deprecation process:**
   - Mark fields and endpoints as deprecated in the docs and schema.
   - Send `Deprecation`/`Sunset` headers.
   - Track usage per client.
   - Notify, and remove only once traffic has stopped.
7. **Feature flags and capability negotiation** for gradual rollouts.
8. **Long-lived clients** (Electron and mobile releases that users don't update) set the real deprecation timeline. Enforce a minimum supported client version with a graceful "please update" response.

**One-line summary:** "An API is a promise. I evolve it additively, measure who uses what, and remove things only on a published schedule."
