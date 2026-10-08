# Frontend System Design

Senior frontend interviews usually include a **45–60 minute design round**: "Design a video-conferencing UI", "Design Google Docs", "Design an autocomplete", "Design a chat app". The interviewer evaluates **structure, trade-off reasoning and depth**, not one correct answer. Your projects map directly onto common prompts, which is a big advantage: **use them**.

## Framework

### How should you structure a frontend system design answer? 🔥

Use a repeatable framework. **RADIO** works well:

1. **R — Requirements (5–8 min)**
   - **Functional:** the core features. Agree on the **MVP scope** and say what's out of scope.
   - **Non-functional:** scale (users, items, participants), performance targets (LCP, INP), devices and browsers, offline support, a11y, i18n, security and privacy, SEO.
   - Ask clarifying questions. **Write the requirements down.**
2. **A — Architecture (8–10 min):** a high-level diagram: client layers (UI components, state, data/network layer, media and real-time layer, service worker), servers and APIs, CDN, real-time channels. Explain the **responsibilities** of each box.
3. **D — Data model (5 min):** entities, client state shape (normalised), what's server state vs client state vs URL state, caching.
4. **I — Interface / API (5–8 min):** API design (REST/GraphQL/WebSocket messages), pagination, error format, component APIs (props) for key components.
5. **O — Optimisations and deep dives (15+ min):**
   - performance (rendering, network, bundle)
   - **reliability** (offline, retries, reconnection)
   - **a11y**, i18n, security, observability, testing
   - **trade-offs and alternatives**

**Tips:**

- **Drive the conversation.** Propose a plan up front ("I'll cover requirements, architecture, data, APIs, then deep-dive into X").
- **Go deep where you're strong** (real-time, media, editors, large lists).
- **Quantify** ("50 tiles at 30 fps is about 1,500 frames per second of decode work, so we need last-N and pagination").
- **State trade-offs explicitly** ("polling is simpler; WebSocket gives lower latency at the cost of connection management").

## Real-time & media

### Design a video-conferencing web client (like MeetHour/Zoom/Meet) 🔥

**1. Requirements**

- **Functional (MVP):**
  - pre-join screen (device check, name)
  - join a room; audio/video; mute/unmute; camera on/off
  - **screen share**
  - **tile and speaker views**
  - participant list, chat, raise hand
  - moderator controls (mute others, kick, lobby)
  - **recording and streaming** status
  - reconnect after network drops
- **Non-functional:**
  - **< 300 ms** glass-to-glass latency
  - up to **100 interactive participants**; **webinars with 10k viewers** (visitors)
  - works on mid-range laptops and mobile
  - Chrome, Firefox, Safari, Electron
  - accessible (keyboard, screen readers, captions)
  - secure (JWT rooms, E2EE option)
  - observable (join success rate, call quality)

**2. Architecture**

```text
┌──────────────────────────── Browser / Electron ────────────────────────────┐
│ UI (React): PreJoin · Stage/TileView · Toolbar · Panels (chat, people)      │
│        ▲ selectors                         │ actions                        │
│ State (Redux): conference, participants{byId}, sources, recordingSessions, │
│        settings, layout · server-state cache (SWR) for REST data           │
│        ▲ events → actions (middleware)     │ commands                       │
│ Media/Signalling layer (lib-jitsi-meet-like): XMPP over WebSocket,         │
│   RTCPeerConnection to SFU, tracks registry (non-serialisable), stats      │
│ Workers: virtual background (WASM/OffscreenCanvas), E2EE, timers           │
└───────────────┬─────────────────────────────────────────┬──────────────────┘
       WSS (signalling)                          SRTP/UDP (media) / TURN 443
         Prosody + Jicofo  ── Colibri2 ──►  SFU (JVB) cluster (cascaded)
         REST API (meetings, recordings) · Jibri pool · TURN · CDN for static app
```

**3. Data model (client)**

