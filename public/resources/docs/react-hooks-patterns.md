# React Hooks & Component Patterns

This page covers **every built-in hook at senior depth**, the bugs each one tends to cause, the custom hooks interviewers ask you to write live, and the component patterns used in production design systems.

> React code (`JSX` blocks) isn't runnable in the playground because there's no DOM or React there. The plain-`JavaScript` blocks model the same ideas (closures, effects, subscriptions) and are runnable.

## State hooks

### `useState` in depth: lazy initialisation, functional updates and object state 🔥

- **Lazy initial state:** `useState(() => expensiveParse(localStorage.getItem('x')))`. The function runs **only on the first render**. `useState(expensiveParse(...))` would run the parse on **every** render and then throw the result away.
- **Functional updates:** `setCount(c => c + 1)` when the next state depends on the previous one. It's required for multiple updates in one event, and inside closures that may be stale (timers, subscriptions).
- **No automatic merging.** Unlike class `setState`, hooks **replace** state. Use `setForm(f => ({ ...f, name }))`, or split the state into several `useState` calls.
- **Bail-out:** setting the **same** value (`Object.is`) skips the re-render. **Mutating** an object and setting it again therefore does **nothing**: `state.items.push(x); setState(state)` keeps the same reference, so React bails out. Always create new objects and arrays.
- **Resetting state when a prop changes:** don't sync with an effect. Give the component a **`key`**, or store the previous prop and adjust during render (rare).

```jsx
function MeetingNotes({ meetingId }) {
  const [draft, setDraft] = useState(() => localStorage.getItem(`notes:${meetingId}`) ?? ''); // lazy
  const [tags, setTags] = useState([]);
  const addTag = (t) => setTags((prev) => (prev.includes(t) ? prev : [...prev, t]));          // functional + immutable
  return <Editor value={draft} onChange={setDraft} onTag={addTag} />;
}
// Reset all state when switching meetings:
<MeetingNotes key={meetingId} meetingId={meetingId} />
```

### When would you choose `useReducer` over `useState`? 🔥

Choose `useReducer` when:

- the **next state depends on the previous one in complex ways**, or several values change together (e.g. a recording session's `status`, `error`, `startedAt`)
- you want **named transitions** (`dispatch({ type: 'START' })`) that make the logic explicit and **testable as a pure function**
- you need to pass **`dispatch` down**. It's **stable** across renders, so it doesn't break `memo` and it doesn't need to be in effect dependencies.
- you're modelling a **state machine** where impossible states should be impossible

```js
// The reducer is a pure function — testable without React
const initial = { status: 'idle', error: null, startedAt: null };
function recordingReducer(state, action) {
  switch (action.type) {
    case 'START_REQUESTED':
      return state.status === 'idle' || state.status === 'failed' ? { ...state, status: 'pending', error: null } : state;
    case 'STARTED':
      return state.status === 'pending' ? { ...state, status: 'on', startedAt: action.at } : state;
    case 'FAILED':
      return { ...state, status: 'failed', error: action.error };
    case 'STOPPED':
      return initial;
    default:
      throw new Error(`Unknown action ${action.type}`);
  }
}

const run = (actions) => actions.reduce(recordingReducer, initial);
test('valid transitions', () => {
  expect(run([{ type: 'START_REQUESTED' }, { type: 'STARTED', at: 1 }])).toEqual({ status: 'on', error: null, startedAt: 1 });
});
test('impossible transitions are ignored', () => {
  expect(run([{ type: 'STARTED', at: 1 }]).status).toBe('idle');                      // can't start without a request
  expect(run([{ type: 'START_REQUESTED' }, { type: 'START_REQUESTED' }]).status).toBe('pending');
});
```

## Effect hooks

### Explain `useEffect`: dependencies, cleanup and timing 🔥

`useEffect(setup, deps?)` **synchronises a component with an external system**: subscriptions, timers, network, DOM APIs, WebRTC objects.

**When it runs:**

- **After the browser paints** (passive effect).
- With **no deps array**: after every render.
- With **`[]`**: after mount only, plus cleanup on unmount.
- With **`[a, b]`**: when `a` or `b` changed (`Object.is`) since the last run.

**Cleanup:** the returned function runs **before the effect re-runs** (with the old values) and **on unmount**. Every subscription, listener, timer or connection must be undone there.

**Dependencies:** every reactive value used inside the effect (props, state, values derived from them, functions defined in the component) **must be listed**. The `react-hooks/exhaustive-deps` lint rule enforces this. **Don't lie about deps to stop it re-running.** Restructure the code instead.

```jsx
function useParticipantVolume(conference, participantId) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!conference) return;
    const onLevel = (id, value) => { if (id === participantId) setLevel(value); };
    conference.on('TRACK_AUDIO_LEVEL_CHANGED', onLevel);
    return () => conference.off('TRACK_AUDIO_LEVEL_CHANGED', onLevel); // unsubscribe the exact same function
  }, [conference, participantId]);
  return level;
}
```

### What are the most common `useEffect` mistakes? 🔥

1. **Missing cleanup**, which leaks listeners, intervals and connections. StrictMode's double mount exposes these.
2. **Missing dependencies**, which leaves **stale closures** reading old props or state.
3. **Objects or functions as dependencies** that are recreated every render, causing an **infinite loop** or constant re-subscribing. Move them inside the effect, memoise them, or depend on primitives.
4. **`async` directly as the effect** (`useEffect(async () => …)`). It returns a promise instead of a cleanup function. Define an async function inside and call it.
5. **Race conditions** when fetching: responses arrive out of order. Use an `ignore` flag or `AbortController` in the cleanup.
6. **Using effects for things that aren't side effects**:
   - **Derived state:** compute it during render (`const fullName = first + ' ' + last`). Don't mirror it into state with an effect.
   - **Event-specific logic:** "send analytics when the user clicks Join" belongs in the **event handler**, not in an effect that watches a flag.
   - **Resetting state on prop change:** use a `key`.
   - **Chains of effects** that set state, triggering other effects. Compute everything in the event handler or during render.

```jsx
// ✅ Fetch with cleanup that prevents race conditions
useEffect(() => {
  const controller = new AbortController();
  (async () => {
    try {
      const res = await fetch(`/api/meetings/${id}`, { signal: controller.signal });
      setMeeting(await res.json());
    } catch (e) {
      if (e.name !== 'AbortError') setError(e);
    }
  })();
  return () => controller.abort();
}, [id]);

// ❌ Effect for derived data — causes an extra render and can go out of sync
const [visible, setVisible] = useState([]);
useEffect(() => setVisible(items.filter(matches)), [items, matches]);
// ✅ Compute during render (memoise only if it's expensive)
const visibleItems = useMemo(() => items.filter(matches), [items, matches]);
```

### What is a stale closure in hooks? Show the interval bug and its fixes 🔥

Each render's functions **close over that render's props and state**. An effect or callback created during render #1 keeps seeing render #1's values unless it's recreated.

```jsx
function Timer() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setCount(count + 1), 1000); // ❌ `count` is always 0 here -> stuck at 1
    return () => clearInterval(id);
  }, []);                                                     // (lint would warn: missing `count`)
  return count;
}
// Fix 1: functional update — no need to read `count`
setInterval(() => setCount((c) => c + 1), 1000);
// Fix 2: keep the latest value or callback in a ref (the "latest ref" pattern)
// Fix 3: React 19.2+ useEffectEvent for non-reactive logic called from effects
```

This runnable model shows the same closure behaviour without React:

```js
function createComponent() {
  let state = 0;
  const renders = [];
  function render() {
    const count = state;                          // this render's snapshot
    const tickStale = () => { state = count + 1; }; // closes over `count`
    const tickFresh = () => { state = state + 1; }; // "functional update": reads the latest
    renders.push(count);
    return { tickStale, tickFresh };
  }
  return { render, get state() { return state; } };
}

const c1 = createComponent();
const { tickStale } = c1.render();               // effect created once on mount
tickStale(); tickStale(); tickStale();           // three interval ticks
console.log('stale closure result:', c1.state);

const c2 = createComponent();
const { tickFresh } = c2.render();
tickFresh(); tickFresh(); tickFresh();
console.log('functional update result:', c2.state);

test('stale closure keeps reading the first render value', () => {
  expect(c1.state).toBe(1);
  expect(c2.state).toBe(3);
});
```

### `useEffect` vs `useLayoutEffect` vs `useInsertionEffect` 🔥

| Hook | Runs | Blocks paint? | Use for |
|---|---|---|---|
| `useEffect` | after paint | No | Subscriptions, fetching, logging, most side effects |
| `useLayoutEffect` | after DOM mutation, **before paint** | **Yes** | Measuring the DOM (size, position) and synchronously re-rendering to avoid flicker: tooltips, popovers, scroll restoration, auto-sizing textareas |
| `useInsertionEffect` | before layout effects | Yes | **Only** for CSS-in-JS libraries injecting `<style>` tags before layout reads |

- Overusing `useLayoutEffect` hurts performance, because it blocks painting.
- During SSR, layout effects don't run (React warns). Use `useEffect`, or guard with an isomorphic layout-effect helper.

### What is `useEffectEvent` and what problem does it solve?

`useEffectEvent` (stable in **React 19.2**) creates an **"effect event"**: a function that always sees the **latest** props and state, but is **not reactive**. Calling it from an effect doesn't make the effect depend on the values it reads.

Use case: in a chat room effect, you want to **re-connect only when `roomId` changes**, but the `onConnected` notification should use the current `theme`. Without effect events, `theme` becomes a dependency, so changing the theme reconnects the room.

```jsx
function ChatRoom({ roomId, theme }) {
  const onConnected = useEffectEvent(() => showNotification('Connected!', theme)); // reads the latest theme
  useEffect(() => {
    const conn = createConnection(roomId);
    conn.on('connected', () => onConnected());
    conn.connect();
    return () => conn.disconnect();
  }, [roomId]);   // theme is NOT a dependency
}
```

Before it existed, the workaround was the **"latest ref" pattern**: store the callback in a ref that you update every render, and call `ref.current()` inside the effect.

## Refs & imperative APIs

### What is `useRef` used for? Ref vs state 🔥

`useRef(initial)` returns a **mutable object** `{ current }` that **persists for the component's lifetime**. **Changing `.current` doesn't trigger a re-render.**

**Uses:**

1. **DOM access:** focus, measure, scroll, attaching a `MediaStream` to `<video>.srcObject`, canvas drawing.
2. **Mutable instance values** that shouldn't render: timer IDs, the previous value, "is mounted" flags, a WebSocket or `RTCPeerConnection` instance, the latest callback.
3. **Caching** expensive objects created once (lazy pattern: `if (ref.current === null) ref.current = new Thing()`).

**Rule:** if the value is **shown in the UI**, it belongs in state. If it's **bookkeeping**, it belongs in a ref. Don't read or write `ref.current` **during render**, except for lazy initialisation, because it makes render impure.

```jsx
function VideoTile({ stream }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;           // MediaStreams can't be set via a JSX attribute
    return () => { el.srcObject = null; };
  }, [stream]);
  return <video ref={videoRef} autoPlay playsInline muted />;
}

function usePrevious(value) {
  const ref = useRef();
  useEffect(() => { ref.current = value; }, [value]);
  return ref.current;                // the value from the previous render
}
```

### What are callback refs and when do you need them?

A **callback ref** is a function React calls with the DOM node when it **attaches** (and with `null` when it detaches). In React 19 it can also **return a cleanup function**. Use callback refs when you need to **react to the node appearing**: measuring a conditionally rendered element, attaching a `ResizeObserver`, or handling a list of refs.

```jsx
function AutoMeasure() {
  const [height, setHeight] = useState(0);
  const measuredRef = useCallback((node) => {
    if (!node) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(node);
    return () => ro.disconnect();     // React 19: cleanup returned from the ref callback
  }, []);
  return <div ref={measuredRef}>Height: {height}px</div>;
}
```

### `forwardRef` and `useImperativeHandle`: what changed in React 19?

- **React 19:** function components receive **`ref` as a normal prop**, so `forwardRef` is unnecessary (it will be deprecated). Before 19, `forwardRef((props, ref) => …)` was required to pass a ref through to a child DOM node.
- **`useImperativeHandle(ref, () => api, deps)`** exposes a **custom, limited imperative API** instead of the raw DOM node. Examples: `play()`, `focus()`, `scrollToMessage(id)`. Use it sparingly; prefer declarative props.

```jsx
// React 19 style
function MediaPlayer({ src, ref }) {
  const videoRef = useRef(null);
  useImperativeHandle(ref, () => ({
    play: () => videoRef.current.play(),
    seek: (t) => { videoRef.current.currentTime = t; },
  }), []);
  return <video ref={videoRef} src={src} />;
}
// Parent: playerRef.current.seek(42) — used in scQuill-style "click a word to seek"
```

## Performance hooks

### When should you use `useMemo` and `useCallback`, and when not? 🔥

- **`useMemo(() => compute(a, b), [a, b])`** caches a **computed value**.
- **`useCallback(fn, deps)`** caches a **function identity**. It's equivalent to `useMemo(() => fn, deps)`.

**Use them when:**

1. The computation is **measurably expensive**: filtering or sorting thousands of items, heavy formatting.
2. You need **referential stability** for:
   - props passed to **`React.memo`** children (otherwise memo is useless)
   - values in **dependency arrays** of other hooks (to avoid re-running effects)
   - context `value` objects
   - values passed to non-React code that compares by identity

**Don't use them when:**

- the computation is cheap: memoisation has its own cost (dependency comparison, memory, code noise)
- the child isn't memoised anyway

**With the React Compiler**, most manual memoisation becomes unnecessary.

```jsx
const ParticipantList = memo(function ParticipantList({ participants, onMute }) { /* … */ });

function Sidebar({ participants, conference }) {
  const sorted = useMemo(() => [...participants].sort(byJoinTime), [participants]);   // expensive + stable ref
  const onMute = useCallback((id) => conference.muteParticipant(id), [conference]);    // stable for memo child
  return <ParticipantList participants={sorted} onMute={onMute} />;
}
```

### What does `React.memo` do and what are its pitfalls?

`React.memo(Component, areEqual?)` skips re-rendering when props are **shallowly equal** (`Object.is` per prop).

**Pitfalls:**

- **Inline objects, arrays or functions** in props (`style={{…}}`, `onClick={() => …}`) are new each render, which **defeats memo**.
- **`children`** is a new element each render, which also defeats memo, unless the children are stable.
- Context changes and the component's own state still re-render it.
- A custom `areEqual` that ignores props can cause **stale UI bugs**.
- Wrapping everything in memo adds comparison overhead and complexity. Apply it to **measured hot spots**, such as video tiles in a 50-person grid or rows in large lists.

## Context, IDs & external stores

### How do you use `useContext` well? Show a production-quality pattern 🔥

```jsx
const MeetingStateContext = createContext(null);
const MeetingActionsContext = createContext(null);

export function MeetingProvider({ children }) {
  const [state, dispatch] = useReducer(meetingReducer, initialMeetingState);
  // actions object is stable because dispatch is stable
  const actions = useMemo(() => ({
    mute: (id) => dispatch({ type: 'mute', id }),
    raiseHand: (id) => dispatch({ type: 'raiseHand', id }),
  }), []);
  return (
    <MeetingActionsContext value={actions}>          {/* React 19: <Context> as provider */}
      <MeetingStateContext value={state}>{children}</MeetingStateContext>
    </MeetingActionsContext>
  );
}

export function useMeetingState() {
  const ctx = useContext(MeetingStateContext);
  if (ctx === null) throw new Error('useMeetingState must be used within MeetingProvider');
  return ctx;
}
export function useMeetingActions() {
  const ctx = useContext(MeetingActionsContext);
  if (ctx === null) throw new Error('useMeetingActions must be used within MeetingProvider');
  return ctx;
}
```

**Why it's good:**

- Components that only **dispatch actions** (buttons) don't re-render when state changes, because state and actions live in **separate contexts**.
- The guard hook gives a clear error when the provider is missing.
- The memoised actions object stays stable.

### What is `useId` for?

`useId()` generates a **unique, stable ID that matches between server and client**. Use it for **accessibility attributes** linking elements: `htmlFor`/`id`, `aria-describedby`, `aria-labelledby`. Don't use `Math.random()` or a global counter, which cause hydration mismatches. **Don't** use it for list keys.

```jsx
function Field({ label, error, ...props }) {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={error ? `${id}-err` : undefined} aria-invalid={!!error} {...props} />
      {error && <p id={`${id}-err`} role="alert">{error}</p>}
    </>
  );
}
```

### How does `useSyncExternalStore` work? Implement a tiny store hook with it 🔥

`useSyncExternalStore(subscribe, getSnapshot)` subscribes a component to a store outside React (Redux, a WebRTC stats emitter, `matchMedia`, `navigator.onLine`) **safely under concurrent rendering**.

The plain-JS store below is the same shape as Zustand's vanilla core:

```js
function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  return {
    getState: () => state,                                 // getSnapshot: must return a cached value
    setState: (partial) => {
      const next = typeof partial === 'function' ? partial(state) : partial;
      if (Object.is(next, state)) return;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// React hook: const useStore = (selector) => useSyncExternalStore(store.subscribe, () => selector(store.getState()));
const store = createStore({ participants: 2, recording: false });
const seen = [];
const unsubscribe = store.subscribe(() => seen.push(store.getState().participants));
store.setState({ participants: 3 });
store.setState((s) => ({ participants: s.participants + 1 }));
unsubscribe();
store.setState({ participants: 99 });
console.log(seen, store.getState());

test('subscribers are notified until they unsubscribe', () => {
  expect(seen).toEqual([3, 4]);
  expect(store.getState().participants).toBe(99);
});
```

**Selector gotcha:** `() => selector(state)` must return the **same reference** when nothing relevant changed. Returning `state.list.filter(...)` creates a new array every time and causes an infinite render loop. Memoise the selector, or select primitives.

## React 19 hooks

### Explain `useOptimistic`, `useActionState`, `useFormStatus` and `use` 🔥

- **`useOptimistic(state, updateFn?)`** returns `[optimisticState, addOptimistic]`. During an Action (a transition), you show the optimistic value immediately. When the action completes, React **automatically reverts to the real state**, which by then contains the server result.
  - Example: a chat message appears instantly in a "sending…" style.
- **`useActionState(action, initialState)`** returns `[state, dispatchAction, isPending]`. It wraps an async action, tracks its **last result** (e.g. validation errors) and **pending** status, and works with `<form action={dispatchAction}>`, including progressive enhancement with Server Functions.
- **`useFormStatus()`**, called from a component **inside** a `<form>`, returns `{ pending, data, method, action }` for that form. It's ideal for a reusable `<SubmitButton>`.
- **`use(promiseOrContext)`** reads a promise, suspending until it resolves (errors go to the error boundary), or reads a context. It **can be called inside conditions and loops**, unlike other hooks. Don't create the promise during render without caching it, or it re-suspends forever.

```jsx
function Chat({ messages, sendMessage }) {
  const [optimisticMessages, addOptimistic] = useOptimistic(
    messages,
    (current, text) => [...current, { id: `tmp-${Date.now()}`, text, sending: true }],
  );
  async function formAction(formData) {
    const text = formData.get('text');
    addOptimistic(text);              // instant UI
    await sendMessage(text);          // when this resolves, parent state updates; optimistic entry is replaced
  }
  return (
    <>
      {optimisticMessages.map((m) => <p key={m.id} style={{ opacity: m.sending ? 0.5 : 1 }}>{m.text}</p>)}
      <form action={formAction}><input name="text" /><SubmitButton /></form>
    </>
  );
}
```

## Custom hooks (live-coding favourites)

### Write a `useDebounce` hook and a `useDebouncedCallback` hook 🔥

```jsx
// Debounce a VALUE (e.g. a search query)
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);          // each change resets the timer
  }, [value, delay]);
  return debounced;
}

// Debounce a CALLBACK while always calling the latest version of it
function useDebouncedCallback(callback, delay = 300) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => { callbackRef.current = callback; });       // latest-ref pattern
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);          // clear on unmount
  return useCallback((...args) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => callbackRef.current(...args), delay);
  }, [delay]);
}

function Search() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebounce(q, 300);
  const { data } = useSWR(debouncedQ ? `/api/search?q=${encodeURIComponent(debouncedQ)}` : null, fetcher);
  return <input value={q} onChange={(e) => setQ(e.target.value)} />;
}
```

### Write a `useFetch` hook with loading, error, abort and refetch 🔥

```jsx
function useFetch(url, options) {
  const [state, setState] = useState({ data: null, error: null, loading: !!url });
  const [nonce, setNonce] = useState(0);                        // bump to refetch

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url, { ...options, signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => {
        if (error.name !== 'AbortError') setState((s) => ({ ...s, error, loading: false }));
      });
    return () => controller.abort();                            // cancel on url change / unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options should be memoised by the caller
  }, [url, nonce]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refetch };
}
```

**Interview follow-up:** "Would you write this in production?" Usually not. **SWR, TanStack Query or RTK Query** add caching, deduplication, revalidation, retries, pagination and devtools. Writing the hook shows you understand what those libraries solve.

### Write `useLocalStorage` (synced across tabs)

```jsx
function useLocalStorage(key, initialValue) {
  const read = useCallback(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initialValue : JSON.parse(raw);
    } catch {
      return initialValue;                         // private mode / corrupted JSON
    }
  }, [key]);                                       // initialValue intentionally read once

  const [value, setValue] = useState(read);

  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try { localStorage.setItem(key, JSON.stringify(resolved)); } catch { /* quota */ }
      return resolved;
    });
  }, [key]);

  useEffect(() => {
    const onStorage = (e) => { if (e.key === key) setValue(read()); }; // other tabs
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, read]);

  return [value, set];
}
```

### Write `useInterval` (Dan Abramov's pattern) and `useEventListener`

```jsx
function useInterval(callback, delay) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; }, [callback]);  // always call the latest callback
  useEffect(() => {
    if (delay === null) return;                                  // pause by passing null
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

function useEventListener(target, type, handler, options) {
  const saved = useRef(handler);
  useEffect(() => { saved.current = handler; }, [handler]);
  useEffect(() => {
    const el = target?.current ?? target ?? window;
    if (!el?.addEventListener) return;
    const listener = (e) => saved.current(e);
    el.addEventListener(type, listener, options);
    return () => el.removeEventListener(type, listener, options);
  }, [target, type, options?.capture, options?.passive]);
}
```

### Write `useMediaQuery` and `useOnClickOutside`

```jsx
function useMediaQuery(query) {
  const subscribe = useCallback((cb) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', cb);
    return () => mql.removeEventListener('change', cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function useOnClickOutside(ref, onOutside) {
  useEffect(() => {
    const listener = (e) => {
      if (!ref.current || ref.current.contains(e.target)) return;
      onOutside(e);
    };
    document.addEventListener('pointerdown', listener);
    return () => document.removeEventListener('pointerdown', listener);
  }, [ref, onOutside]);
}
```

### Write a `useMediaDevices` hook for a conferencing app (camera/mic list)

It's directly relevant to MeetHour and shows real-world hook design: subscriptions, permissions and cleanup.

```jsx
function useMediaDevices() {
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [], audiooutput: [] });
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices(); // labels are empty until permission is granted
        if (cancelled) return;
        const grouped = { audioinput: [], videoinput: [], audiooutput: [] };
        list.forEach((d) => grouped[d.kind]?.push({ id: d.deviceId, label: d.label || `${d.kind} ${grouped[d.kind].length + 1}` }));
        setDevices(grouped);
      } catch (e) {
        if (!cancelled) setError(e);
      }
    };
    load();
    navigator.mediaDevices.addEventListener('devicechange', load);  // headset plugged in/out
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', load);
    };
  }, []);

  return { ...devices, error };
}
```

## Component patterns

### Explain the Compound Components pattern (build Tabs) 🔥

**Compound components** share implicit state through context, so consumers compose them declaratively (`<Tabs><Tabs.List>…`). It's used by Radix, Headless UI and Reach. It avoids "prop explosion" (`tabs={[...]}`, `renderTab`, `tabClassName`…) and gives users control over the markup.

```jsx
const TabsContext = createContext(null);
const useTabs = () => {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs.* must be used inside <Tabs>');
  return ctx;
};

function Tabs({ defaultValue, value: controlled, onChange, children }) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const value = controlled ?? uncontrolled;                     // supports controlled & uncontrolled
  const setValue = (v) => { if (controlled === undefined) setUncontrolled(v); onChange?.(v); };
  const baseId = useId();
  return <TabsContext value={{ value, setValue, baseId }}>{children}</TabsContext>;
}

Tabs.List = function List({ children }) {
  return <div role="tablist">{children}</div>;
};
Tabs.Tab = function Tab({ value, children }) {
  const { value: active, setValue, baseId } = useTabs();
  const selected = active === value;
  return (
    <button role="tab" id={`${baseId}-tab-${value}`} aria-selected={selected}
      aria-controls={`${baseId}-panel-${value}`} tabIndex={selected ? 0 : -1} onClick={() => setValue(value)}>
      {children}
    </button>
  );
};
Tabs.Panel = function Panel({ value, children }) {
  const { value: active, baseId } = useTabs();
  if (active !== value) return null;
  return <div role="tabpanel" id={`${baseId}-panel-${value}`} aria-labelledby={`${baseId}-tab-${value}`}>{children}</div>;
};

// Usage
<Tabs defaultValue="chat">
  <Tabs.List><Tabs.Tab value="chat">Chat</Tabs.Tab><Tabs.Tab value="people">Participants</Tabs.Tab></Tabs.List>
  <Tabs.Panel value="chat"><ChatPanel /></Tabs.Panel>
  <Tabs.Panel value="people"><ParticipantsPanel /></Tabs.Panel>
</Tabs>
```

A complete version also adds **keyboard navigation** (arrow keys move between tabs, Home/End). Mentioning that shows accessibility awareness.

### Render props vs HOCs vs custom hooks: compare them 🔥

| Pattern | Example | Pros | Cons |
|---|---|---|---|
| **HOC** (function that takes a component and returns an enhanced one) | `withAuth(Dashboard)`, `connect()` from old react-redux | Cross-cutting concerns, works with classes | Wrapper hell, prop-name collisions, opaque prop origins, ref forwarding hassle, static hoisting |
| **Render props** (`children` as a function) | `<Mouse>{({x, y}) => …}</Mouse>`, `<Formik>` | Explicit data flow, flexible rendering | Nesting ("callback pyramid"), new function each render |
| **Custom hooks** | `useAuth()`, `useMouse()` | **Composable**, no extra components in the tree, clear data flow, easy to test | Can't wrap rendering itself; hooks rules apply |

Today, **custom hooks are the default** for sharing **logic**. HOCs are still useful for **wrapping rendering** (route guards, error-boundary wrappers, `memo`, `observer` in MobX). Render props remain useful for **headless components** that need to delegate markup (e.g. a virtualised list's `renderItem`).

```jsx
// HOC: route guard
function withRole(Component, role) {
  function Guarded(props) {
    const { user } = useAuth();
    if (!user) return <Navigate to="/login" />;
    if (!user.roles.includes(role)) return <Forbidden />;
    return <Component {...props} />;
  }
  Guarded.displayName = `withRole(${Component.displayName || Component.name})`;
  return Guarded;
}
export default withRole(RecordingsPage, 'host');
```

### What are headless components and the "state reducer" / prop getters patterns?

- **Headless components or hooks** provide **behaviour and accessibility without styles or markup**. Examples: Downshift (`useCombobox`), TanStack Table, React Aria, Radix primitives. Design systems wrap them with their own styling.
- **Prop getters:** the hook returns functions like `getInputProps()` and `getItemProps({ item })` that **merge** the user's props with the required ARIA attributes and handlers, so composition stays correct.
- **State reducer pattern:** users pass a `stateReducer(state, action)` to **override internal state transitions**. For example, "don't close the menu after selecting". This is **inversion of control** without forking the library.

### How do you avoid prop drilling?

1. **Component composition first:** pass components as `children` or slots, so intermediate components don't need to know about the data. This is "lift content up", and it's often enough.
2. **Context** for low-frequency, widely needed values (theme, current user, locale, a conference instance).
3. A **state library** (Redux, Zustand, Jotai) for frequently changing shared state with selectors.
4. **Colocate state** in the lowest common ancestor that needs it. Don't hoist everything to the top.

### What are error handling patterns in React beyond error boundaries?

- **Event handlers and async code:** try/catch, then set an error state or show a toast. Use `useErrorBoundary().showBoundary(error)` from `react-error-boundary` to escalate to the nearest boundary.
- **Data libraries:** SWR and TanStack Query expose `error` per query, with retry and backoff built in. Suspense-mode queries throw to boundaries.
- **Global handlers:** `window.onerror` and `unhandledrejection` for logging (Sentry).
- **Granular boundaries** around independent widgets (whiteboard, chat, video grid), so one failure doesn't blank the app. Add **reset keys** to recover when the inputs change.
- **User-facing messages:** say what happened and what the user can do (retry, rejoin). Log technical details separately.

### How do you build accessible modals in React?

- Prefer the native **`<dialog>`** element with `showModal()`. It renders in the top layer, makes the background inert, closes on Escape, and stacks properly. Alternatively, use a portal plus a focus trap.
- Add `aria-labelledby` (the title) and `aria-describedby`. **Move focus** into the dialog on open and **restore focus** to the trigger on close.
- Prevent background scroll. Make sure screen readers don't read the background (`inert` attribute or `aria-hidden` on siblings).
- Close on Escape and on backdrop click (optional), and keep the close button keyboard-reachable.

```jsx
function Modal({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby="modal-title" onClose={onClose} onCancel={onClose}>
      <h2 id="modal-title">{title}</h2>
      {children}
      <button onClick={onClose}>Close</button>
    </dialog>
  );
}
```

### How do you handle forms at scale in React? 🔥

- **Small forms:** controlled inputs with `useState`, or React 19 `<form action>` + `FormData` + `useActionState`.
- **Large or complex forms:** **React Hook Form**. It uses uncontrolled inputs and refs, so it re-renders minimally. Use **schema validation** with zod (`zodResolver`) so the same schema validates on the client and the server, `useFieldArray` for dynamic rows, and `Controller` for third-party inputs.
- **UX essentials:**
  - validate on blur, then on change after the first error
  - show errors next to fields, linked with `aria-describedby`
  - disable submit while pending, without disabling the inputs
  - preserve input on error
  - focus the first invalid field
- **Server errors:** map API field errors back to fields (`setError('email', …)`).
