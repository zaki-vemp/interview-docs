# Browser Internals & Networking

These are the "fundamentals" questions that separate developers who **use** the browser from those who **understand** it: what happens when you type a URL, how pages render, HTTP versions, caching, cookies and storage, service workers, CORS and the DOM event model.

## From URL to pixels

### What happens when you type a URL and press Enter? 🔥

A strong answer walks through **network → server → rendering** and mentions caches at every layer.

1. **URL parsing and HSTS:** the browser parses the URL. If the domain is on the **HSTS** list, it upgrades to HTTPS. It checks the **bfcache, service worker and HTTP cache** for the document first.
2. **DNS resolution:** browser cache → OS cache (and the hosts file) → the configured **recursive resolver** (ISP, 8.8.8.8, or DoH) → root servers → TLD (`.com`) → the **authoritative** nameserver → an `A`/`AAAA` record (possibly via `CNAME`s, e.g. to a CDN). Results are cached according to **TTL**.
3. **Connection:**
   - **TCP 3-way handshake** (SYN, SYN-ACK, ACK) → **TLS 1.3** handshake (**1-RTT**; 0-RTT for resumption): certificate validation against trusted CAs, key exchange (ECDHE), ALPN negotiation of HTTP/2 or HTTP/1.1.
   - With **HTTP/3**, **QUIC** combines transport and TLS in one handshake over **UDP**.
4. **HTTP request:** `GET /` with headers (cookies, `Accept`, `User-Agent`, `Accept-Encoding: br, gzip`).
5. **Server side:** CDN edge (cache hit?) → load balancer → app server (SSR) → databases → response (status, headers, compressed body). Redirects (301/302/307/308) repeat the steps above.
6. **Parsing HTML** into the **DOM**, incrementally as bytes stream in. The **preload scanner** looks ahead and starts downloading discovered resources (CSS, JS, images) early.
   - **CSS** is parsed into the **CSSOM**. It's **render-blocking**: the browser won't paint without it.
   - **Classic `<script>`** without `async`/`defer` **blocks parsing**. It must download and execute first, because it might call `document.write` or read styles.
7. **Render tree:** DOM + CSSOM → visible nodes with computed styles (no `display: none` nodes, `head`, etc.).
8. **Layout (reflow):** compute the geometry (size and position) of each box.
9. **Paint:** create **paint records** (draw calls) for layers. **Rasterisation** happens on raster/GPU threads.
10. **Composite:** the **compositor thread** assembles layers into the final frame on the GPU. Scrolling and `transform`/`opacity` animations can happen here **without the main thread**.
11. **Then:** `DOMContentLoaded` (DOM parsed, deferred scripts run) → `load` (all subresources) → hydration and JS interactivity → idle work. Metrics: **FCP, LCP, INP, CLS**.

### What is the critical rendering path and how do you optimise it? 🔥

The **critical rendering path** is the sequence the browser must complete before the first paint: **HTML → DOM, CSS → CSSOM, render tree → layout → paint**.

**Optimisations:**

- **Minimise render-blocking CSS:**
  - inline **critical CSS** for above-the-fold content
  - load the rest asynchronously (`media` trick or `rel=preload` + `onload`)
  - split CSS per route
  - avoid `@import` in CSS (it creates a sequential waterfall)
- **Unblock parsing:** `defer` or `type="module"` for app scripts, `async` for independent ones. Put non-critical third-party scripts late.
- **Reduce bytes and round trips:** compression (Brotli), HTTP/2/3, `preconnect` to critical origins, **preload** late-discovered critical resources (fonts referenced from CSS, the LCP image).
- **Prioritise:** `fetchpriority="high"` on the LCP image, `low` on below-the-fold carousels.
- **Server:** fast TTB (caching, CDN, SSR/SSG), and stream HTML early (flush the `<head>` first).

### Reflow vs repaint vs composite: what triggers each? 🔥

| Stage | Triggered by changing | Cost |
|---|---|---|
| **Layout (reflow)** | Geometry: `width`, `height`, `padding`, `margin`, `top`/`left`, `font-size`, adding/removing nodes, window resize, **reading** layout properties after writes (forced synchronous layout) | **Highest**: can affect many elements (descendants, siblings, ancestors) |
| **Paint (repaint)** | Visual-only properties: `color`, `background`, `box-shadow`, `visibility`, `outline` | Medium |
| **Composite only** | **`transform`**, **`opacity`** (and `filter` on promoted layers) | **Lowest**: GPU, can run off the main thread |

