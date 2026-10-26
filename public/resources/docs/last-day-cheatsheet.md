# Last-Day Revision Cheat Sheet

Read this **the night before** and **one hour before** the interview. It's dense on purpose: one line per fact, grouped by topic. Each section points to the full document if a line feels shaky.

## You

### Your opening and the numbers you must have ready 🔥

- **30-second pitch:** senior frontend dev, 6+ years, React/TS/Redux → **MeetHour** (WebRTC/Jitsi: multi-Jibri, Electron revamp, Visitor/Backstage/Webinar modes, multi-stream, virtual background) → **ScaleCapacity** serverless AWS products (RBF with Claude, scQuill with Azure AD SSO, Nebraska Draw with Jotai, SCAI IDP) → looking for senior ownership at scale.
- **Have real numbers in My Notes for:** team size, number of users and meetings, the render-performance improvement (% or ms), recording cost reduction, virtual background CPU and frame-time gains, Electron memory and startup gains, release cadence.
- **Prepare consistent, truthful answers to:**
  - the **overlapping "Present" dates** (ScaleCapacity / V-Empower)
  - the **2016–2019 gap**
  - **Mechanical Engineering → software**
  - why you're leaving
  - **notice period: 2 months** (buyout possible?)
  - expected CTC (a researched range)
  - relocation (yes, anywhere)
- **AWS DVA-C02:** certified June 2023, and the validity date has passed (June 2026). Say "certified 2023; recertification planned for *[date]*".
- **Questions to ask them:** success in 90 days, the biggest frontend challenge, how architecture decisions get made, the release process, the growth path.

## JavaScript & TypeScript

### JavaScript core in 20 lines 🔥

- 8 types: 7 primitives (`undefined null boolean number bigint string symbol`) + object. `typeof null === 'object'`. Use `Array.isArray`.
- `===` always; `x == null` is the one idiom. `Object.is(NaN, NaN)` is true and `Object.is(0, -0)` is false.
- Falsy: `false 0 -0 0n '' null undefined NaN`. `??` is for null/undefined only; `||` is for any falsy value.
- `var` is function-scoped and hoisted as undefined. `let`/`const` are block-scoped with a **TDZ**. Function declarations are hoisted with their body.
- **Closure** = a function plus its lexical environment. It captures **variables, not values**, which causes stale closures. Loop + `var` + `setTimeout` prints 3, 3, 3; with `let` it prints 0, 1, 2.
- **`this` precedence:** `new` > explicit (`call/apply/bind`) > implicit (`obj.m()`) > default (undefined in strict mode, globalThis in sloppy). Arrows are lexical. A bound function can't be re-bound.
- **Prototype chain:** reads walk `[[Prototype]]`, writes create own properties. `new`: create an object → link `Fn.prototype` → call with `this` → return the object (unless the constructor returns an object).
- **Classes:** strict mode, TDZ, must be called with `new`, non-enumerable methods, `#private` fields, `super()` before `this`.
- **Copies:** spread is shallow. `structuredClone` is deep (handles cycles, Map/Set/Date; no functions; loses prototypes). JSON loses undefined/Date/Map and throws on cycles.
- **Map vs object:** Map for any key type, frequent add/delete, insertion order, `.size`. **WeakMap** for metadata keyed by objects without leaks.
- **Mutating array methods:** `push pop shift unshift splice sort reverse fill`. Non-mutating copies (ES2023): `toSorted toReversed toSpliced with`. **The default `sort` is string-based.**
- **Generators** are lazy and pausable, and `next(v)` sends a value in. Iterables implement `[Symbol.iterator]`.
- **Proxy + Reflect** intercept get/set: the basis of Vue reactivity, Immer and MobX.
- **ESM:** static, live bindings, top-level await, tree-shakeable. **CJS:** dynamic, copied values.
- **GC** is mark-and-sweep by reachability. Leaks come from timers, listeners, detached DOM, unbounded caches, unclosed MediaStreams and PeerConnections.

### Async & the event loop in 10 lines 🔥

- Sync code → **all microtasks** (promise callbacks, `await` continuations, `queueMicrotask`) → **one task** (timer, event, message) → render (rAF, then style/layout/paint).
- `setTimeout(0)` runs after microtasks. Nested timers are clamped to ≥ 4 ms, and background tabs are throttled.
- **`async` functions run synchronously until the first `await`.** They always return a promise.
- Returning a promise from `.then` or an async function costs **2 extra microtask ticks**.
- `Promise.all` is fail-fast; `allSettled` never rejects; `race` settles with the first; `any` takes the first fulfilment or throws `AggregateError`.
- **`forEach` doesn't await.** Use `for…of` (sequential) or `Promise.all(map)` (parallel), or a pool for bounded concurrency.
- `return await` matters inside try/catch.
- **AbortController** cancels fetch and listeners. `AbortSignal.timeout(ms)` and `AbortSignal.any([...])`.
- **Retry:** exponential backoff + **jitter**, only for idempotent or transient errors (429/503).
- **Node:** `process.nextTick` runs before promises. Phases: timers → pending → poll → **check (setImmediate)** → close.

### TypeScript in 10 lines

