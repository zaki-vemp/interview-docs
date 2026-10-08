# React & Web Performance

Your resume claims **"refactored the React architecture to improve rendering performance"**, **"enhanced Virtual Background performance"**, **"Electron performance improvements"** and **"performance optimization for high-traffic platforms"**. Expect deep questions here. Interviewers want a **method** (measure → find the bottleneck → fix → verify), not a list of tricks.

## Method

### How do you approach a performance problem in a React app? 🔥

> "I never optimise blind. My process is:"

1. **Define the symptom and the metric.**
   - **Load:** LCP, TTFB, bundle size.
   - **Interaction:** INP, input lag.
   - **Runtime:** dropped frames, long tasks, memory growth.
   - **Visual stability:** CLS.
2. **Reproduce and measure** in conditions close to real users:
   - production build, CPU throttling (4–6×), network throttling, realistic data (50 participants, 10k rows)
   - for real users, field data (RUM, CrUX, the `web-vitals` library)
3. **Profile to find the bottleneck:**
   - **React DevTools Profiler:** which components rendered, why ("Why did this render?"), how long they took
   - **Chrome Performance panel:** long tasks (>50 ms), scripting vs layout vs paint, layout thrashing
   - **Lighthouse / PageSpeed Insights** for load
   - **Coverage tab** and a bundle analyser for unused JavaScript
   - **Memory panel** for leaks
4. **Fix the biggest bottleneck first**, using the cheapest fix that works (often structural: colocate state, split components, virtualise) before micro-optimising with `memo` everywhere.
5. **Verify** with the same measurement, and **prevent regressions**: performance budgets in CI (bundle size limits, Lighthouse CI) and production monitoring.

### Walk me through how you improved rendering performance on MeetHour 🔥

Use **STAR** with real numbers (see the MeetHour deep-dive for the technical detail):

- **Symptom:** in meetings with 30+ participants, frame drops and input lag. The Profiler showed the filmstrip re-rendering on every audio-level and stats update.
- **Root causes:**
  - `useSelector` returning new arrays and objects on every dispatch
  - tiles receiving whole participant objects
  - high-frequency audio levels stored in Redux
  - every tile mounted, even off-screen
  - inline callbacks defeating `memo`
- **Fixes:**
  - normalised state plus memoised selectors (`createSelector`)
  - tiles became `React.memo` components taking only an ID and selecting their own slice
  - audio levels moved to a subscription outside the React render path (updating a CSS variable through a ref)
  - throttled stats to 1 Hz
  - virtualised the tile grid, and told the bridge to stop sending video for off-screen tiles (receiver constraints)
  - code-split rarely used panels
- **Result:** commits per second dropped from *[N]* to *[M]*, and the average commit duration fell from *[x]* ms to *[y]* ms. INP and CPU usage improved on low-end laptops. *[Fill in real numbers.]*

### What tools do you use to profile React apps? 🔥

| Tool | What it tells you |
|---|---|
| **React DevTools → Profiler** | Commits, render duration per component, **why each component rendered** (enable "Record why each component rendered"), flame and ranked charts |
| React DevTools → "Highlight updates" | Visual flash of re-rendering components, which quickly reveals over-rendering |
| **Chrome Performance panel** | Main-thread timeline: long tasks, scripting, style and layout, paint, the frames track, INP interactions, Long Animation Frames |
| **Lighthouse / PageSpeed Insights** | Lab load metrics plus field data (CrUX), with actionable audits |
| **`web-vitals` library** | Real-user LCP, INP, CLS, FCP and TTFB sent to your analytics |
| **Coverage tab** | Unused JS/CSS on the current page |
| **Bundle analysers** (`rollup-plugin-visualizer`, `webpack-bundle-analyzer`, `source-map-explorer`) | What's inside each chunk, duplicate dependencies |
| **Memory panel** | Heap snapshots, detached DOM nodes, allocation timelines |
| `<Profiler onRender>` API, `performance.mark`/`measure` | Custom timing in production |
| `chrome://webrtc-internals` | Conferencing-specific: encoder/decoder load, frame rates, bandwidth |