**Reading layout properties** (`offsetWidth`, `getBoundingClientRect()`, `scrollTop`, `getComputedStyle`) after writes **forces layout immediately**. Interleaving reads and writes in a loop causes **layout thrashing** (see React Performance). Batch reads, then writes (`fastdom`-style), and use `ResizeObserver` and `IntersectionObserver` instead of polling.

### Describe the browser's multi-process architecture

Chromium (and others, broadly) splits work across processes for **stability, security and performance**:

- **Browser process:** UI (tabs, address bar), navigation, permissions, coordination.
- **Renderer processes:** one per **site** (eTLD+1) thanks to **Site Isolation**. Each runs Blink (DOM, CSS, layout), V8 (JS) and the compositor thread for its frames. They're **sandboxed**: no direct file system or network access. **Cross-site iframes** get separate processes, which is the main defence against Spectre-style side-channel attacks.
- **GPU process:** rasterisation and compositing for all tabs.
- **Network service, storage service, audio service**, utility processes, plus extensions.

**Inside a renderer:**

- the **main thread** runs JS, style, layout, paint recording and event handlers
- the **compositor thread** handles scrolling and composited animations
- **raster threads** rasterise tiles
- **workers** get their own threads

This is why **a long JS task blocks interactions** (main thread) but **compositor-driven scrolling can stay smooth**.

### What is the back/forward cache (bfcache), and what makes a page ineligible?

The **bfcache** keeps a **complete snapshot of the page in memory** (including the JS heap) when you navigate away, so Back/Forward restores it **instantly** without reloading. It's a big performance win.

**What makes a page ineligible** (varies by browser):

- **`unload` event handlers** (deprecated; use `pagehide`/`visibilitychange`)
- `Cache-Control: no-store` on the document (historically; Chrome has been relaxing this)
- **open WebSocket, WebRTC or WebTransport connections**, so meeting pages normally aren't cached
- pending IndexedDB transactions, `BroadcastChannel`, and some others

**Handling it:**

- listen for `pageshow` with `event.persisted === true` to refresh stale data
- use `pagehide` to clean up
- check eligibility in **DevTools → Application → Back/forward cache**

## HTTP & networking

### HTTP/1.1 vs HTTP/2 vs HTTP/3 🔥

| | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| Transport | TCP (+TLS) | TCP + TLS (in practice) | **QUIC over UDP** (TLS 1.3 built in) |
| Multiplexing | ❌ One request at a time per connection; browsers open **~6 connections per host** | ✅ Many **streams over one connection** | ✅ Independent streams |
| Head-of-line blocking | At the HTTP level (requests queue) | **At the TCP level**: one lost packet stalls **all** streams | **None** across streams (QUIC handles loss per stream) |
| Headers | Plain text, repeated | **HPACK** compression | **QPACK** |
| Prioritisation | — | Stream priorities (complex) → replaced by **Extensible Priorities** (`Priority` header) | Extensible Priorities |
| Server push | — | Existed, but **removed from Chrome** (rarely beneficial) → use `103 Early Hints` + preload | Not used |
| Handshake | TCP + TLS (2–3 RTT) | Same | **1-RTT**, **0-RTT** resumption; **connection migration** (Wi-Fi → 4G without reconnecting, using connection IDs) |

**Practical consequences:**

- Under HTTP/2/3, domain sharding and aggressive bundling or spriting are less important, though bundling still helps with compression and request overhead.
- HTTP/3 helps most on **lossy mobile networks**.

### How does HTTP caching work? Explain `Cache-Control`, ETags and revalidation 🔥

**Freshness:**

- **`Cache-Control: max-age=N`:** the response is fresh for N seconds; **`s-maxage`** overrides it for shared caches (CDNs).
- **`public`** (any cache may store it) vs **`private`** (only the browser, e.g. personalised responses).
- **`no-cache`:** you may store it, but **must revalidate** before every use. It's **not** "don't cache".
- **`no-store`:** don't store at all (sensitive data).
- **`immutable`:** it will never change while fresh, so don't even revalidate on reload. Use it for **hashed assets**.
- **`stale-while-revalidate=N`:** serve stale content while refreshing in the background. **`stale-if-error`** keeps serving if the origin is down.
- **`must-revalidate`:** don't serve stale content once it expires.