- `participants: { byId: { [id]: { name, role, audioMuted, videoMuted, handRaisedAt, sourceIds[], connectionQuality } }, ids[] }`
- `sources: { [sourceName]: { participantId, type: 'camera'|'screen', muted, videoType } }`
- **The media registry** lives **outside Redux**: `Map<sourceName, JitsiTrack/MediaStreamTrack>`.
- `layout: { mode: 'tile'|'stage', pinnedId, page }`, `recording: { sessions: { [id]: { mode, status, error } } }`, `localDevices: { mic, camera, speaker }`.
- **Ephemeral, high-frequency data** (audio levels, stats) goes in a separate subscription store, throttled.

**4. Interfaces**

- **Signalling:** XMPP MUC presence for participant state; IQs for actions (start recording, mute others) that need **server authorisation**; Jingle for media negotiation; a bridge channel for receiver constraints and dominant speaker.
- **REST:** `POST /meetings`, `GET /meetings/:id`, `GET /recordings?meetingId=` (cursor pagination), a token endpoint for room JWTs and TURN credentials.

**5. Deep dives**

- **Scaling the UI to many participants:**
  - **Pagination of the tile view** (e.g. 25 tiles per page), **last-N** at the SFU, and **receiver constraints** asking only for visible tiles at the resolution actually displayed. Thumbnails get the 180p layer; the speaker gets 720p.
  - **Virtualised participant list.** **Memoised tiles keyed by stable IDs**, and `<video>` elements attached once per track.
  - **Audio levels** don't go through Redux (rAF-batched DOM updates).
- **Tile layout algorithm:** choose rows and columns to **maximise tile size** for the container and aspect ratio (runnable code below). Recompute on resize with `ResizeObserver`.
- **Reliability:**
  - XMPP **stream management**/resumption; **ICE restart** on network change
  - a reconnect UI ("Reconnecting…" overlay, keeping local state)
  - **P2P → SFU** switching for 1:1 calls
  - graceful degradation: lower simulcast layers, audio-only mode on poor networks
- **Devices:** a pre-join test (mic level, camera preview, speaker test), `devicechange` handling, **`replaceTrack`** to switch devices without renegotiation, and permission error UX (`NotAllowedError`, `NotReadableError`).
- **Screen share:** a **second source** (multi-stream), `contentHint='detail'`, priority on stage, and annotations (Electron).
- **Large events:** **visitors** (receive-only, separate signalling nodes), promote-to-speaker, and an **HLS fallback** for 10k+ viewers.
- **Security:** a JWT-scoped room, server-enforced roles, lobby, E2EE option, CSP, sanitised chat.
- **A11y:** keyboard shortcuts, live-region announcements, captions, focus management in panels, and a non-colour-only speaking indicator.
- **Observability:** time-to-join, ICE failure rate, % of calls on TURN, average bitrate, freeze rate, `qualityLimitationReason` distribution, JS errors. Use **rtcstats**-style telemetry with consent.
- **Testing:** reducer and selector unit tests, component tests with a mocked media layer, Playwright E2E with fake devices and multiple contexts.

```js
// Best grid for N tiles in a W×H container: maximise tile area while keeping the aspect ratio
function bestGrid({ width, height, count, aspect = 16 / 9, gap = 8 }) {
  let best = null;
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    let tileW = (width - gap * (cols - 1)) / cols;
    let tileH = tileW / aspect;
    if (tileH * rows + gap * (rows - 1) > height) {   // too tall: fit by height instead
      tileH = (height - gap * (rows - 1)) / rows;
      tileW = tileH * aspect;
    }
    if (tileW <= 0 || tileH <= 0) continue;
    const area = tileW * tileH;
    if (!best || area > best.area) best = { cols, rows, tileW: Math.floor(tileW), tileH: Math.floor(tileH), area };
  }
  return best;
}

for (const n of [1, 2, 4, 5, 9, 16, 25]) {
  const g = bestGrid({ width: 1280, height: 720, count: n });
  console.log(`${String(n).padStart(2)} tiles -> ${g.cols}x${g.rows} grid, each ${g.tileW}x${g.tileH}`);
}

test('layout picks sensible grids', () => {
  expect(bestGrid({ width: 1280, height: 720, count: 4 })).toMatchObject({ cols: 2, rows: 2 });
  expect(bestGrid({ width: 1280, height: 720, count: 2 })).toMatchObject({ cols: 2, rows: 1 });
  expect(bestGrid({ width: 390, height: 844, count: 2 })).toMatchObject({ cols: 1, rows: 2 });   // portrait phone
});
```