## Rendering performance

### What causes unnecessary re-renders and how do you prevent them? 🔥

**Causes:**

1. A parent re-render re-renders **all children** by default.
2. New object, array or function props every render defeat `React.memo`.
3. Context value changes re-render **all consumers**.
4. Selectors returning new references (`useSelector(s => s.list.filter(...))`).
5. State stored too high in the tree. Typing in an input at the top of the app re-renders everything.

**Fixes, roughly from structural to tactical:**

1. **Move state down / colocate it** where it's used.
2. **Lift content up:** pass expensive children as `children` props. Elements created by a parent that didn't re-render are reused as-is.
3. **Split components** so fast-changing parts (a timer, an audio meter) are isolated leaf components.
4. **Stabilise props:** `useCallback`/`useMemo`, or the React Compiler.
5. **`React.memo`** on expensive components that render often with the same props.
6. **Split contexts**, or use **selector-based stores** (Redux, Zustand, Jotai).
7. **Memoised selectors** that return stable references.

```jsx
// "Lift content up": the ticking clock re-renders only itself, not <HeavyGrid/>
function MeetingShell({ children }) {
  const [elapsed, setElapsed] = useState(0);
  useInterval(() => setElapsed((s) => s + 1), 1000);
  return <div><Header elapsed={elapsed} />{children}</div>;  // children elements are created by the parent
}
<MeetingShell><HeavyGrid /></MeetingShell>;  // HeavyGrid does not re-render every second
```

### Why do memoised selectors matter in Redux? Show it 🔥

`useSelector` re-runs your selector **after every dispatched action** and re-renders the component **if the result changed by reference** (`===`). A selector that builds a new array every time **always** looks changed. `createSelector` (Reselect/RTK) **caches** the result for unchanged inputs.

```js
// Minimal createSelector (single-entry cache), same idea as Reselect
function createSelector(inputSelectors, combiner) {
  let lastArgs = null;
  let lastResult;
  return (state) => {
    const args = inputSelectors.map((sel) => sel(state));
    if (lastArgs && args.every((a, i) => a === lastArgs[i])) return lastResult; // inputs unchanged -> cached
    lastArgs = args;
    lastResult = combiner(...args);
    return lastResult;
  };
}

let computeCount = 0;
const selectParticipants = (s) => s.participants;
const selectFilter = (s) => s.filter;
const selectVisible = createSelector([selectParticipants, selectFilter], (list, filter) => {
  computeCount++;
  return list.filter((p) => p.name.toLowerCase().includes(filter));
});
const naiveSelectVisible = (s) => s.participants.filter((p) => p.name.toLowerCase().includes(s.filter));

let state = { participants: [{ name: 'Asha' }, { name: 'Ravi' }], filter: 'a', audioLevel: 0 };
const r1 = selectVisible(state);
state = { ...state, audioLevel: 0.7 };          // unrelated update (happens many times per second)
const r2 = selectVisible(state);
const n1 = naiveSelectVisible(state);
const n2 = naiveSelectVisible(state);

console.log('memoised same reference:', r1 === r2, '| naive same reference:', n1 === n2, '| computations:', computeCount);

test('unrelated updates reuse the cached result', () => {
  expect(r1).toBe(r2);
  expect(n1).not.toBe(n2);             // would re-render the component on every dispatch
  expect(computeCount).toBe(1);
});
```

**Also:** `useSelector(selector, shallowEqual)` for selectors returning small objects, and **selecting primitives** (`s => s.participants.byId[id].name`) whenever possible.

### How do you handle very high-frequency updates (audio levels, cursor positions, stats)? 🔥

Pushing 30–60 updates per second through React state, and especially through **global** state, wastes renders.

- **Keep them out of global stores.** Subscribe locally in the tiny leaf component that displays them.
- **Bypass React for pure visuals:** update a **ref's style or a CSS custom property** directly in an event callback or in `requestAnimationFrame`, e.g. `meterRef.current.style.setProperty('--level', level)`. React doesn't need to know.
- **Throttle to the frame rate** (rAF) or to what humans perceive (stats at 1–2 Hz).
- **Batch** many updates into one state change per frame.
- For canvas-based UIs (whiteboard, annotations), keep the drawing in an **imperative layer** (canvas plus refs) and let React manage only the chrome around it.