**Validation (once stale):**

- **`ETag`** (a content hash/version) → the browser sends **`If-None-Match`**. If unchanged, the server replies **`304 Not Modified`** with no body.
- Or `Last-Modified` → `If-Modified-Since`.

**`Vary: Accept-Encoding, Accept-Language`** tells caches which request headers change the response, so they store separate variants.

**A typical SPA strategy:**

- **`index.html`:** `Cache-Control: no-cache` (always revalidate, so new deployments are picked up).
- **Hashed JS/CSS** (`app.3f9a1c.js`): `public, max-age=31536000, immutable`.
- **APIs:** `private, no-cache` with ETags, or short `max-age` + `stale-while-revalidate` for shareable data.

```js
// Decide what a browser cache does with a stored response (simplified RFC 9111 logic)
function cacheDecision({ cacheControl = '', ageSeconds, etag, lastModified }) {
  const cc = Object.fromEntries(cacheControl.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean)
    .map((d) => { const [k, v] = d.split('='); return [k, v === undefined ? true : Number(v)]; }));
  if (cc['no-store']) return 'not stored: fetch from network';
  const canRevalidate = Boolean(etag || lastModified);
  const fresh = typeof cc['max-age'] === 'number' && ageSeconds < cc['max-age'];
  if (cc['no-cache']) return canRevalidate ? 'revalidate (conditional request → expect 304)' : 'fetch from network';
  if (fresh) return cc.immutable ? 'use cache (fresh, immutable: no revalidation even on reload)' : 'use cache (fresh)';
  const swr = cc['stale-while-revalidate'];
  if (typeof swr === 'number' && typeof cc['max-age'] === 'number' && ageSeconds < cc['max-age'] + swr) return 'use stale copy now + revalidate in background';
  return canRevalidate ? 'revalidate (conditional request → expect 304)' : 'fetch from network';
}

const cases = [
  { name: 'hashed bundle', cacheControl: 'public, max-age=31536000, immutable', ageSeconds: 86400 },
  { name: 'index.html', cacheControl: 'no-cache', ageSeconds: 5, etag: '"v42"' },
  { name: 'API with SWR', cacheControl: 'max-age=60, stale-while-revalidate=300', ageSeconds: 120, etag: '"a1"' },
  { name: 'expired API', cacheControl: 'max-age=60', ageSeconds: 600, etag: '"a1"' },
  { name: 'bank statement', cacheControl: 'no-store', ageSeconds: 0 },
];
console.table(cases.map((c) => ({ resource: c.name, decision: cacheDecision(c) })));

test('cache decisions', () => {
  expect(cacheDecision(cases[0])).toMatch(/immutable/);
  expect(cacheDecision(cases[1])).toMatch(/revalidate/);
  expect(cacheDecision(cases[2])).toMatch(/stale copy/);
  expect(cacheDecision(cases[4])).toMatch(/not stored/);
});
```

### Explain cookies and their attributes 🔥

A cookie is set with `Set-Cookie: name=value; Attributes`. The browser sends matching cookies with requests.

| Attribute | Meaning |
|---|---|
| `Expires` / `Max-Age` | Lifetime. Without them it's a **session cookie** |
| `Domain` | Which hosts receive it. If omitted, only the exact host. If set, subdomains too |
| `Path` | URL path prefix |
| **`Secure`** | Only sent over HTTPS |
| **`HttpOnly`** | **Not readable by JavaScript** (`document.cookie`), which protects session cookies from **XSS theft** |
| **`SameSite=Strict`** | Never sent on cross-site requests, even top-level navigations from other sites |
| **`SameSite=Lax`** (the **default** in modern browsers) | Sent on top-level **GET navigations** from other sites, **not** on cross-site subresource requests or POSTs. A strong **CSRF** mitigation |
| **`SameSite=None`** | Sent cross-site; **requires `Secure`**. Needed for third-party contexts such as embedded widgets or SSO iframes |
| **`Partitioned`** (CHIPS) | A third-party cookie **partitioned per top-level site**, for embeds that legitimately need state |
| `__Host-` / `__Secure-` prefixes | `__Host-` requires `Secure`, `Path=/` and no `Domain`, which locks the cookie to one origin |