### Design a chat / messaging feature (in-meeting or standalone) 🔥

**Requirements:**

- **Functional:** send and receive in real time, history with infinite scroll upward, **optimistic sending** with retry, typing indicators, read receipts/unread counts, attachments, reactions, edit/delete, mentions.
- **Non-functional:** ordering, no duplicates, offline tolerance, large histories, a11y.

**Architecture:**

- **Transport:** WebSocket (or XMPP MUC `groupchat` in meetings) for live messages; REST for **history pages** (`GET /channels/:id/messages?before=<cursor>&limit=50`).
- **State:** messages normalised by ID plus a per-channel ordered ID list; **server state** cached (TanStack/SWR infinite queries) and **merged** with live events.

**Key details:**

- **Optimistic send:**
  - generate a **client message ID** (UUID) and render immediately as `sending`
  - when the server **acks** with the canonical ID and server timestamp, replace or merge
  - on failure show `failed` with **Retry**
  - **dedupe** by client ID when the echo arrives
- **Ordering:** sort by **server timestamp/sequence** (client clocks are unreliable). Insert late-arriving messages in order.
- **Pagination:** **cursor-based** (stable under inserts, unlike offset). Keep the scroll position when prepending older messages (measure scroll height before and after), and auto-scroll to the bottom only if the user was already near the bottom.
- **Rendering:** a **virtualised list** with dynamic heights (TanStack Virtual, react-virtuoso's reverse mode). Group consecutive messages by sender and time.
- **Unread:** track `lastReadMessageId` per user. An IntersectionObserver marks messages as read when they're visible and the tab is focused. Show a "New messages" divider.
- **Offline:** queue sends in IndexedDB and flush on reconnect. On reconnect, fetch messages since the last known ID to fill gaps.
- **Security:** sanitise and escape (render text, linkify safely), rate-limit, size limits, scan attachments, and upload them via pre-signed URLs.
- **A11y:** the message list as `role="log"` with `aria-live="polite"` (throttled), keyboard navigation between messages, and an accessible name for each message ("Asha, 10:42: …").

### Design a collaborative editor (Google Docs-lite, or the scQuill transcript editor) 🔥

**Requirements:** multiple users edit the same document simultaneously, presence (cursors, selections), offline edits merged later, version history, comments, permissions, export.

**Core decision: the concurrency model.**

- **OT** (server-ordered operations; Google Docs, Etherpad, CKEditor 5 real-time collaboration) vs **CRDT** (Yjs/Automerge; peer-friendly, offline-first).
- For a new build, **Yjs** + an editor binding (ProseMirror/Tiptap, CodeMirror, Monaco, Lexical) + **y-websocket** or a hosted provider is pragmatic.
- See the WebSockets doc for the trade-offs.

**Architecture:**

- **Editor core:** a document model (ProseMirror/CKEditor model) → view.
- **Sync provider:** a WebSocket to a collaboration server that relays updates, **persists snapshots** plus an incremental update log, and authenticates per document.
- **Awareness/presence channel:** cursors, names, colours (ephemeral).
- **Persistence:** periodic snapshots (Yjs state vectors) in DB/S3. **Version history** as snapshots with diffs.

**scQuill-specific deep dive:** words carry **timestamps and confidence as model attributes**, so edits preserve the media alignment. Highlighting the current word uses **markers or decorations**, not document changes, so it doesn't pollute history or collaboration. (Details in the ScaleCapacity doc.)

**Performance:**

- Large documents need incremental rendering (ProseMirror only updates changed nodes).
- Debounce persistence; batch awareness updates (throttle cursor broadcasts to about 10–20 Hz).
- Offload heavy parsing to a worker.

**Conflict UX:** remote cursors with names, "X is editing this paragraph", and graceful handling of permission changes mid-session.

**Security:** per-document ACLs checked on **every** update (not just on connect), audit logs (legal and court use), encryption at rest.

## Classic UI components

### Design an autocomplete / typeahead component 🔥

**Requirements:**

- **Functional:** suggestions as the user types, keyboard navigation, highlight matched text, select to fill, recent searches, customisable rendering.
- **Non-functional:** fast (respond within about 100 ms of the debounce), **no stale results**, minimal requests, accessible (**combobox pattern**), works on mobile.

**Design:**

- **Input handling:** debounce (200–300 ms), plus a minimum query length (1–2 characters). Normalise the query (trim, lower-case).
- **Data:**
  - an **LRU cache** keyed by query (instant back-spacing)
  - optionally **prefix reuse**: filter cached results for `rea` when typing `reac`, if the result set is complete
  - **cancel or ignore stale requests** (AbortController + request IDs)
- **Server API:** `GET /suggest?q=reac&limit=8` returns ranked items with highlight ranges. The server uses a trie or a search index (Elasticsearch/OpenSearch with edge n-grams).
- **Rendering:** a virtualised list for large results (rarely needed for 8–10 items), with memoised rows.
- **Accessibility (WAI-ARIA combobox):**
  - the input has `role="combobox"`, `aria-expanded`, `aria-controls` → listbox, and **`aria-activedescendant`** = the highlighted option's ID
  - options have `role="option"` and `aria-selected`
  - Up/Down move, Enter selects, Escape closes, and Tab closes and moves on
  - announce the result count in a polite live region
- **Edge cases:** IME composition (Chinese/Japanese input: don't query mid-composition, listen for `compositionend`), empty states, errors, offline, very fast typing, clicks outside.

```js
// Typeahead core: debounce + LRU cache + stale-response protection (framework-agnostic, runnable)
function createTypeahead({ search, debounceMs = 150, cacheSize = 50, minLength = 2, onResults }) {
  const cache = new Map();
  let timer = null;
  let latestQuery = '';
  let requests = 0;

  const remember = (q, results) => {
    cache.delete(q);
    cache.set(q, results);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value);   // evict LRU
  };

  return {
    get requests() { return requests; },
    input(raw) {
      const q = raw.trim().toLowerCase();
      latestQuery = q;
      clearTimeout(timer);
      if (q.length < minLength) return onResults(q, []);
      if (cache.has(q)) {                                                  // instant from cache
        const hit = cache.get(q);
        remember(q, hit);
        return onResults(q, hit);
      }
      timer = setTimeout(async () => {
        requests++;
        const results = await search(q);
        remember(q, results);
        if (q === latestQuery) onResults(q, results);                       // ignore stale responses
      }, debounceMs);
    },
  };
}

const catalog = ['react', 'react native', 'redux', 'redux toolkit', 'rxjs', 'remix', 'webrtc', 'websocket'];
const fakeSearch = (q) => new Promise((r) => setTimeout(() => r(catalog.filter((x) => x.startsWith(q))), q.length === 2 ? 120 : 20));

const shown = [];
const ta = createTypeahead({ search: fakeSearch, onResults: (q, res) => shown.push(`${q}: ${res.join(', ') || '∅'}`) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ta.input('r');                 // below min length -> []
ta.input('re'); await sleep(200);
ta.input('red'); await sleep(200);
ta.input('re');                // cached: no request
console.log(shown, 'requests:', ta.requests);

test('debounced, cached and never shows stale results', () => {
  expect(ta.requests).toBe(2);
  expect(shown.at(-1)).toBe('re: react, react native, redux, redux toolkit, remix');
  expect(shown).toContain('red: redux, redux toolkit');
});
```

### Design an infinite-scroll news feed 🔥

**Requirements:** endless feed of posts (text, images, video), new posts indicator, likes and comments with optimistic updates, smooth scrolling on low-end phones, SEO for public posts.

**Design:**

- **Pagination:** **cursor-based** (`?after=<cursor>`). Offset pagination duplicates or skips items when new posts are inserted.
- **Triggering loads:** an **IntersectionObserver sentinel** near the bottom (with `rootMargin` of about 1 screen, to prefetch early), rather than scroll listeners.
- **Rendering:**
  - **virtualise** (dynamic heights measured with ResizeObserver; estimate first)
  - keep the DOM size bounded; recycle media
  - **reserve space** with the image `aspect-ratio` to avoid CLS
  - lazy-load images (`loading="lazy"`, `srcset`), and play videos only when visible (IntersectionObserver), muted autoplay
- **New posts:** poll or push. **Don't** insert at the top while the user is reading (that shifts content). Show a "12 new posts" pill instead, and insert on click.
- **State:** posts normalised by ID; pages as ID lists; interactions as optimistic mutations with rollback. Use an infinite query in SWR/TanStack.
- **Restoration:** keep scroll position and loaded pages when navigating to a post and back (bfcache or cached state plus scroll restoration).
- **SSR** for the first page (SEO, LCP), then hydrate.
- **Performance budget:** content-visibility for off-screen posts, image CDN, `fetchpriority` for the first image, defer third-party embeds.
- **A11y:** the feed pattern (`role="feed"`, `aria-busy` while loading, articles with `aria-posinset`/`aria-setsize`), and keyboard shortcuts for next/previous post.

### Design a data-heavy dashboard/table (e.g. LoadOTR vendors and loads) 🔥

- **Requirements:** tens of thousands of rows, filtering, sorting, column customisation, inline edit, export, real-time status updates, role-based actions.
- **Data:** server-side **filter, sort and paginate** (cursor or page) for large datasets. Client-side only if under about 5k rows. **URL as the source of truth** for filters and sort.
- **Fetching:** TanStack/SWR with keys derived from the filters; `keepPreviousData`; debounce filter input; prefetch the next page.
- **Rendering:**
  - a **headless table** (TanStack Table) plus **row virtualisation** (and column virtualisation for wide tables)
  - sticky header and first column
  - memoised rows; stable cell renderers
- **Real-time:** WebSocket events **patch cached rows** by ID (and flash updated cells). Avoid refetching the whole page.
- **Editing:** inline editing with optimistic updates and validation; **conflict detection** with a version/ETag (`If-Match`), so two dispatchers don't overwrite each other.
- **Export:** a server-side async export job for big data (email or download link), or client-side CSV for the current view in a worker.
- **A11y:** semantic `<table>`, `aria-sort`, keyboard grid navigation (roving tabindex), announcements for sort and filter changes.

### Design a large-document viewer with extracted-field overlays (SCAI/RBF) 🔥

- **Requirements:** view 500-page PDFs or scanned documents, zoom, search text, highlight extracted fields and redactions, side panel of fields synced with the page, works for 100 MB files.
- **Loading:**
  - **PDF.js** with its **worker** (parsing off the main thread)
  - **range requests** (HTTP 206) so the first pages render before the full download
  - `disableAutoFetch`/streaming
  - scanned documents: server-side tiles or per-page images at several resolutions
- **Rendering:**
  - **virtualise pages**: render only pages in or near the viewport into canvases; placeholders with known sizes for the rest
  - re-render at the right scale on zoom (render a low-res preview first, then high-res)
  - **release canvases** of far pages to cap memory
  - text layer for selection and search
- **Overlays:** absolutely positioned boxes using **normalised coordinates** (0–1, as Textract returns), so they're zoom-independent. Hovering a field in the side panel highlights the box and scrolls to it, and vice versa. **Redactions** are previewed as overlays, while **actual redaction happens server-side** (content removal).
- **Search:** text extraction per page in a worker → an index; highlight results; "n of m" navigation.
- **Performance:** OffscreenCanvas where supported; avoid re-rendering all overlays on scroll (CSS transforms on a page container).
- **A11y:** the text layer exposed to screen readers, keyboard page navigation, overlays with accessible names, high-contrast highlight mode.

### Design a resumable large-file upload (recordings, documents) 🔥

- **Requirements:** files up to 5–10 GB, progress, pause and resume, survive network drops and page reloads, parallel uploads, integrity.
- **Design:**
  1. `POST /uploads` → the server starts an **S3 multipart upload** and returns `uploadId` plus the part size (e.g. 8–16 MB).
  2. The client slices the file (`file.slice(start, end)`), requests **pre-signed URLs per part** (in batches), and uploads parts **in parallel with a concurrency limit** (3–6). Track **ETags per part**.
  3. **Retries with backoff per part.** A failure retries only that part.
  4. **Resume:** persist `{ uploadId, completedParts }` in **IndexedDB** keyed by a file fingerprint (name + size + lastModified, or a hash). After a reload, ask the server for the uploaded parts (`ListParts`) and continue.
  5. **Complete:** `POST /uploads/:id/complete` with the part list. The server finalises and verifies (checksums).
- **Progress:** aggregate the bytes of finished parts plus in-flight XHR progress. Show speed and ETA.
- **UX:** a background upload queue that survives route changes (a global store), warn on tab close (`beforeunload`), cancel (abort XHRs + `AbortMultipartUpload`).
- **Security:** short-lived pre-signed URLs scoped per part, content-type checks, malware scanning after upload, size limits enforced server-side.
- **Alternative:** the **tus** protocol (an open resumable-upload standard) with tus-js-client.

## Architecture at scale

### Micro-frontends: when would you use them and how? 🔥

**What they are:** independently developed and **deployed** frontend pieces owned by different teams, composed into one app.

**Composition options:**

- **Build-time** packages (simple, but not independent deploys)
- **Runtime Module Federation** (webpack 5 / Rspack / Vite plugins): shared dependencies such as a single React instance, remotes loaded at runtime
- **single-spa** (routing-based orchestration)
- **iframes** (strong isolation, poor UX integration)
- **Web Components** as integration contracts
- **server-side composition** (edge includes)

**When they're worth it:**

- **many teams** that need **independent release cycles** on a large product
- legacy migrations (strangler pattern)
- very different domains

**Costs:**

- duplicated dependencies and bundle bloat
- version skew (React versions, design system)
- shared state and routing complexity
- performance overhead
- harder E2E testing and observability
- the risk of inconsistent UX

**Senior answer:**

> "Start with a well-structured monolith or monorepo with clear module boundaries and ownership. Adopt micro-frontends only when organisational scaling requires independent deploys, and then standardise on a shared design system, a single framework version (as a federated singleton) and contracts for communication: events, URL, a minimal shared state."

### How do you design and maintain a component library / design system? 🔥

- **Foundations:** **design tokens** (colour, spacing, typography, radius, shadows, motion) as CSS variables, generated from a source of truth (Figma Variables → Style Dictionary). Themes (light, dark, brand) swap token values.
- **Components:**
  - **accessible by default** (built on headless primitives such as Radix, React Aria or Ark)
  - composable APIs (compound components, `asChild`/slots), controlled and uncontrolled support
  - **polymorphic** `as` props where sensible
  - consistent naming and props
- **Documentation:** **Storybook** with usage guidelines, do's and don'ts, a11y notes, interactive controls, MDX.
- **Quality:**
  - unit and interaction tests (Storybook play functions / RTL)
  - **visual regression** (Chromatic, Playwright screenshots)
  - **a11y checks** (axe in CI)
  - type safety
- **Distribution:**
  - a monorepo package with **semantic versioning**, changesets and changelogs
  - tree-shakeable ESM builds
  - CSS strategy (CSS Modules/vanilla-extract/Tailwind preset)
  - **codemods** for breaking changes
- **Governance:** contribution model, RFCs for new components, adoption metrics, a deprecation policy.

### How do you organise a large frontend codebase (monorepo, module boundaries)?

- **Monorepo tools:** **pnpm workspaces** + **Turborepo** or **Nx** (task caching, affected builds, dependency graph, boundary lint rules).
- **Structure by feature/domain**, not by type: `features/recording/{components, hooks, state, api}` rather than global `components/` and `reducers/` folders. Shared code lives in `packages/ui`, `packages/utils`, `packages/api-client`.
- **Enforce boundaries:** ESLint import restrictions (`eslint-plugin-boundaries`, Nx module boundaries). Features expose a public `index.ts`.
- **Shared configs:** tsconfig, ESLint and Prettier presets. **Generated API clients** from OpenAPI/GraphQL schemas.
- **CI:** only build and test affected projects; remote caching; preview deployments per PR.

### How do you approach i18n and localisation?

- A library with **ICU MessageFormat** (FormatJS/react-intl, i18next with ICU, Lingui): plurals, gender/select, interpolation. **Never concatenate translated fragments.**
- **`Intl` APIs** for dates, numbers, currency, relative time and lists (`Intl.DateTimeFormat`, `NumberFormat`, `RelativeTimeFormat`, `PluralRules`, `ListFormat`, `Segmenter`).
- **RTL support:** `dir="rtl"`, CSS **logical properties**, mirrored icons where meaningful.
- **Loading:** split translations per locale and per route; lazy-load; fall back to a default locale; detect the locale from user settings or `Accept-Language`.
- **Workflow:** extract message IDs, a translation management system (Crowdin, Lokalise), pseudo-localisation to catch truncation and hard-coded strings, screenshot reviews.
- **Testing:** layouts with **long strings** (German) and RTL, and time-zone handling.

### How do you design for observability and safe releases on the frontend? 🔥

- **Error tracking:** Sentry/Datadog with **source maps** uploaded privately, release tagging, user and session context (privacy-aware), breadcrumbs.
- **RUM / performance:** Core Web Vitals per route, custom metrics (**time-to-join** a meeting, time to first frame, upload throughput), segmented by device, browser, region and release.
- **Product analytics:** events with a schema, and consent management.
- **Logging:** structured client logs for complex flows (join → ICE → media), sampled and shipped with `sendBeacon`. Correlation IDs that pass to the backend (trace headers / OpenTelemetry).
- **Feature flags:** LaunchDarkly, Unleash or GrowthBook. **Gradual rollouts**, kill switches, A/B experiments. Decouple deploy from release.
- **Release safety:** preview environments per PR, canary or percentage rollouts, automated **rollback** on error-rate spikes, version-skew handling (old clients talking to a new API; chunk-load error recovery).

### How do you build an offline-first web app?

- A **service worker** pre-caches the app shell and assets (Workbox) and caches API GETs (stale-while-revalidate).
- Use **IndexedDB as the local source of truth** for user data (Dexie or RxDB). The UI reads locally (instant), and sync happens in the background.
- An **outbox/sync queue** stores mutations made offline (with client-generated IDs) and replays them on reconnect (Background Sync API where supported, plus `online` events).
- **Conflict resolution:** last-write-wins with timestamps for simple fields, **CRDTs** for collaborative data, or server-side merge with user prompts.
- **UX:** clear offline indicators, pending-sync badges, and failed-sync recovery.
- **Storage limits:** request persistent storage and handle eviction.

### REST vs GraphQL vs tRPC vs BFF: how do you choose an API style for the frontend?

| | Strengths | Weaknesses | Good fit |
|---|---|---|---|
| **REST** | Simple, cacheable (HTTP caching, CDNs), universal | Over- and under-fetching, many round trips for complex screens | Public APIs, CRUD, file transfer |
| **GraphQL** | Client chooses fields; one request for nested data; typed schema; subscriptions | Caching is harder (normalised client cache); N+1 risks on the server; query cost control | Many clients with different data needs, complex graphs |
| **tRPC** | End-to-end TypeScript types without codegen | TS-only, tight coupling between client and server | Full-stack TS monorepos (Next.js) |
| **BFF** (backend-for-frontend) | Tailored endpoints per client (web, mobile), aggregates microservices, keeps tokens server-side | Another service to own | Complex UIs over many microservices; security-sensitive SPAs |

**Pagination:**

- **Cursor-based** for feeds and real-time data (stable)
- offset for admin tables with page numbers (simple, but it shifts under inserts)

**Errors:** a consistent problem format (RFC 9457 `application/problem+json`) with machine-readable codes for i18n.