```js
// Coalesce many updates into at most one flush per frame (rAF-like scheduler, runnable with setTimeout)
function createFrameBatcher(flush, schedule = (cb) => setTimeout(cb, 16)) {
  let pending = new Map();
  let scheduled = false;
  return (id, value) => {
    pending.set(id, value);                  // keep only the latest value per participant
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      const batch = pending;
      pending = new Map();
      flush(batch);
    });
  };
}

const flushes = [];
const push = createFrameBatcher((batch) => flushes.push(Object.fromEntries(batch)));
for (let i = 0; i < 100; i++) push(`p${i % 3}`, i);   // 100 audio-level events within one frame

test('100 events collapse into one flush with the latest value per participant', async () => {
  await new Promise((r) => setTimeout(r, 40));
  expect(flushes).toEqual([{ p0: 99, p1: 97, p2: 98 }]);
});
```

### How does list virtualisation work? When do you need it? 🔥

Rendering 10,000 DOM rows is slow (memory, layout, initial render). **Virtualisation (windowing)** renders **only the rows visible in the viewport** plus a small **overscan**, inside a container whose height equals the total height, so the scrollbar is correct. As you scroll, rows are recycled.

- **Libraries:** `react-window` (fixed or variable size), **TanStack Virtual** (headless; supports dynamic measurement, grids and horizontal lists), `react-virtuoso`.
- **When:** long chat histories, participant lists in webinars, document search results, log viewers, large tables.
- **Gotchas:**
  - dynamic heights need measurement
  - **find-in-page (Ctrl+F) doesn't find off-screen rows**
  - accessibility: keep `aria-rowcount`/`aria-rowindex` and don't break keyboard navigation
  - scroll restoration
  - sticky headers
- **Alternatives:** pagination, "load more", or CSS **`content-visibility: auto`**, which lets the browser skip rendering off-screen sections while keeping them in the DOM, so search still works.

```js
// The core math of a fixed-height virtual list
function visibleRange({ scrollTop, viewportHeight, rowHeight, count, overscan = 3 }) {
  const first = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(viewportHeight / rowHeight);
  const start = Math.max(0, first - overscan);
  const end = Math.min(count - 1, first + visibleCount + overscan);
  return { start, end, offsetY: start * rowHeight, totalHeight: count * rowHeight };
}

const r = visibleRange({ scrollTop: 5000, viewportHeight: 600, rowHeight: 40, count: 10000 });
console.log(r, `→ rendering ${r.end - r.start + 1} of 10000 rows`);

test('only a window of rows is rendered', () => {
  expect(r).toEqual({ start: 122, end: 143, offsetY: 4880, totalHeight: 400000 });
  expect(visibleRange({ scrollTop: 0, viewportHeight: 600, rowHeight: 40, count: 5 }).end).toBe(4);
});
```

### When is `React.memo` / `useMemo` / `useCallback` actually worth it?

**Worth it when:**

- A component is **expensive to render** *and* re-renders often with **the same props**. Examples: video tiles, chart widgets, rows in large lists, rich-text editors.
- A computation is **expensive** (sorting or filtering thousands of items, layout calculations) and its inputs rarely change.
- **Referential stability** is required: props to memoised children, effect dependencies, context values, values passed to non-React code.

**Not worth it for:**

- cheap components and simple calculations
- components whose props change on every render anyway
- "just in case" wrapping. It adds memory use, comparison cost and dependency-array bugs.

Measure with the Profiler before and after. With the **React Compiler**, this becomes mostly automatic.

### How do `useTransition`, `useDeferredValue` and `<Activity>` help perceived performance?