**Third-party cookies:**

- Safari and Firefox **block them by default**.
- Chrome **abandoned** its plan to remove them (2024–2025) but restricts them in some modes.
- Design for partitioning: SSO through redirects instead of iframes, the Storage Access API for embeds.

### Compare localStorage, sessionStorage, cookies, IndexedDB and the Cache API 🔥

| | Capacity | API | Lifetime | Sent to server? | Accessible from |
|---|---|---|---|---|---|
| **Cookies** | ~4 KB each | `document.cookie` / `Set-Cookie` | Expiry | **Yes, every request** (bandwidth!) | JS (unless HttpOnly), server |
| **localStorage** | ~5–10 MB per origin | **Synchronous** key/value strings | Until cleared | No | Main thread only (**not workers**) |
| **sessionStorage** | ~5 MB | Synchronous | **Per tab**, until the tab closes | No | Main thread, that tab |
| **IndexedDB** | Large (a % of disk, quota-managed) | **Async**, transactional, structured objects, indexes, blobs | Until cleared or evicted | No | Main thread **and workers** |
| **Cache API** | Large | Async, Request/Response pairs | Until cleared | No | Main thread, **service workers** |
| **OPFS** (Origin Private File System) | Large | File system, sync access in workers | Persistent | No | Workers, main |

**Guidance:**

- **Never store tokens or secrets in localStorage** if XSS is a concern: any injected script can read it. Prefer **HttpOnly cookies** for session tokens.
- localStorage is **synchronous**, so large reads and writes block the main thread. Use IndexedDB for bigger data (`idb-keyval`, Dexie).
- Request **`navigator.storage.persist()`** to reduce eviction risk.
- **This app** stores progress in localStorage (small, convenient). Offline docs would belong in the Cache API via a service worker.

### What does an `encodeURIComponent` vs `encodeURI` question test?

It tests whether you know **which characters are structural** in a URL. `encodeURI` keeps URL syntax characters (`: / ? # & =`) intact, so it's for whole URLs. `encodeURIComponent` encodes them, so it's for **query values and path segments**. Using the wrong one breaks URLs or opens injection bugs. Prefer the **`URL` and `URLSearchParams` APIs**, which handle encoding correctly.

```js
const q = 'react & redux = ♥ / 100%';
console.log(encodeURI(`https://x.com/search?q=${q}`));          // & and = left alone -> broken query
console.log(`https://x.com/search?q=${encodeURIComponent(q)}`); // correct

const url = new URL('https://meet.example.com/room');
url.searchParams.set('jwt', 'a.b.c');
url.searchParams.set('name', 'Zaki Syed & Co');
url.hash = 'config.startWithAudioMuted=true';
console.log(url.toString());
console.log(url.searchParams.get('name'), url.origin, url.pathname);