- `unknown` (narrow before use) > `any`. `never` is used for exhaustiveness. `void` means the return value is ignored.
- **Discriminated unions** + `switch` + an `assertNever` default.
- **Narrowing:** `typeof`, `instanceof`, `in`, equality, `x is T` predicates, `asserts x is T`.
- **`satisfies`** checks without widening. **`as const`** gives literal, readonly types.
- Generics with `extends` constraints, plus `keyof` / `T[K]`.
- **Mapped types** with `as` remapping, **conditional types** + `infer`. Distribution can be blocked with `[T]`.
- Utility types to be able to implement: `Partial Required Readonly Pick Omit Record Exclude Extract ReturnType Parameters Awaited`.
- **Branded types** for IDs. Types are erased at runtime, so **validate API data with zod**.
- tsconfig: `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `moduleResolution: bundler`. **Vite doesn't type-check**, so run `tsc --noEmit` in CI.
- React: props types, `ComponentPropsWithoutRef<'button'>`, generic components, `ref` as a prop in React 19.

## React & frameworks

### React in 20 lines 🔥

- **Re-render triggers:** own state, **parent re-render**, consumed context, external store. A re-render isn't the same as a DOM update.
- **Reconciliation:** a different type means a remount; the same type means update props; lists are matched by **key**. Index keys break state on insert or reorder. Changing `key` resets state.
- **Fiber:** units of work, `child/sibling/return` pointers, double-buffered `current`/`workInProgress` trees, **lanes** for priority, an interruptible render phase.
- **Render phase** is pure and can run twice or be discarded. **Commit phase** is synchronous: mutation → `useLayoutEffect` (before paint) → paint → `useEffect` (after paint).
- **Batching** everywhere since 18. `flushSync` forces a sync update. Use **functional updates** for state derived from previous state.
- Hooks are an **ordered linked list per fiber**, hence the Rules of Hooks.
- **StrictMode:** double render and **mount → unmount → mount** in dev to surface missing cleanups.
- **Effects:** sync with external systems only. Derived data belongs in render; event logic belongs in handlers. Always clean up. Abort fetches to avoid races.
- `useMemo`/`useCallback`/`memo` only for measured hot spots or referential stability. The **React Compiler** automates this.
- **Context:** all consumers re-render when the value changes. Split contexts, or use selector stores for hot state.
- **Concurrent features:** `useTransition` (you own the setter; React 19 allows async Actions), `useDeferredValue` (a prop or value), Suspense (lazy loading, `use(promise)`, streaming SSR).
- **`useSyncExternalStore`** prevents tearing. The snapshot must be cached and stable.
- **React 19:** Actions, `useActionState`, `useFormStatus`, `useOptimistic`, `use()`, ref as a prop, ref cleanups, `<Context>` as a provider, metadata hoisting. **19.2:** `useEffectEvent`, `<Activity>`.
- **RSC:** server-only code with **zero client JS**, async data access. `'use client'` marks the boundary. Props must be serialisable. **Server Actions are public endpoints**, so authorise and validate inside them.
- **SSR + hydration:** the server and client output must match. Selective hydration with Suspense.
- **Error boundaries:** class components; they don't catch event handler, async or SSR errors.
- **Portals:** events bubble through the React tree. Use `<dialog>` for modals.
- **Controlled vs uncontrolled:** React Hook Form uses uncontrolled inputs + refs.
- **Perf method:** measure (Profiler, Performance panel) → colocate state and lift content up → memo → virtualise → split code → move work to workers.
- **MeetHour refactor story:** normalised state, memoised selectors, ID-based memo tiles, audio levels outside Redux, virtualised tiles, receiver constraints.

### Next.js, Vue and Angular in 12 lines

- **Next.js App Router:** Server Components by default. `layout/page/loading/error/route`. **v15:** fetch is uncached by default and `params` is async. **v16:** `'use cache'` (Cache Components), `middleware.ts` → **`proxy.ts`**.
- **Next caches:** request memoisation, Data Cache, Full Route Cache, client Router Cache. Revalidate with `revalidateTag` / `revalidatePath`.
- **Next auth:** check in a server-only **Data Access Layer**, not only in middleware or layouts (CVE-2025-29927 showed middleware could be bypassed).
- **Vue 3:** Proxy reactivity (`track`/`trigger`, `targetMap` WeakMap → Map → Set). Prefer `ref` (`reactive` loses reactivity when destructured; use `toRefs`). `computed` is cached; `watch` is lazy with old/new values; `watchEffect` auto-tracks; `nextTick` for DOM reads.
- **Vue:** `defineProps/defineEmits/defineModel`, provide/inject, scoped slots, **Pinia** (`storeToRefs`), router guards. The compiler uses patch flags and a block tree; Vapor mode is the VDOM-less future.
- **Angular:** standalone by default (v19), **`inject()`**, hierarchical DI (`providedIn: 'root'` is a singleton; component providers give one instance per component).
- **Angular change detection:** Zone.js triggers CD from the root. **OnPush** checks on input reference changes, events, the async pipe, signals and `markForCheck`. **Signals** (`signal/computed/effect/linkedSignal/resource`) enable **zoneless** mode.
- **RxJS:** `switchMap` (cancel the previous: search), `mergeMap` (parallel), `concatMap` (queue in order), `exhaustMap` (ignore while busy: submit buttons). Put `catchError` **inside** the inner stream. Avoid leaks with the `async` pipe, `takeUntilDestroyed` or `toSignal`.
- **Angular templates:** `@if/@for (track)/@switch`, **`@defer` (on viewport/idle/interaction)**. Functional guards and interceptors. Reactive forms (typed).
- **React Native:** New Architecture (JSI, Fabric, TurboModules, Codegen; the default since 0.76), Hermes bytecode, FlatList/FlashList tuning, Reanimated worklets on the UI thread.
- **RN WebRTC:** `react-native-webrtc`, CallKit/PushKit on iOS, a foreground service on Android, a ReplayKit broadcast extension for iOS screen share.
- **Choosing:** Next for SEO/content plus full stack, a SPA for real-time apps behind a login, Electron for desktop features (PiP overlays, annotations).

### State management in 8 lines

- **Classify state:** local, shared client, **server** (SWR/TanStack/RTK Query), URL, form, real-time/external, persisted.
- **Redux:** a single store, actions → pure reducers, middleware for side effects. **RTK:** `configureStore`, `createSlice` (Immer), `createAsyncThunk`, `createEntityAdapter`, listener middleware, **RTK Query** tags (`providesTags`/`invalidatesTags`).
- **Immer:** a Proxy draft with copy-on-write and **structural sharing** (unchanged branches keep their references).
- **Never store** MediaStreams, PeerConnections or class instances in Redux. Store IDs and plain data, and keep a registry elsewhere.
- **Jotai:** atoms, derived atoms, async atoms, `atomFamily`, precise re-renders. **Zustand:** `create()` + selectors on top of `useSyncExternalStore`.
- **SWR:** stale-while-revalidate, a key-based global cache, dedupe, revalidate on focus and reconnect, `mutate` / optimistic updates with rollback, `preload`. (**This app uses SWR**, with `preload` on hover.)
- **TanStack Query:** `staleTime` vs `gcTime`, `invalidateQueries`, `onMutate` snapshot → rollback in `onError` → `onSettled` invalidate.
- **Normalise** (`ids` + `entities`) for O(1) updates and stable references.

## Real-time & desktop

### WebRTC in 15 lines 🔥

- **APIs:** `getUserMedia`, `getDisplayMedia`, `RTCPeerConnection`, transceivers/senders (`replaceTrack`, `setParameters`), `RTCDataChannel`, `getStats`. **Signalling isn't part of WebRTC.**
- **Flow:** createOffer → setLocal → signal → setRemote → createAnswer → setLocal → signal → trickle ICE → connectivity checks → **DTLS** (fingerprint checked against the SDP) → **SRTP** media.
- **SDP:** BUNDLE, one `m=` section per track (Unified Plan; Plan B was removed), rtpmap/fmtp, rtcp-fb (nack, pli, transport-cc), ice-ufrag/pwd, fingerprint, setup, mid, msid, rid/simulcast.
- **ICE candidates:** host, srflx (STUN), relay (TURN), prflx. Priority = 2²⁴·type + 2⁸·local + (256 − component). Recommended type preferences: host 126, srflx 100, relay 0.
- **TURN** is needed for symmetric NAT and UDP-blocked networks. Run it on **TCP/TLS 443**, use **time-limited HMAC credentials** (`expiry:user`, HMAC-SHA1), and use coturn.
- **Topologies:** mesh (2–4 people), **SFU** (forwarding; scales; per-receiver quality), MCU (mixing; CPU-heavy).
- **Simulcast:** 3 encodings, the SFU picks one per receiver, switching needs a keyframe. **SVC:** one stream with layers (VP9/AV1, L3T3).
- **Codecs:** Opus (FEC, DTX); VP8 (mandatory); **H.264** (hardware, Safari); VP9 (SVC); AV1 (best compression, CPU-heavy). Change preferences with `setCodecPreferences`.
- **RTCP:** **NACK** + RTX (retransmit), **PLI/FIR** (keyframe), REMB / **TWCC** (bandwidth estimation), FEC/RED.
- **GCC:** a delay-based plus loss-based estimate → `availableOutgoingBitrate`. **`qualityLimitationReason`** (bandwidth/cpu) explains resolution drops.
- **Stats** are cumulative, so compute deltas: `kbps = Δbytes × 8 / Δms`, `loss% = Δlost / (Δlost + Δreceived)`.
- **Debug** with **chrome://webrtc-internals**. ICE failed usually means a firewall or TURN issue, or the JVB public IP / UDP 10000.
- **Perfect negotiation:** polite and impolite peers; the polite one rolls back on glare.
- **Device switching:** `replaceTrack` (no renegotiation). Muting with `enabled = false` keeps the camera light on; `stop()` releases the device.
- **E2EE through an SFU:** Encoded Transform / Insertable Streams. Breakout box gives raw frames for effects.

### Jitsi, Prosody & XMPP in 12 lines 🔥

- **Components:**
  - the React app + **lib-jitsi-meet** (Strophe.js)
  - **Prosody** (XMPP; rooms are MUCs; presence carries participant state)
  - **Jicofo** (focus: joins as owner, picks bridges, **sends the Jingle offer**, manages Jibri/Jigasi)
  - **JVB** (SFU on UDP 10000; simulcast/SVC, last-N, receiver constraints, Colibri2, the colibri-ws bridge channel)
  - **Jibri** (Chrome in Xvfb + ffmpeg x11grab + ALSA loopback → MP4/RTMP; one session per instance)
  - **Jigasi** (SIP gateway, transcription)
- **Stanzas:** `message` (chat), `presence` (join/leave + state broadcast), `iq` (request/response by `id`). JID: `local@domain/resource`.
- **MUC:** affiliations (owner/admin/member/none/outcast) are persistent; roles (moderator/participant/visitor) are per session.
- **Transports:** BOSH (`/http-bind`, long polling) vs **WebSocket** (`/xmpp-websocket`). XEP-0198 stream management for resumption.
- **Jingle** ↔ SDP: `session-initiate/accept`, `transport-info`, `source-add/remove`.
- **Prosody config:** VirtualHost (users log in), Component (MUC, focus, lobby, breakout, the internal MUC for breweries), modules in Lua. Token auth: `authentication = "token"`, `app_id/app_secret`, and the room claim is checked.
- **Lua module hooks:** `muc-occupant-pre-join` (return `true` to block), `muc-broadcast-presence`, `muc-occupant-joined`. Use async `net.http` and never block. **Enforce permissions on the server.**
- **JWT claims:** `iss` (app_id), `aud`, `sub`, **`room`**, `exp/nbf`, `context.user` (name, email, avatar, moderator). Short-lived, room-scoped.
- **Recording flow:** IQ `<jibri action="start">` → Jicofo picks an **idle Jibri from JibriBrewery** → Jibri joins as a hidden recorder → status via `jibri-recording-status` presence → finalize script uploads.
- **Multi-Jibri trade-off:** a Jibri per output (isolation, cost) vs one Jibri with **ffmpeg `tee`** fan-out (`onfail=ignore`) to cut cost, plus pool autoscaling on the idle count.
- **Visitors:** visitor Prosody nodes linked by s2s; receive-only media; no presence flood to the main room; promote on raise-hand. **Webinar:** visitors + cascaded JVBs + an HLS fallback for 10k+.
- **Scaling:** shards (Prosody + Jicofo + JVBs) behind HAProxy routing by room, JVB autoscaling on stress, relays (Octo) for geo-cascading.

### Electron in 8 lines

- **Processes:** main (Node, windows, IPC hub, desktopCapturer; never block it), renderers (Chromium, **sandboxed**), **preload** (`contextBridge`), utility processes.
- **IPC:** `invoke`/`handle` (async request/response); main → renderer with `webContents.send`; **MessagePorts** for high-frequency traffic. **No `sendSync`, no `remote`.** Validate `senderFrame`.
- **Security:** `contextIsolation`, `nodeIntegration: false`, `sandbox`, CSP, `setWindowOpenHandler`/`will-navigate` allow-lists, permission handlers, **Fuses**, signed updates.
- **Screen share:** `desktopCapturer.getSources` + **`setDisplayMediaRequestHandler`** with your own picker; macOS needs Screen Recording permission.
- **Annotations:** a transparent, frameless, always-on-top (`screen-saver` level) overlay with `setIgnoreMouseEvents(true, {forward: true})`. The toolbar uses **`setContentProtection(true)`** so it's excluded from capture.
- **PiP:** an always-on-top mini window via `window.open` (sharing the same MediaStreams), or Document PiP.
- **Local recording:** MediaRecorder + Web Audio mix → chunks over IPC → `fs.createWriteStream`.
- **Updates and packaging:** electron-updater with staged rollouts (never restart mid-call); electron-builder; signing and **notarisation**; `@electron/rebuild` for native modules; `backgroundThrottling: false` for call windows.

### WebSockets & real-time in 6 lines

- **Handshake:** HTTP Upgrade → `101`, `Sec-WebSocket-Accept = base64(SHA1(key + GUID))`. Frames: text/binary/ping/pong/close. Client frames are masked. Close codes 1000/1001/**1006** (abnormal)/1008/1011.
- **Choose:** SSE (server → client, auto-resume with `Last-Event-ID`), **WebSocket** (bidirectional), polling (simple), WebTransport (QUIC).
- **A robust client:** backoff + jitter reconnects, app-level heartbeats, a bounded outbox, re-subscribe and resync on reconnect, no retry on auth-failure close codes.
- **Exactly-once effect:** client message IDs + acks + server dedupe; sequence numbers + resume from the last seen.
- **Scaling:** LB with Upgrade support and long idle timeouts; **Redis pub/sub** (Socket.IO adapter) between nodes; presence via TTL keys; graceful drains on deploy.
- **Collaboration:** OT (Google Docs, Etherpad) vs **CRDT** (Yjs, Automerge). **Excalidraw** uses per-element version + `versionNonce` last-writer-wins (lower nonce wins ties).

## Web platform

### Performance, browser and HTTP numbers 🔥

- **Core Web Vitals (p75):**

| Metric | Good | Poor |
|---|---|---|
| **LCP** | ≤ 2.5 s | > 4 s |
| **INP** (replaced FID in March 2024) | ≤ 200 ms | > 500 ms |
| **CLS** | ≤ 0.1 | > 0.25 |
| TTFB | ≤ 0.8 s | — |
| FCP | ≤ 1.8 s | — |

- **Pipeline:** DOM + CSSOM → render tree → **layout** → **paint** → **composite**. Animate `transform`/`opacity` only. Batch reads before writes to avoid layout thrashing.
- **Script loading:** `defer` (in order, after parsing), `async` (as soon as downloaded, unordered), `type=module` (deferred).
- **HTTP versions:** HTTP/1.1 (about 6 connections per host), **HTTP/2** (multiplexing, HPACK; TCP head-of-line blocking), **HTTP/3** (QUIC/UDP, no head-of-line blocking, 0-RTT, connection migration).
- **Cache-Control:** hashed assets `max-age=31536000, immutable`; HTML `no-cache` (revalidate with ETag → 304); `no-store` for sensitive data; `stale-while-revalidate`; `private` vs `public`; `s-maxage` for CDNs.
- **Cookies:** `HttpOnly`, `Secure`, **`SameSite=Lax` (the default)**, `None` requires `Secure`, `Partitioned` (CHIPS), the `__Host-` prefix.
- **Storage:** cookies 4 KB (sent on every request); localStorage about 5 MB (sync, main thread only); **IndexedDB** (async, large, also in workers); Cache API (service workers).
- **CORS:** a simple request vs a **preflight** (`OPTIONS`; triggered by non-simple methods, custom headers or `application/json`). Credentials need the exact origin plus `Allow-Credentials`. It's enforced by browsers only.
- **Events:** capture → target → bubble. Delegation with `closest()`. `passive: true` for scroll and touch.
- **Latency numbers (rough):** L1 about 1 ns; RAM about 100 ns; SSD read about 100 µs; same-datacenter round trip about 0.5 ms; cross-continent round trip about 150 ms; **a 60 fps frame budget is 16.7 ms**; **a long task is > 50 ms**.

### Security & auth in 10 lines 🔥

- **XSS:** escape output, sanitise HTML (DOMPurify), allow-list URL protocols (no `javascript:`), **CSP with nonces + `strict-dynamic`**, Trusted Types, HttpOnly cookies. React escapes text, but `dangerouslySetInnerHTML` and `href` are the escape hatches.
- **CSRF:** SameSite cookies + CSRF tokens + Origin checks. Never change state on GET. Bearer tokens in headers aren't vulnerable to CSRF.
- **Clickjacking:** `frame-ancestors`. **postMessage:** check `event.origin` and validate the message shape; never use target origin `'*'` for sensitive data.
- **Headers:** HSTS, `nosniff`, Referrer-Policy, **Permissions-Policy (camera/microphone/display-capture)**, COOP/COEP.
- **Prototype pollution:** block `__proto__`/`constructor`/`prototype` keys and validate with schemas. **Open redirects:** allow only same-origin relative paths.
- **JWT:** pin the `alg` (reject `none`), select the key by `kid` from JWKS, check `exp/nbf/iss/aud`. Base64 isn't encryption.
- **OAuth 2.0 Authorization Code + PKCE:** `challenge = BASE64URL(SHA256(verifier))`. Check `state` (CSRF) and `nonce` (OIDC). Implicit and password grants are deprecated.
- **OIDC adds the ID token** (who the user is). The access token is for APIs. SAML is the XML enterprise SSO standard.
- **SPA token storage:** HttpOnly cookie or a **BFF** is best; memory next; sessionStorage (MSAL's default) after that; localStorage is riskiest. XSS hurts every option.
- **Passwords:** Argon2id/bcrypt with salt. **Passkeys/WebAuthn** are phishing-resistant. Supply chain: lockfiles, `npm ci`, provenance, minimum release age, SRI.

### Testing in 6 lines

- **Trophy:** static checks → some unit tests → **mostly integration (RTL + MSW)** → few E2E (Playwright).
- **RTL query priority:** `getByRole({ name })` > label > text > testId. `getBy` throws, `queryBy` returns null (for absence), `findBy` is async. Use **user-event** rather than fireEvent.
- **MSW** mocks at the network layer. Reset the SWR/TanStack cache per test.
- **Enzyme** (`shallow/mount/render`) is legacy, with no React 18/19 adapter, so migrate to RTL. **Jasmine** (spies, `jasmine.clock`) + **Karma** (real browsers; deprecated); Vitest browser mode replaces them.
- **Flaky tests:** wait for conditions (not sleeps), isolate state, fake or inject the clock, use MSW, fixed time zones.
- **Playwright** for multi-participant calls: browser contexts per user, `--use-fake-device-for-media-stream`, assert `bytesReceived > 0`.

## Back end & cloud

### Node, Java, Kotlin and Python in 16 lines

- **Node:** V8 + libuv. The thread pool (4 by default) runs fs/dns.lookup/crypto/zlib; network I/O uses epoll/kqueue. CPU work → **worker_threads**; cores → cluster or replicas; external tools → child_process.
- **Streams:** `write()` returning false means backpressure; wait for `'drain'`. Use **`pipeline()`**.
- **Express:** middleware order matters; error middleware takes **4 arguments** and goes last; **Express 5 catches async errors**. Graceful shutdown on SIGTERM: fail readiness → `server.close` → drain → close pools → exit.
- **Node security:** zod validation, parameterised SQL, helmet, rate limiting, IDOR checks, ReDoS and SSRF protection, run as non-root.
- **Java:** the `equals`/`hashCode` contract. **HashMap:** power-of-two buckets, `hash ^ (hash >>> 16)`, load factor 0.75 with doubling, **treeify at 8** (when capacity ≥ 64). ConcurrentHashMap uses CAS + per-bin locks and allows no nulls.
- **JVM:** heap (Eden/Survivor/Old), Metaspace, stacks. **G1 is the default.** **ZGC** gives sub-ms pauses (generational). OOM types: heap, metaspace, direct, native thread.
- **Java concurrency:** `volatile` (visibility, not atomicity) vs `synchronized` vs atomics. Deadlocks need all four Coffman conditions; prevent them with lock ordering or `tryLock`. **Virtual threads (21):** cheap blocking; don't pool them; pinning was fixed in 24.
- **Modern Java LTS releases:** 8, 11, 17 (records, sealed, pattern matching), **21** (virtual threads, pattern `switch`), **25** (scoped values, flexible constructors, compact source files).
- **Spring:** IoC/DI (constructor injection), Boot auto-configuration (conditional beans), `@Transactional` proxies (**self-invocation bypasses them**; checked exceptions don't roll back), **N+1** (fix with `JOIN FETCH` / `@EntityGraph` / batch fetching / DTOs).
- **Kotlin:** null safety (`?.`, `?:`, `!!`, `let`), `data`/`sealed`/`value` classes, scope functions (`apply` returns the object; `let` returns the result; `also` for side effects), `inline` + **`reified`**, `out`/`in` variance, `by lazy`.
- **Coroutines:** structured concurrency (a parent owns its children; failure cancels siblings unless you use `supervisorScope`), cooperative cancellation (never swallow `CancellationException`), `withContext(Dispatchers.IO)`.
- **Flow:** cold. **StateFlow** is UI state, **SharedFlow** is events, **Channel** is a queue. `flatMapLatest` is the equivalent of `switchMap`.
- **Python:** mutable default argument trap; `is None`; comprehensions and generators; decorators with `functools.wraps`; context managers.
- **Python concurrency:** the GIL means threads for I/O, processes for CPU, **asyncio** for many I/O tasks (`TaskGroup` gives structured concurrency). **3.13** introduced the free-threaded build, and **3.14** made it officially supported.

### SQL, DynamoDB and AWS in 14 lines 🔥

- **SQL logical order:** FROM/JOIN → WHERE → GROUP BY → HAVING → SELECT (window functions) → DISTINCT → ORDER BY → LIMIT. Filtering the right table in WHERE turns a LEFT JOIN into an INNER JOIN.
- **Window functions:** `ROW_NUMBER` (top-N per group), `RANK` vs `DENSE_RANK`, `LAG`/`LEAD`, `SUM() OVER (ORDER BY)` for running totals. "Gaps and islands" = date − ROW_NUMBER.
- **Indexes:** B-tree (the default), **GIN** (JSONB, full text, trigrams), BRIN (huge time-ordered tables), composite indexes (leftmost prefix; equality columns first), partial, expression, `INCLUDE` (covering). **`EXPLAIN (ANALYZE, BUFFERS)`**: compare estimated vs actual rows.
- **Isolation:** Read Committed (the Postgres default), Repeatable Read (snapshot), Serializable (SSI; retry on failure). Lost updates are fixed with `FOR UPDATE`, a version column or atomic `UPDATE`. **MVCC** needs VACUUM.
- **Keyset pagination** over OFFSET. `FOR UPDATE SKIP LOCKED` for job queues. The outbox pattern. **UUIDv7** keys (time-ordered).
- **DynamoDB:** PK (partitions) + SK (sorted ranges). **Query, not Scan.** Filters still consume RCUs. Items up to 400 KB. 1 RCU = 4 KB strongly consistent (or 2 eventually consistent); 1 WCU = 1 KB.
- **GSI vs LSI:** a GSI can have any PK, be added any time, and is eventually consistent. An LSI keeps the same PK, must be created with the table, can be strongly consistent, and limits each partition-key value to 10 GB.
- **DynamoDB design:** single-table design driven by access patterns; avoid hot partitions (write sharding); conditional writes for optimistic locking; `TransactWriteItems` (up to 100 items); Streams; TTL.
- **Lambda:** 15 min timeout, 128 MB–10 GB memory (CPU scales with it), 6 MB synchronous payload, 1,000 concurrent executions by default per Region. Cold starts: smaller bundles, provisioned concurrency, SnapStart. Async invocations retry twice → DLQ/destination. SQS event sources use visibility timeouts and partial batch responses.
- **API Gateway:** REST (usage plans, validation, caching, WAF) vs **HTTP API** (cheaper, **JWT authorizer**) vs WebSocket APIs. The REST integration timeout is 29 s by default.
- **IAM:** explicit deny > allow > implicit deny. Use roles, not keys; OIDC for CI; least privilege.
- **Cognito:** **User Pools** for authentication (JWTs) vs **Identity Pools** for temporary AWS credentials.
- **S3:** pre-signed URLs (the signer's permissions), multipart over 100 MB (required over 5 GB), SSE-S3 by default, Block Public Access, **CloudFront + OAC**, lifecycle rules, Object Lock.
- **Messaging:** SQS (queue; FIFO per message group), SNS (fan-out), **EventBridge** (rules, schedules, Pipes), Kinesis (ordered shards with replay). **Step Functions:** Standard (up to 1 year) vs Express (5 min); `waitForTaskToken` for human review.

### PostgreSQL vs MySQL & SQL scalability in 12 lines 🔥

- **Fresher traps:** `DELETE` (DML, row-logged, WHERE) vs `TRUNCATE` (DDL, fast page drop; rollbackable in PG, implicit commit in MySQL) vs `DROP` (removes structure). `NOT IN` with any `NULL` returns **0 rows** — use `NOT EXISTS`. After `LEFT JOIN`, filter right table in **`ON`** (not `WHERE`) and count with **`COUNT(right.id)`** (not `COUNT(*)`).
- **Data types:** Money = `NUMERIC`/`DECIMAL` or integer cents (never `FLOAT`). Timestamps = PG `TIMESTAMPTZ` (UTC 8B) or MySQL `DATETIME(6)` in UTC (MySQL `TIMESTAMP` overflows in **2038**!). PKs = `BIGINT` or time-ordered **`UUIDv7`** (`BINARY(16)` in MySQL).
- **Storage layout:** **Postgres** = unordered 8 KB heap pages (`ctid`) + uniform secondary indexes + TOAST (>2 KB). **MySQL InnoDB** = 16 KB **Clustered Index on PK** (table *is* the PK B+Tree; secondary indexes store PK values → bookmark double lookup; random `UUIDv4` causes page splits & secondary index bloat).
- **MVCC & updates:** **Postgres** writes a new heap tuple on `UPDATE` (needs **HOT updates** via `fillfactor` + unindexed changed cols, `autovacuum` tuned to `scale_factor = 0.01` on huge tables, and XID wraparound freeze monitoring). **InnoDB** updates in place + chains before-images in **Undo Logs** (`ReadView`).
- **Durability:** Postgres flushes **`pg_wal`** (`full_page_writes = on`, `synchronous_commit`). MySQL uses internal **Two-Phase Commit** across **InnoDB Redo Log** (`innodb_flush_log_at_trx_commit = 1` + Doublewrite Buffer) and **Server `binlog`** (`sync_binlog = 1`, `binlog_format = ROW`, GTID).
- **Locking traps:** Postgres defaults to **Read Committed** (SSI for `SERIALIZABLE`); InnoDB defaults to **Repeatable Read** using **Record, Gap `(a, b)`, and Next-Key `(a, b]` locks** (two concurrent `FOR UPDATE` misses acquire compatible Gap Locks and **deadlock** on `INSERT`!).
- **Composite indexes (ESR rule):** Order columns **`Equality → Sort → Range`** — once a range column appears, rightward columns lose sort order! Verify MySQL prefix usage via `EXPLAIN` **`key_len`**, and never compare `VARCHAR` to an `INT` in MySQL (implicit cast to float kills the index!).
- **Efficiency at 100M+ rows:** Avoid exact `COUNT(*)` (use `pg_class.reltuples`, bounded `LIMIT 10001` subqueries, counter tables, or HyperLogLog). Replace deep `OFFSET` with **keyset cursors** or **deferred joins** (covering-index IDs joined back to wide rows).
- **Hot writes & bulk lifecycle:** Break single-row lock contention with **slotted counters** ($N$ bucket rows) or Redis gatekeepers. Archive/delete old data via **partition `DROP`/`DETACH`** or **chunked `LIMIT 5000` / `SKIP LOCKED` batches** — never one giant `DELETE`.
- **Zero-downtime DDL:** **Postgres:** `SET lock_timeout = '2s'`, `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID` + `VALIDATE`. **MySQL 8.0+:** `ALGORITHM=INSTANT` for columns, **`gh-ost`** (triggerless binlog tailing) for heavy table rewrites without replica lag.
- **Scaling ladder (100 → 500k RPS):** Query/ESR index tuning → **PgBouncer (`transaction` mode) / ProxySQL** (`~100` active DB workers) → vertical NVMe/RAM → Redis cache → **Read Replicas** (guarantee Read-Your-Own-Writes via **WAL LSN / GTID causal tokens**) + CDC (`Debezium` → ClickHouse) → Partitioning → Functional Federation → **Horizontal Sharding** (`Citus` / `Vitess`, shard by `tenant_id` or `user_id`).
- **Window patterns:** Overlapping intervals = running `MAX(end_at) OVER (... 1 PRECEDING)` (not `LAG`!). Sliding fraud velocity = `RANGE BETWEEN INTERVAL '10 minutes' PRECEDING AND CURRENT ROW`. Always fill missing months (`generate_series` / `WITH RECURSIVE`) before `LAG` YoY/MoM!

### Docker, CI/CD and Git in 10 lines

- **Containers:** namespaces + cgroups + overlay layers. **Multi-stage builds**, copy lockfiles before source, `.dockerignore`, non-root user, exec-form `CMD`, no secrets in `ARG`/`ENV`, BuildKit secret mounts.
- **Exit code 137** means OOM or SIGKILL. Compose service names are DNS names. Use `depends_on` with `service_healthy`. JVB needs `10000/udp` and the advertised public IP.
- **Kubernetes:** Deployment / Service / Ingress; liveness vs **readiness** vs startup probes; SIGTERM → grace period → SIGKILL.
- **Microservice resilience:** timeouts, retries + jitter (idempotent only), **circuit breakers**, bulkheads, outbox, sagas, tracing (OpenTelemetry).
- **CI/CD:** CI → delivery (manual approval) → deployment (automatic). Rolling vs **blue-green** vs **canary**. Feature flags decouple deploy from release. Migrations use expand-and-contract.
- **Jenkins:** declarative `pipeline { agent, stages, steps, post, when, input, parallel }`, credentials store, multibranch pipelines, shared libraries.
- **Git:** **merge** (preserves history) vs **rebase** (linear history, rewritten commits; never on shared branches; `--force-with-lease`). `revert` is safe for shared branches; `reset` rewrites history (soft/mixed/hard).
- **Git recovery and debugging:** `reflog` rescues lost commits; **`bisect run`** finds regressions; `cherry-pick` for backports.
- **Branching:** trunk-based (with flags) vs GitHub Flow vs Git Flow. Conventional Commits drive semver (`feat` → minor, `fix` → patch, `!` → major).
- **Nginx for WebSockets:** `proxy_http_version 1.1` + `Upgrade`/`Connection` headers + long `proxy_read_timeout`; `try_files $uri /index.html` for SPAs.

### DSA complexity and pattern cheat sheet 🔥

| Pattern | Use when | Complexity |
|---|---|---|
| Hash map/set | complement, seen, count, group | O(n) |
| Two pointers | sorted data, pairs, palindromes, in-place | O(n) |
| Sliding window | contiguous range with a constraint | O(n) |
| Prefix sum + map | subarray sums (negatives allowed) | O(n) |
| Binary search | sorted / monotonic / "minimum feasible X" | O(log n) |
| Stack / monotonic stack | brackets, next greater, histogram | O(n) |
| Heap | top-K, kth largest, merge K, streaming median, meeting rooms | O(n log k) |
| BFS | shortest path (unweighted), levels, multi-source spread | O(V + E) |
| DFS / union-find | components, islands, cycles | O(V + E) / ~O(1) per operation |
| Topological sort (Kahn) | dependencies, build order, cycle detection | O(V + E) |
| Backtracking | subsets, permutations, combinations | O(2ⁿ) / O(n!) |
| DP | count ways, min/max cost, sequences (LIS, LCS, edit distance, knapsack) | O(n²), O(n·W), O(m·n) |
| Greedy | intervals (earliest end), jump game, gas station | O(n log n) |

- **Sorting:** merge sort is stable O(n log n) with O(n) space; quicksort averages O(n log n) with a random pivot; JS uses **TimSort** (stable); **always pass `(a, b) => a - b`**.
- **JS pitfalls:** `shift()` is O(n), so use an index-pointer queue; there's no built-in heap; recursion depth is about 10k frames; `[...str]` for emoji-safe strings.
- **Process:** clarify → examples → brute force → optimise (state the target complexity) → code → test edge cases → analyse.

## Day of the interview

### System design and behavioural checklists 🔥

**Frontend system design (RADIO):**

- **R**equirements (functional, non-functional, scale)
- **A**rchitecture diagram
- **D**ata model (server, client and URL state; normalised)
- **I**nterfaces (REST, GraphQL, WebSocket messages, pagination, errors)
- **O**ptimisations: performance, reliability (offline, retries, reconnect), a11y, i18n, security, observability, testing, trade-offs

**Ready-made designs:**

- **video-call UI** (MeetHour)
- **autocomplete** (debounce + LRU + stale guard + ARIA combobox)
- **chat** (optimistic send + cursor pagination + virtualised list)
- **collaborative editor** (OT/CRDT, Yjs, scQuill timing)
- **feed** (cursor pagination + IntersectionObserver + virtualisation)
- **dashboard table** (server-side + URL state + virtualisation)
- **PDF viewer** (PDF.js worker + range requests + page virtualisation + normalised overlays)
- **resumable upload** (S3 multipart + IndexedDB resume)

**Behavioural (STAR, about 2 minutes each, Action ≈ 60%):**

- multi-Jibri (most complex)
- React refactor (performance)
- Prosody module (ownership outside your role)
- RBF with an LLM (learning fast)
- code-review disagreement (conflict)
- a production incident (pressure)
- a missed deadline or mistake (failure)
- mentoring a junior (leadership)

**Logistics:**

- **For a video interview:** you build conferencing software, so make your **own setup flawless**: wired internet or strong Wi-Fi, a headset, good lighting, a closed-door room, browser permissions tested, a backup phone hotspot, and screen sharing tested.
- **For coding rounds:** say your plan before typing, think aloud, test with examples, state complexity, and ask clarifying questions. If you're stuck, say what you've tried and ask for a hint.
- **Finish strong:** ask two or three thoughtful questions, thank them, and send a short follow-up note if appropriate.