- **`useTransition` / `useDeferredValue`** keep **urgent updates** (typing, clicking) responsive by rendering **expensive updates** in an interruptible background render (see React Internals). They improve **INP** without debouncing delays.
- **`<Activity mode="hidden">`** (React 19.2) **pre-renders or keeps alive** hidden parts of the UI, such as an inactive tab or a panel the user is likely to open next. It preserves their state and DOM, and defers their updates and effects until visible. Switching back is instant.

## Loading performance

### What are Core Web Vitals and how do you improve each? 🔥

Google's user-centric metrics, measured at the **75th percentile** of real page loads:

| Metric | Measures | Good | Poor |
|---|---|---|---|
| **LCP** (Largest Contentful Paint) | Load: when the largest image or text block is rendered | ≤ 2.5 s | > 4 s |
| **INP** (Interaction to Next Paint) — replaced **FID** in March 2024 | Responsiveness: latency from an interaction to the next frame, across the whole visit | ≤ 200 ms | > 500 ms |
| **CLS** (Cumulative Layout Shift) | Visual stability: unexpected layout movement | ≤ 0.1 | > 0.25 |

Supporting metrics: **TTFB** (≤ 0.8 s), **FCP** (≤ 1.8 s), TBT (lab proxy for INP).

**Improving LCP:**

- Fast **TTFB**: CDN, caching, SSR/SSG, edge.
- **Don't hide the LCP element behind JavaScript.** SSR the hero.
- **Preload** the LCP image and set `fetchpriority="high"`. **Never lazy-load the LCP image.**
- Optimised images (AVIF/WebP, correct size via `srcset`).
- Reduce render-blocking CSS and JS; inline critical CSS. Fonts with `font-display: swap` plus preload.

**Improving INP:**

- Break up **long tasks**: yield with `scheduler.yield()` or `setTimeout`, chunk work, move it to Web Workers.
- Reduce JavaScript (code splitting).
- Avoid huge re-renders on input (transitions, memoisation, virtualisation).
- Debounce expensive handlers.
- Show visual feedback immediately, and do the heavy work after paint.
- Avoid layout thrashing.

**Improving CLS:**

- Set **`width`/`height`** or `aspect-ratio` on images, video and embeds.
- **Reserve space** for ads, banners and late-loading content (skeletons with fixed size).
- Don't insert content above existing content unless the user triggered it.
- Use `transform` animations instead of animating layout properties.
- Avoid font swap shifts with `size-adjust`/fallback font metrics.

### How do you reduce bundle size? 🔥

1. **Analyse first:** `rollup-plugin-visualizer` or `webpack-bundle-analyzer`. Look for big dependencies, duplicates, polyfills and locale files.
2. **Code splitting:**
   - **Route-based** splitting is the biggest win (`lazy(() => import('./pages/Recordings'))`).
   - **Component-based** splitting for heavy, rarely used UI: whiteboard, rich editor, charts, PDF viewer, virtual-background models.
   - Use **dynamic `import()`** for libraries needed only on an action (e.g. `docx` for export).
3. **Tree shaking:** use ES-module builds and named imports (`import { debounce } from 'lodash-es'`), mark packages `sideEffects: false`, and avoid barrel files that pull in everything.
4. **Replace heavy dependencies:** moment → date-fns/dayjs/`Intl`; lodash → native or per-function imports; heavy UI kits → a headless library plus your own styles.
5. **Modern output:** target modern browsers (no ES5 transpiling or unneeded polyfills), minify, use **Brotli** compression.
6. **Move work to the server:** SSR/RSC keep libraries out of the client bundle.
7. **Performance budgets** in CI (`size-limit`, bundlesize), so regressions fail the build.

### Explain code splitting with `React.lazy` and prefetching 🔥

```jsx
const Recordings = lazy(() => import('./pages/Recordings'));
const Whiteboard = lazy(() => import(/* webpackChunkName: "whiteboard" */ './features/Whiteboard'));

// Prefetch on intent (hover/focus) so the chunk is ready by the time the user clicks
const prefetchWhiteboard = () => import('./features/Whiteboard');

function Toolbar({ onOpenBoard }) {
  return <button onMouseEnter={prefetchWhiteboard} onFocus={prefetchWhiteboard} onClick={onOpenBoard}>Whiteboard</button>;
}

<Suspense fallback={<PanelSkeleton />}>
  {showBoard && <Whiteboard />}
</Suspense>;
```