test('URLSearchParams round-trips special characters', () => {
  expect(new URL(url.toString()).searchParams.get('name')).toBe('Zaki Syed & Co');
});
```

## Service workers & PWAs

### What is a service worker and what can you do with it? 🔥

A **service worker** is a script that runs **in the background, separately from pages**, and acts as a **programmable network proxy** for its **scope** (an origin plus a path). It **requires HTTPS** (except on localhost), has **no DOM access**, is **event-driven** (it can be stopped when idle and restarted on events), and is **async-only** (no localStorage).

**Lifecycle:**

1. `register('/sw.js')`
2. **install** (pre-cache the app shell)
3. **waiting**: a new version waits until all tabs using the old one close, unless `self.skipWaiting()`
4. **activate** (clean old caches; `clients.claim()` to control open pages)
5. **fetch** and other events

**Capabilities:**

- **offline support** and caching strategies
- **push notifications** (Push API)
- **background sync**
- navigation preload
- **intercepting requests** (mock APIs, add headers)

**Caching strategies:**

| Strategy | How | Use for |
|---|---|---|
| **Cache first** | Cache, fall back to network | Hashed static assets, fonts |
| **Network first** | Network, fall back to cache when offline | HTML documents, fresh API data |
| **Stale-while-revalidate** | Serve from cache, update the cache from the network in the background | Avatars, non-critical API data |
| **Network only / cache only** | — | Analytics / pre-cached shell |

```node
// sw.js — stale-while-revalidate for docs, cache-first for hashed assets
const CACHE = 'docs-v3';
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/index.html']))));
self.addEventListener('activate', (e) =>
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(event.request).then((hit) => hit ?? fetch(event.request)));           // cache first
  } else if (url.pathname.startsWith('/resources/')) {
    event.respondWith(caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request).then((res) => { cache.put(event.request, res.clone()); return res; });
      return cached ?? network;                                                                             // stale-while-revalidate
    }));
  }
});
```

**Pitfalls:**

- **A buggy service worker can serve a broken app forever.** Version your caches, have a kill switch, and avoid caching `index.html` with cache-first.
- Users stuck on old versions: show a "new version available, reload" prompt when an update is waiting.
- Use **Workbox** to avoid reinventing strategies.

### What makes a web app a PWA?

- **HTTPS**, a **Web App Manifest** (`name`, `icons`, `start_url`, `display: standalone`, `theme_color`) and a **service worker** for offline or fast loads.
- **Installable** (add to home screen or desktop), with its own window, OS integration (shortcuts, share target, file handling, badging, push notifications on iOS 16.4+ for installed PWAs).
- **Benefits:** no app-store friction, instant updates, one codebase.
- **Limits:**
  - fewer native capabilities than Electron or native apps
  - iOS restrictions
  - for a conferencing app, **no always-on-top PiP overlay windows or system-wide screen annotation**, which is why MeetHour ships an Electron app

## CORS & the DOM

### What is the Same-Origin Policy and how does CORS work? 🔥

**Same-Origin Policy (SOP):**

- An **origin** is **scheme + host + port**.
- Scripts can **send** cross-origin requests (forms, `<img>`, `fetch`), but **can't read the responses** unless the server allows it.
- Pages can't access other origins' DOM, cookies or storage.

**CORS** (Cross-Origin Resource Sharing) lets a **server opt in** to cross-origin reads:

1. **Simple requests:** `GET`/`HEAD`/`POST` with only CORS-safelisted headers and a `Content-Type` of `text/plain`, `multipart/form-data` or `application/x-www-form-urlencoded`. The browser sends them with an `Origin` header. The response must include **`Access-Control-Allow-Origin: <origin>`** (or `*`), or JS can't read it.
2. **Preflighted requests:** other methods (`PUT`, `DELETE`, `PATCH`), custom headers (`Authorization`), or a `Content-Type: application/json` body. The browser first sends **`OPTIONS`** with `Access-Control-Request-Method`/`-Headers`. The server answers with `Access-Control-Allow-Methods`, `-Allow-Headers` and **`-Max-Age`** (to cache the preflight). Only then is the real request sent.
3. **Credentials** (cookies, HTTP auth) require `fetch(url, { credentials: 'include' })` **and** `Access-Control-Allow-Credentials: true`, and the server **must echo the exact origin**, not `*`.
4. **`Access-Control-Expose-Headers`** makes non-safelisted response headers readable (e.g. `X-Request-Id`, `ETag`).

**Interview points:**

- **CORS is enforced by browsers**, to protect **users**. It doesn't protect your API from curl or servers, so you still need authentication.
- "CORS error" debugging: check the **preflight response** in DevTools.
- In development, use a **dev-server proxy** (Vite `server.proxy`) instead of `Access-Control-Allow-Origin: *` with credentials, which isn't allowed anyway.
- Avoid reflecting arbitrary origins with credentials. That's a security hole equivalent to no SOP.

### Explain event propagation: capturing, target and bubbling. What is event delegation? 🔥

**DOM events propagate in three phases:**

1. **Capture:** from `window` down to the target's parent. Listeners registered with `{ capture: true }` run here.
2. **Target:** on the element itself.
3. **Bubble:** back up to `window`. Most listeners run in this phase. Some events don't bubble: `focus`/`blur` (use `focusin`/`focusout`), `mouseenter`/`mouseleave`, `load`, `scroll` on elements.

**Controlling it:**

- `e.stopPropagation()` stops further propagation, while other listeners on the **same element** still run. `stopImmediatePropagation()` stops those too.
- `e.preventDefault()` cancels the **default action** (link navigation, form submit). It doesn't affect propagation.

**Event delegation:** attach **one listener on a common ancestor** and use `e.target.closest(selector)` to find which child was interacted with.

- **Fewer listeners** (memory).
- Works for **dynamically added** elements.
- React uses delegation at the root.

**Listener options:** `{ once: true }`, **`{ passive: true }`** (it promises not to call `preventDefault`, so scrolling can start immediately; this is the default for touch and wheel listeners on window/document in Chrome), and `{ signal }` (remove the listener with an `AbortController`).

```js
// Simulate capture → target → bubble on a small tree (no DOM needed)
function createNode(name, parent = null) { return { name, parent, listeners: [] }; }
function addListener(node, fn, { capture = false } = {}) { node.listeners.push({ fn, capture }); }
function dispatch(target, type) {
  const path = [];
  for (let n = target; n; n = n.parent) path.unshift(n);           // [window, ..., target]
  const event = { type, target, stopped: false, stopPropagation() { this.stopped = true; } };
  const log = [];
  for (const node of path.slice(0, -1)) {                         // capture phase
    for (const l of node.listeners.filter((x) => x.capture)) { l.fn(event, `capture@${node.name}`, log); if (event.stopped) return log; }
  }
  for (const l of target.listeners) l.fn(event, `target@${target.name}`, log);
  for (const node of path.slice(0, -1).reverse()) {               // bubble phase
    if (event.stopped) break;
    for (const l of node.listeners.filter((x) => !x.capture)) l.fn(event, `bubble@${node.name}`, log);
  }
  return log;
}