**Notes:**

- `lazy` requires a **default export** (or map it: `import('./x').then(m => ({ default: m.X }))`).
- Avoid **too many tiny chunks** (request overhead) and **waterfalls** (a chunk that loads another chunk). Preload critical chunks.
- Handle chunk **load errors** after deployments (old chunk names return 404). Use an error boundary with "reload".
- **This app does the same thing:** the playground's CodeMirror editor is only downloaded the first time you open the playground, and docs are prefetched into the SWR cache on hover.

### How do you optimise images and fonts?

**Images:**

- **Modern formats:** AVIF/WebP with fallbacks through `<picture>`.
- **Responsive sizes:** `srcset` plus `sizes`, so phones don't download desktop images.
- **`loading="lazy"`** for below-the-fold images (not the LCP image). Set `decoding="async"`.
- **Explicit dimensions** to prevent CLS.
- A **CDN with on-the-fly resizing**. In Next.js, `next/image` handles much of this.

**Fonts:**

- Self-host, **subset**, use WOFF2.
- `font-display: swap` (or `optional`).
- **Preload** the critical font.
- Fewer weights; consider variable fonts.
- Use fallback font metric overrides (`size-adjust`, `ascent-override`) to reduce layout shift.

### What network-level optimisations matter for frontend performance?

- **Caching strategy:**
  - Hashed static assets: `Cache-Control: public, max-age=31536000, immutable`.
  - HTML: `no-cache` (revalidate) so new deployments are picked up.
  - API responses: ETags and `stale-while-revalidate` where appropriate.
- **CDN** close to users. **HTTP/2 or HTTP/3** multiplexing (fewer reasons to bundle aggressively). **Brotli** compression.
- **Resource hints:**
  - `preconnect` to critical third-party origins (API, CDN, auth)
  - `dns-prefetch`
  - `preload` for critical late-discovered resources (fonts, the LCP image)
  - `modulepreload` for JS chunks
- **Reduce requests on the critical path:** inline critical CSS, defer non-critical scripts (`defer`/`async`), load third-party scripts late (analytics, chat widgets).
- **Client data caching:** SWR or TanStack Query to avoid refetching, request **deduplication**, and **prefetching** the next likely data.

## Runtime & memory

### What is layout thrashing and how do you avoid it? 🔥

**Layout thrashing (forced synchronous layout)** happens when you **interleave DOM writes and reads**. Reading layout properties (`offsetHeight`, `getBoundingClientRect()`, `scrollTop`) after a write forces the browser to **recalculate layout immediately**, repeatedly, inside one frame.

```node
// ❌ read-write-read-write: N forced layouts
items.forEach((el) => {
  const h = el.offsetHeight;          // read (forces layout if the DOM is dirty)
  el.style.height = h * 2 + 'px';     // write (dirties layout)
});

// ✅ batch reads, then writes: 1 layout
const heights = items.map((el) => el.offsetHeight);
items.forEach((el, i) => { el.style.height = heights[i] * 2 + 'px'; });
```

**Also:**

- Animate **`transform` and `opacity`**. They're handled by the **compositor** without layout or paint. Animating `top`/`left`/`width`/`height` triggers layout every frame.
- Use `will-change: transform` sparingly; it creates a layer that costs memory.
- Use `ResizeObserver` and `IntersectionObserver` instead of polling layout in scroll handlers.
- Use **passive** scroll and touch listeners (`{ passive: true }`).

### How do you find and fix memory leaks in a React app? 🔥

**Typical leaks in conferencing and dashboard apps:**

- **Effects without cleanup:** event listeners, intervals, WebSocket or XMPP handlers, `ResizeObserver`s.
- **MediaStreams never stopped:** camera stays on and memory stays allocated. Call `track.stop()` on every track.
- `RTCPeerConnection`, `AudioContext` and `MediaRecorder` never closed.
- **Detached DOM nodes** held by closures, caches or third-party libraries.
- **Unbounded caches**/arrays (chat history, logs, stats samples). Cap their size.
- Subscriptions in global stores from components that unmounted.

**How to find them:**

1. Open the Memory panel and take a **heap snapshot**.
2. Perform the action, such as joining and leaving a meeting **5–10 times**.
3. Force GC and take another snapshot. Compare: look for growing object counts, especially **"Detached HTMLDivElement"**, closures, `MediaStream` and `RTCPeerConnection` objects.
4. Follow the **retainers** path to find what holds the reference.
5. Use the Performance monitor to watch JS heap, DOM nodes and event listener counts over time.

**StrictMode's double mount** reveals missing cleanups early in development.

### How do you keep the main thread free for interactions?

- **Break up long tasks** (> 50 ms): yield with `await scheduler.yield()` (Chromium), `setTimeout(0)` or `MessageChannel`.
- **Web Workers** for CPU-heavy work: parsing, search indexing, image and video processing, compression. Use **OffscreenCanvas** for rendering in workers. Use **Comlink** to make worker APIs feel like async function calls.
- **WebAssembly** for heavy computation (Jitsi's virtual background uses TFLite in WASM).
- **Idle-time work** with `requestIdleCallback`: analytics batching, prefetching.
- **Defer non-critical work until after paint:** `useEffect` (after paint), not `useLayoutEffect`.
- **Measure** with the **Long Animation Frames (LoAF) API**, which attributes slow frames to specific scripts (Chrome 123+), alongside INP attribution from `web-vitals`.

### How do you measure performance in production (RUM)?

- **`web-vitals`** library: `onLCP`, `onINP` and `onCLS` with **attribution builds**, which tell you *which element* was the LCP or *which interaction* caused poor INP. Send the data to your analytics with `navigator.sendBeacon`.
- **Custom metrics** with `performance.mark()`/`measure()`. For a conferencing app: **time-to-join**, time to first remote video frame, time to start recording.
- **`<Profiler id onRender>`** to sample render timings in production for key trees (with a profiling-enabled build, or sparingly).
- **Error and performance tracing** with Sentry or Datadog RUM. Segment by device class, network and browser, and look at **p75/p95**, not averages.
- **CrUX** (Chrome UX Report) for public field data, and Search Console's Core Web Vitals report.

## SSR & architecture-level performance

### How do SSR, SSG, streaming and RSC affect performance? 🔥

| Strategy | TTFB | LCP | JS cost / INP | Best for |
|---|---|---|---|---|
| **CSR** (client-only SPA) | Fast (static shell) | Slow (wait for JS, then data) | All JS hydrates/renders on the client | Authenticated apps behind login (e.g. the meeting UI itself) |
| **SSR** | Slower (render per request) | Fast (HTML has content) | Full hydration cost | Dynamic, SEO-relevant pages |
| **SSG / ISR** | Fastest (CDN) | Fast | Hydration cost | Marketing pages, docs, blogs |
| **Streaming SSR** | Fast shell, progressive content | Faster | Selective hydration | Pages with slow data parts |
| **RSC** | Like SSR | Fast | **Less JS** (server components don't hydrate) | Content-heavy apps with islands of interactivity |

**Hydration cost** is often the hidden INP killer on SSR pages. RSC, partial hydration and islands (Astro) all reduce how much JS has to hydrate.

### What performance considerations are specific to real-time video apps?

- **Video decoding and rendering is the dominant cost.** Don't render or decode streams you aren't showing. Use **last-N**, receiver constraints and **pagination of the tile view**, and request **lower resolutions for small tiles**.
- **Keep React out of the media path:** attach `srcObject` once per stream and don't re-create `<video>` elements on re-render (stable keys, memoised tiles).
- **Throttle stats and audio-level UI**; use workers for background timers.
- **Effects processing** (virtual background, noise suppression): WASM SIMD, workers, `OffscreenCanvas`, Insertable Streams. Disable on low-end devices (CPU pressure observer, frame-time budgets).
- **Electron:** watch GPU and process memory per window, avoid synchronous IPC, and make deliberate choices about background throttling.