const win = createNode('window');
const list = createNode('ul#participants', win);
const item = createNode('li[data-id=p2]', list);
const button = createNode('button.mute', item);

const record = (e, where, log) => log.push(where);
addListener(win, record, { capture: true });
addListener(list, (e, where, log) => log.push(`${where} → delegated handler for ${e.target.name}`)); // delegation
addListener(button, record);
addListener(win, record);

console.log(dispatch(button, 'click'));

test('capture runs top-down, bubbling bottom-up', () => {
  expect(dispatch(button, 'click')).toEqual([
    'capture@window',
    'target@button.mute',
    'bubble@ul#participants → delegated handler for button.mute',
    'bubble@window',
  ]);
});
```

### What are MutationObserver, IntersectionObserver and ResizeObserver used for?

- **`IntersectionObserver`** fires asynchronously when an element enters or leaves the viewport (or a root) beyond thresholds. Uses:
  - **lazy loading** and infinite scroll (a sentinel element)
  - analytics impressions
  - **pausing off-screen videos**, and telling the SFU to stop sending video for tiles that aren't visible
  
  It's far cheaper than scroll listeners plus `getBoundingClientRect`.
- **`ResizeObserver`** fires when an **element's size** changes, not just the window. Uses: responsive components, canvas or whiteboard resizing, recomputing video tile layouts, auto-sizing.
- **`MutationObserver`** fires when DOM nodes, attributes or text change, delivered as **microtasks**. Uses: reacting to third-party DOM changes, editors, accessibility tooling, waiting for an element to appear. Disconnect when done; observing large subtrees can be expensive.
- **`PerformanceObserver`** observes performance entries: LCP, layout shifts, long tasks, Long Animation Frames, resource timings. The `web-vitals` library is built on it.

### How do you efficiently manipulate the DOM without a framework?

- **Batch DOM writes:** build nodes in a **`DocumentFragment`** (or a `<template>`), then insert them once. Use `element.replaceChildren(...nodes)`, or `insertAdjacentHTML` for trusted strings.
- **Avoid layout thrashing:** read all measurements first, then write. Use `requestAnimationFrame` for visual updates.
- **Use event delegation** instead of a listener per item.
- **Use `textContent`, not `innerHTML`,** for user data. `innerHTML` with untrusted input is an **XSS** risk; if HTML is necessary, sanitise it with DOMPurify or the Sanitizer API.
- **Use `classList` toggles** and CSS classes, not many inline style writes. Use CSS variables for dynamic values.
- **`content-visibility: auto`** for long pages, and **virtualise** very long lists.
