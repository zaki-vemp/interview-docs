# React Internals & React 19

React is your primary skill, so interviewers will push past "how do I use hooks" into **how React actually works**: reconciliation, Fiber, render vs commit, batching, concurrent rendering, Suspense, hydration, Server Components and what changed in React 18 and 19. Being able to explain the *mechanism* is what separates senior candidates.

## Rendering model

### What is the Virtual DOM? Is it faster than the real DOM? 🔥

The **Virtual DOM** is a lightweight JavaScript **description of the UI**: a tree of plain objects (React elements) like `{ type: 'div', props: { className, children } }`. Each render produces a new tree. React **diffs** it against the previous one (reconciliation) and applies **only the necessary DOM operations** in a batch.

**Is it faster?** Not inherently. Hand-written, targeted DOM updates are faster than diffing plus updating. The Virtual DOM's value is that it makes **declarative UI fast enough**. You describe *what* the UI should look like for a given state, and React works out *how* to update it efficiently. Other benefits:

- It **batches** DOM writes, avoiding layout thrashing from interleaved reads and writes.
- It's **platform-agnostic**: the same model renders to the DOM, native views (React Native) and canvases.
- It enables scheduling (Fiber) and server rendering.

Note: frameworks like **Svelte** and **Solid** avoid a VDOM entirely, using compile-time or fine-grained reactivity. Vue uses a VDOM with compiler hints. React's approach is not the only one, and saying so shows breadth.

```js
// JSX compiles to function calls that create plain objects (React 17+ automatic runtime: jsx())
// <Tile name="Asha" muted /> -> jsx(Tile, { name: 'Asha', muted: true })
// ($$typeof is Symbol.for('react.transitional.element') in React 19, 'react.element' before. It blocks JSON-injected fake elements.)
const element = { $$typeof: Symbol.for('react.transitional.element'), type: 'div', props: { className: 'tile', children: 'Asha' }, key: null };
console.log(element);
```

### Explain reconciliation and React's diffing heuristics 🔥

A general tree diff is **O(n³)**. React uses heuristics that make it **O(n)**:

1. **Different element types → tear down and rebuild.**
   - If `<div>` becomes `<span>`, or `<ProfileCard>` becomes `<SettingsCard>`, React **unmounts** the old subtree (destroying its state and DOM) and mounts a new one.
   - The same happens when a component *definition* changes identity. Defining a component **inside another component's render** creates a new type every render, so it **remounts every time**: a classic bug.
2. **Same type:**
   - For **DOM elements**, React keeps the DOM node and updates only the changed attributes.
   - For **components**, React keeps the instance and its state, and re-renders it with the new props.
3. **Lists use `key`** to match children between renders. Without keys, React matches by **index**. With keys, it can detect moves, insertions and deletions and **preserve the right state**.

```jsx
function Parent() {
  // ❌ A new component type every render -> Child remounts and loses state on every Parent render
  const Child = () => <input />;
  return <Child />;
}
// ✅ Define components at module level
```

### Why do keys matter? What goes wrong with array index as a key? 🔥

Keys tell React **which item is which** across renders. With **index keys**, when items are inserted at the start, removed or reordered, the index-to-item mapping shifts. React then **reuses the wrong component instance** for an item:

- **State** (input text, checkbox state, an expanded flag) ends up attached to the wrong row.
- **Performance** suffers: every row "changes", so all of them update instead of one insert.
- Uncontrolled inputs show stale values. Animations jump.

**Rules:**

- Use a **stable, unique ID** from the data.
- Index keys are acceptable only for **static lists** that never reorder or filter, and whose items have no state.
- Never use `Math.random()` keys: every render remounts everything.
- Keys must be unique **among siblings** only.

```js
// Simulate how React matches old children to new children by key vs by index.
function match(oldList, newList, keyOf) {
  const oldByKey = new Map(oldList.map((item, i) => [keyOf(item, i), item]));
  return newList.map((item, i) => {
    const prev = oldByKey.get(keyOf(item, i));
    return `${item.name} gets state from: ${prev ? prev.name : '(new instance)'}`;
  });
}

const before = [{ id: 'b', name: 'Bob' }, { id: 'c', name: 'Cara' }];
const after = [{ id: 'a', name: 'Asha' }, ...before];          // insert at the top

console.log('index keys:', match(before, after, (_, i) => i));
console.log('id keys   :', match(before, after, (item) => item.id));

test('index keys attach state to the wrong items after an insert', () => {
  expect(match(before, after, (_, i) => i)[0]).toBe('Asha gets state from: Bob');
  expect(match(before, after, (x) => x.id)[0]).toBe('Asha gets state from: (new instance)');
});
```

**Pro tip:** changing a component's `key` on purpose is the idiomatic way to **reset its state** (e.g. `<Editor key={documentId} />`).

### What is React Fiber? 🔥

**Fiber** is React's reconciliation engine, rewritten for React 16. A **fiber** is a JavaScript object representing **a unit of work** for one component or element. It holds:

- `type`, `key`, `props` (`pendingProps`/`memoizedProps`)
- `memoizedState`, which for function components is the **linked list of hooks**
- an `updateQueue`
- `flags` (side effects to apply: placement, update, deletion)
- `lanes` (priority)
- tree pointers **`child`, `sibling`, `return`** (parent). The tree is a linked structure, so React can walk it **iteratively** and **pause and resume**, unlike a recursive call stack.
- `alternate`: React keeps **two trees**, the **current** tree (what's on screen) and the **work-in-progress** tree being built. Each fiber points to its counterpart, like **double buffering**. On commit, the work-in-progress tree becomes current.

**What Fiber enabled:**

- **Interruptible rendering:** the render phase can **yield** to the browser (time slicing, roughly 5 ms chunks) and resume, or abandon work when a higher-priority update arrives.
- **Priorities ("lanes"):** urgent updates (typing, clicks) can jump ahead of non-urgent ones (transitions).
- Suspense, error boundaries, fragments, portals and concurrent features.

Before Fiber, the "stack reconciler" rendered recursively and **couldn't be interrupted**, so large updates blocked the main thread.

### What happens in the render phase vs the commit phase? 🔥

**Render phase (pure, interruptible in concurrent mode):**

- React calls your components (function bodies, class `render`) to compute the new element tree, then reconciles it against the current fibers and marks effects.
- **No DOM changes happen here.**
- In concurrent rendering, it may run **more than once** or be **thrown away**, so **render must be pure**: no side effects, no subscriptions, no mutating external variables. StrictMode double-invokes renders in development to surface impurity.

**Commit phase (synchronous, can't be interrupted):**

1. **Before mutation:** `getSnapshotBeforeUpdate` (e.g. read scroll position).
2. **Mutation:** apply DOM insertions, updates and deletions; detach old refs. **`useInsertionEffect`** runs here, for CSS-in-JS libraries that inject styles.
3. **Layout:** attach refs, then run **`useLayoutEffect`** callbacks and `componentDidMount`/`componentDidUpdate`. These run **before the browser paints**, so DOM measurement and synchronous re-layout don't flicker.
4. The browser **paints**.
5. **Passive effects:** **`useEffect`** callbacks run **after paint**, asynchronously. If a later update forces it, React flushes them before the next render.

```jsx
function Tooltip({ anchorRect }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(ref.current.getBoundingClientRect().height); // measure before paint -> no flicker
  }, []);
  useEffect(() => {
    analytics.track('tooltip_shown');                       // non-visual side effect after paint
  }, []);
  return <div ref={ref} style={{ top: anchorRect.top - height }}>…</div>;
}
```

### When does a component re-render? 🔥

A component re-renders when:

1. **Its state changes** (`setState` with a value that isn't `Object.is`-equal to the current one).
2. **Its parent re-renders.** By default all children re-render, **regardless of whether their props changed**. Props changing is not the trigger; the parent rendering is.
3. **A context it consumes changes** (`useContext`, or `use(Context)` in React 19), comparing `value` with `Object.is`.
4. A subscribed external store changes (`useSyncExternalStore`, which is what `useSelector` uses).

**How to skip re-renders:**

- **`React.memo(Component)`** skips re-rendering when props are shallowly equal.
- **Bail-out on equal state:** `setCount(5)` when the count is already 5 bails out (React may still render that component once before bailing).
- **Composition:** pass components as `children` so they're created by a parent that doesn't re-render ("lift content up").
- **Move state down** so updates affect a smaller subtree.

**A re-render is not a DOM update.** It's a function call plus a diff. Re-renders are usually cheap; optimise only measured hot spots.

### Is `setState` synchronous or asynchronous? What is batching? 🔥

`setState` **schedules** an update. The state variable in the current render **doesn't change**; you see the new value in the **next render**. React **batches** multiple updates into a single re-render.

- **React 17 and earlier:** batching happened only inside React event handlers. Updates in `setTimeout`, promises or native listeners caused **one render per `setState`**.
- **React 18+ (`createRoot`)** has **automatic batching everywhere**: timeouts, promises, native events.
- `flushSync(() => setState(...))` forces a synchronous render and commit. It's rarely needed, for example to measure the DOM right after an update.
- **Use functional updates** when the next state depends on the previous one: `setCount(c => c + 1)`. Calling `setCount(count + 1)` three times in one handler increments **once**, because all three read the same `count` from the closure.

```js
// Model of React's update queue: updates are queued and processed in the next render
function createStateHook(initial) {
  let state = initial;
  let queue = [];
  const setState = (update) => queue.push(update);
  const render = () => {
    for (const u of queue) state = typeof u === 'function' ? u(state) : u;
    queue = [];
    return state;
  };
  return { get state() { return state; }, setState, render };
}

const a = createStateHook(0);
const countInThisRender = a.state;          // the closure captured 0
a.setState(countInThisRender + 1);
a.setState(countInThisRender + 1);
a.setState(countInThisRender + 1);
console.log('value-based updates ->', a.render());

const b = createStateHook(0);
b.setState((c) => c + 1);
b.setState((c) => c + 1);
b.setState((c) => c + 1);
console.log('functional updates   ->', b.render());

test('functional updates compose', () => {
  expect(a.state).toBe(1);
  expect(b.state).toBe(3);
});
```

### How do hooks work internally? Why are there "Rules of Hooks"? 🔥

Hooks are stored **per component fiber** as an **ordered linked list** (`fiber.memoizedState`). React doesn't know hooks by name; it identifies them by **call order**. On each render, the Nth `useState` call reads the Nth hook slot.

So:

- **Only call hooks at the top level.** No conditions, loops or early returns before hooks. Otherwise the order shifts and hooks read the wrong slots.
- **Only call hooks from React function components or custom hooks**, because hooks need a "currently rendering fiber".

The ESLint plugin `react-hooks/rules-of-hooks` enforces both. Here is a **runnable mini hooks runtime** showing exactly why order matters:

```js
// A tiny hooks runtime: hooks stored in an array, identified by call order
function createRuntime(Component) {
  const hooks = [];
  const effects = [];
  let index = 0;
  let output;

  function useState(initial) {
    const i = index++;
    if (hooks[i] === undefined) hooks[i] = { value: typeof initial === 'function' ? initial() : initial };
    const slot = hooks[i];
    const setState = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next;
      if (Object.is(value, slot.value)) return;   // bail out
      slot.value = value;
      render();                                   // re-render (real React schedules & batches)
    };
    return [slot.value, setState];
  }

  function useEffect(fn, deps) {
    const i = index++;
    const prev = hooks[i];
    const changed = !prev || !deps || deps.some((d, k) => !Object.is(d, prev.deps[k]));
    if (changed) {
      effects.push(() => {
        prev?.cleanup?.();
        hooks[i] = { deps, cleanup: fn() };
      });
    } else hooks[i] = prev;
  }

  function useRef(initial) {
    const i = index++;
    hooks[i] ??= { current: initial };
    return hooks[i];
  }

  function render() {
    index = 0;                                     // order-based identity
    output = Component({ useState, useEffect, useRef });
    effects.splice(0).forEach((run) => run());     // "commit": run effects after render
    return output;
  }
  return { render, get output() { return output; } };
}

const log = [];
function Counter({ useState, useEffect, useRef }) {
  const [count, setCount] = useState(0);
  const [label] = useState(() => 'clicks');
  const renders = useRef(0);
  renders.current++;
  useEffect(() => {
    log.push(`effect for count=${count}`);
    return () => log.push(`cleanup for count=${count}`);
  }, [count]);
  return { text: `${count} ${label} (render #${renders.current})`, inc: () => setCount((c) => c + 1) };
}

const app = createRuntime(Counter);
app.render();
app.output.inc();
app.output.inc();
console.log(app.output.text);
console.log(log);

test('state persists across renders by call order; effects clean up before re-running', () => {
  expect(app.output.text).toBe('2 clicks (render #3)');
  expect(log).toEqual(['effect for count=0', 'cleanup for count=0', 'effect for count=1', 'cleanup for count=1', 'effect for count=2']);
});
```

If `Counter` called `useState` conditionally, the second render would read `label`'s slot as `count`, which is exactly the class of bug the rules prevent.

### What does StrictMode do in development? 🔥

`<StrictMode>` enables **development-only** checks to surface bugs early:

1. **Double-invokes** component bodies, initialisers of `useState`/`useMemo`/`useReducer`, and class constructors/render, to detect **impure rendering**.
2. **Mounts, unmounts and re-mounts** every component once (React 18+): **effects run, clean up, then run again**. This catches **missing cleanup** (duplicate subscriptions, leaked intervals, double connections). That matters a lot for a conferencing app, where a missing cleanup means two WebSocket connections or two `getUserMedia` calls.
3. Warns about deprecated APIs.
4. React 19 also double-invokes **ref callbacks**.

Common confusion: "my effect fires twice in dev". **That's intended.** Fix the effect so mount → unmount → mount is harmless (idempotent with cleanup). Don't remove StrictMode. Production runs once.

### How does React handle events? What changed in React 17?

- React uses **event delegation**. It attaches one listener per event type at the **root container**, not on every node, and dispatches **SyntheticEvents** (cross-browser wrappers with the same interface as native events, plus `nativeEvent`).
- **React 17** moved delegation from `document` to the **root container**. That makes **multiple React versions and micro-frontends** coexist safely, and `e.stopPropagation()` works as expected with non-React code.
- **React 17** also **removed event pooling**, so you can read `e.target` asynchronously.
- `onScroll` no longer bubbles (React 17). `onFocus`/`onBlur` use `focusin`/`focusout` under the hood.
- Events bubble through the **React tree**, not the DOM tree. That's why a click in a **portal** bubbles to its React parent.

## Concurrent React

### What is concurrent rendering? 🔥

Concurrent rendering (React 18) means React can **prepare multiple versions of the UI at once** and **interrupt** a render in progress. It isn't multi-threading; it's **cooperative scheduling** on the main thread, enabled by Fiber.

- **Urgent updates** (typing, clicking) are rendered immediately, **synchronously** with respect to the user's input.
- **Non-urgent updates** (transitions) render in the background, **yielding** to the browser every few milliseconds. If a newer update arrives, the in-progress render is **discarded** and restarted with the latest state.
- What the user sees stays **consistent**: commits are atomic, so you never see half-rendered trees.

It's **opt-in per update** through `startTransition`, `useTransition`, `useDeferredValue` and Suspense. Using `createRoot` alone doesn't make every update concurrent.

### Explain `useTransition` and `useDeferredValue` with a use case 🔥

**`useTransition`** marks a **state update** as non-urgent: `const [isPending, startTransition] = useTransition()`.

- Use it when **you own the state setter**, e.g. switching tabs that render heavy content, or filtering a big participant list.
- `isPending` lets you show a subtle loading indicator while **keeping the old UI interactive**. There's no Suspense fallback flash for content that's already shown.
- **React 19:** the transition function can be **async** (an "Action"). `isPending` stays true until the async work and the resulting updates finish.

**`useDeferredValue(value)`** gives you a **lagging copy** of a value.

- Use it when you **receive the value as a prop** or don't control the setter.
- React first renders with the old deferred value (fast), then re-renders in the background with the new value.

```jsx
function ParticipantSearch({ participants }) {
  const [query, setQuery] = useState('');          // urgent: input stays responsive
  const deferredQuery = useDeferredValue(query);   // non-urgent copy
  const isStale = query !== deferredQuery;
  const filtered = useMemo(
    () => participants.filter((p) => p.name.toLowerCase().includes(deferredQuery.toLowerCase())),
    [participants, deferredQuery],
  );
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ opacity: isStale ? 0.6 : 1 }}>
        <HeavyList items={filtered} /> {/* should be React.memo for the deferral to pay off */}
      </div>
    </>
  );
}

function Tabs() {
  const [tab, setTab] = useState('chat');
  const [isPending, startTransition] = useTransition();
  return (
    <>
      <button onClick={() => startTransition(() => setTab('participants'))}>Participants {isPending && '…'}</button>
      <TabPanel tab={tab} />
    </>
  );
}
```

**These are not debouncing.** There's no fixed delay. React renders the deferred work as fast as the device allows, and interrupts it when new input comes in.

### What is "tearing" and how does `useSyncExternalStore` prevent it? 🔥

**Tearing** happens when different parts of the UI show **different versions of the same external data** during one concurrent render. React may pause in the middle of rendering, the external store (Redux, a browser API, a WebRTC stats object) changes, and components rendered after the pause read the newer value.

**`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot?)`** is the official way to read external mutable sources:

- React checks the snapshot for consistency and **forces a synchronous re-render** if the store changed during a concurrent render, so tearing is impossible.
- `getSnapshot` must return a **cached, immutable** value. Returning a new object each time causes infinite re-renders.
- React-Redux's `useSelector`, Zustand and Jotai are built on it.

```jsx
// Subscribe to the browser's online status (an external store)
function subscribe(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}
export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true /* server snapshot */);
}
```

### What is Suspense and how does it work? 🔥

`<Suspense fallback={…}>` shows a fallback while **something inside it isn't ready**. A component "suspends" by **throwing a promise** (the internal mechanism), or, in React 19, by calling **`use(promise)`** on a pending promise. React shows the **nearest** Suspense boundary's fallback, then retries rendering when the promise resolves.

**What it's used for:**

- **Code splitting:** `const Whiteboard = lazy(() => import('./Whiteboard'))`.
- **Data fetching** with Suspense-enabled sources: frameworks like Next.js, Relay, TanStack Query's `useSuspenseQuery`, SWR's `suspense: true`, or `use(promise)` with a promise created outside render or cached.
- **Streaming SSR:** the server sends the shell first and streams each boundary's HTML as its data resolves, with **selective hydration**.

**Behaviour details:**

- Boundaries can be **nested** to control the loading sequence. Place boundaries where a loading state makes sense for the user.
- If an update is inside a **transition**, React **keeps showing the old content** instead of replacing already-visible content with a fallback.
- Errors thrown by suspended data go to the nearest **error boundary**, so pair Suspense with error boundaries.

```jsx
const Whiteboard = lazy(() => import('./Whiteboard'));     // separate chunk

function MeetingSidebar({ showBoard }) {
  return (
    <ErrorBoundary fallback={<p>Whiteboard failed to load</p>}>
      <Suspense fallback={<Spinner label="Loading whiteboard…" />}>
        {showBoard && <Whiteboard />}
      </Suspense>
    </ErrorBoundary>
  );
}
```

## Server rendering & Server Components

### Explain SSR, hydration and hydration mismatches 🔥

- **SSR:** the server renders components to **HTML** (`renderToPipeableStream` in Node, `renderToReadableStream` in edge runtimes), so the user sees content before the JavaScript loads. That improves FCP/LCP and SEO.
- **Hydration:** in the browser, `hydrateRoot(container, <App />)` **attaches event handlers and state** to the existing server HTML, instead of re-creating the DOM. Until hydration finishes, the page is visible but not interactive.
- **Hydration mismatch:** the client's first render must produce **the same output** as the server's. Common causes:
  - `Date.now()`, `Math.random()` or locale formatting during render
  - `typeof window !== 'undefined'` branches
  - browser extensions modifying the DOM
  - invalid HTML nesting (`<div>` inside `<p>`)
  
  Fixes: render client-only values **after mount** (`useEffect`), use `useId` for IDs, use `suppressHydrationWarning` for unavoidable text such as timestamps, and make server and client data identical. React 19 shows much better diffs for mismatches.
- **Streaming SSR + selective hydration (React 18):** HTML for each Suspense boundary streams in as it's ready. React hydrates boundaries **independently**, and **prioritises the one the user interacts with**.

### What are React Server Components? How are they different from SSR? 🔥

**React Server Components (RSC)** are components that **run only on the server** (at build time or per request), and **their code is never sent to the browser**.

- They can be `async` and **read data directly**: a database, the file system, internal services, secrets.
- They output a serialised **RSC payload**, a description of the UI tree including references to client components. React merges it into the client tree.
- **Client Components** are marked with **`'use client'`** at the top of a module. They are the interactive parts that use state, effects, event handlers and browser APIs. They're still **SSR'd to HTML** and then hydrated.

**Rules:**

- Server components **can render** client components and pass them **serialisable props**: no functions except Server Actions, no class instances.
- Client components **can't import** server components, but they can receive them as **`children`/props** (the "donut" pattern).

**RSC vs SSR:** SSR is about **producing HTML** for the first load. Every component's code still ships to the client and hydrates. RSC is about **where components execute**: server components **never hydrate** and add **zero JS** to the bundle. They work together, and Next.js App Router uses both.

**Benefits:**

- smaller bundles (a heavy markdown library or date library stays on the server)
- no client–server waterfalls
- secure data access

**Trade-offs:**

- new mental model
- framework required (Next.js, React Router v7 framework mode, Waku)
- caching complexity
- no client interactivity in server components

### What are Server Actions / Server Functions (`'use server'`)?

Functions marked `'use server'` run **on the server** but can be **called from the client**, including passed directly to `<form action={fn}>`. The framework creates an RPC endpoint behind the scenes.

- They enable **progressive enhancement**: forms work before the JS loads.
- They pair with **`useActionState`** (pending state, results), **`useFormStatus`** and **`useOptimistic`**.
- **Security:** they are **public HTTP endpoints**. **Always validate input and check authorisation inside them.** Never trust that only your UI calls them.

## React 19

### What's new in React 19? 🔥

| Feature | What it does |
|---|---|
| **Actions** | Async functions passed to transitions or `<form action>`. React manages pending state, errors and optimistic updates |
| **`useActionState`** | `[state, formAction, isPending] = useActionState(action, initialState)`. Result and pending state of an action (replaces the canary-era `useFormState`) |
| **`useFormStatus`** | Read the parent `<form>`'s pending status from inside a child (e.g. a submit button), with no prop drilling |
| **`useOptimistic`** | Show an optimistic value while an async action is in flight; it reverts automatically when the action finishes |
| **`use(resource)`** | Read a **promise** (suspends until resolved) or **context**. Unlike other hooks, it **can be called conditionally** |
| **`ref` as a prop** | Function components receive `ref` directly. `forwardRef` is no longer needed (and will be deprecated) |
| **Ref cleanup functions** | A callback ref can return a cleanup function |
| **`<Context>` as provider** | `<ThemeContext value="dark">` instead of `<ThemeContext.Provider>` |
| **Document metadata** | `<title>`, `<meta>` and `<link>` rendered anywhere are hoisted into `<head>` |
| **Stylesheets and async scripts** | `<link rel="stylesheet" precedence="…">` deduped and ordered; Suspense waits for styles |
| **Resource preloading APIs** | `preload`, `preinit`, `prefetchDNS`, `preconnect` from `react-dom` |
| **Better hydration errors** | A single diff-style error message instead of many warnings |
| **Custom elements** | Full support for Web Components properties and events |
| **`useDeferredValue(value, initialValue)`** | Initial value for the first render |

**Removed in React 19:**

- `ReactDOM.render`/`hydrate` (use `createRoot`/`hydrateRoot`)
- `propTypes` and `defaultProps` on function components (use TypeScript and default parameters)
- string refs, legacy context, `findDOMNode`
- `react-test-renderer/shallow`

```jsx
// React 19: an Action with pending state, error handling and optimistic UI
function RenameMeeting({ meeting }) {
  const [optimisticTitle, setOptimisticTitle] = useOptimistic(meeting.title);
  const [error, submitAction, isPending] = useActionState(async (_prev, formData) => {
    const title = formData.get('title');
    setOptimisticTitle(title);                       // show it immediately
    const res = await updateMeetingTitle(meeting.id, title);
    return res.ok ? null : 'Could not rename meeting';  // the returned value becomes `error`
  }, null);

  return (
    <form action={submitAction}>
      <h2>{optimisticTitle}</h2>
      <input name="title" defaultValue={meeting.title} />
      <SubmitButton />
      {error && <p role="alert">{error}</p>}
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();               // reads the parent form's status
  return <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>;
}

// use(): read a promise (suspends) or context, even conditionally
function Comments({ commentsPromise }) {
  const comments = use(commentsPromise);             // create the promise outside render (or cache it)
  return comments.map((c) => <p key={c.id}>{c.text}</p>);
}
```

### What is the React Compiler? 🔥

The **React Compiler** (a Babel plugin; stable since 2025) **automatically memoises** components and hooks at build time. It analyses your code and inserts fine-grained caching equivalent to `useMemo`, `useCallback` and `React.memo`, often more granular than you'd write by hand.

- **Goal:** remove most manual memoisation and the bugs from wrong dependency arrays.
- **Requirement:** your code must follow the **Rules of React**: pure render, no mutation of props or state, hooks rules. The compiler skips components it can't prove safe. The ESLint plugin reports violations.
- **What it doesn't fix:** expensive algorithms, huge lists (still virtualise), network waterfalls and effects logic.
- **In interviews:** "With the compiler, `useMemo`/`useCallback` become mostly unnecessary for performance. I'd still understand them, because they matter in codebases without the compiler, and for referential stability passed to non-React code."

## Classic topics

### Controlled vs uncontrolled components 🔥

- **Controlled:** React state is the **single source of truth**. `value={state}` plus `onChange` updates the state. Use it for instant validation, conditional UI, input formatting, and when other components need the value.
- **Uncontrolled:** the **DOM holds the value**. Read it with a `ref` or `FormData` on submit, and use `defaultValue` for the initial value. This means less re-rendering for large forms, and it's required for `<input type="file">`. **React Hook Form** uses uncontrolled inputs plus refs for performance. React 19 form Actions work naturally with uncontrolled inputs and `FormData`.
- **Don't switch** an input between controlled and uncontrolled (`value` going from `undefined` to a string). React warns about it.

### What are error boundaries and what don't they catch? 🔥

Error boundaries are **class components** implementing `static getDerivedStateFromError(error)` (render a fallback) and/or `componentDidCatch(error, info)` (log it). They catch errors **during rendering, in lifecycle methods and in constructors of the tree below them**, and show a fallback instead of unmounting the whole app.

**They don't catch:**

- errors in **event handlers** (use try/catch)
- **async code** (`setTimeout`, promise callbacks), unless you rethrow into render via state
- errors in **SSR**
- errors in the **boundary itself**

There is still **no hook equivalent**. Use the `react-error-boundary` library (`<ErrorBoundary FallbackComponent onReset resetKeys>` and `useErrorBoundary()` to forward async errors).

```jsx
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { reportToSentry(error, info.componentStack); }
  render() {
    if (this.state.error) return this.props.fallback ?? <p>Something went wrong.</p>;
    return this.props.children;
  }
}
// Granular boundaries: a crashing whiteboard shouldn't take down the whole meeting UI
<ErrorBoundary fallback={<WhiteboardError />}><Whiteboard /></ErrorBoundary>
```

### What are portals and how do events behave in them?

`createPortal(children, domNode)` renders children into a **different DOM node**, typically `document.body`. Use it for **modals, toasts, tooltips and dropdowns**, to escape `overflow: hidden` and stacking-context (z-index) traps of parents.

- **Context and events follow the React tree, not the DOM tree.** A click inside a portal **bubbles to its React ancestors'** `onClick` handlers, even though the DOM node lives elsewhere.
- **Accessibility:** modals need focus trapping, `role="dialog"`, `aria-modal`, Escape to close and focus return. Consider the native `<dialog>` element with `showModal()`, which provides top-layer rendering and an inert background.

### How does Context work and why can it hurt performance? 🔥

`createContext` + `<Provider value={…}>` makes a value available to any descendant through `useContext`. When the provider's `value` changes (compared with `Object.is`), **every consumer re-renders**, even if it uses only part of the value. `React.memo` on intermediate components **doesn't** block context updates.

**Pitfalls and fixes:**

- An inline object `value={{ user, setUser }}` is a **new object every render**, so all consumers re-render whenever the provider re-renders. Memoise it with `useMemo`, or pass stable pieces.
- **Split contexts** by update frequency: `ParticipantsContext` vs `ThemeContext`, or a state context vs a dispatch context (`dispatch` is stable).
- For **high-frequency or large state**, use a store with **selectors** (Redux, Zustand, Jotai, or `use-context-selector`). Context is a **dependency-injection mechanism**, not a state manager.

### How do class component lifecycles map to hooks?

| Class | Hooks equivalent |
|---|---|
| `constructor` / `this.state` | `useState` (lazy initialiser), `useRef` |
| `componentDidMount` | `useEffect(() => {…}, [])` |
| `componentDidUpdate(prevProps)` | `useEffect(() => {…}, [dep])`; use a ref for previous values |
| `componentWillUnmount` | the cleanup function returned from `useEffect` |
| `shouldComponentUpdate` / `PureComponent` | `React.memo(Component, areEqual?)` |
| `getDerivedStateFromProps` | compute during render, or reset with a `key`; rarely needed |
| `getSnapshotBeforeUpdate` | no hook equivalent; `useLayoutEffect` covers most cases |
| `componentDidCatch` / `getDerivedStateFromError` | no hook; use a class error boundary |
| `forceUpdate` | `const [, force] = useReducer(x => x + 1, 0)` |

**Differences:** a hook effect runs **after paint** (unlike `componentDidMount`, which runs synchronously after commit; `useLayoutEffect` is the closer match). Every render has its **own props and state captured in closures**, whereas `this.props` always reads the latest values. That's why stale closures exist in hooks and "this.props changed during async work" bugs exist in classes.

### `createRoot` vs `ReactDOM.render`: why did React 18 change the root API?

`ReactDOM.render` (the legacy root) ran React in **legacy synchronous mode**. `createRoot(container).render(<App />)` enables the **concurrent renderer**: automatic batching, transitions, Suspense improvements and streaming. The new API also separates the root's creation from rendering and makes unmounting explicit (`root.unmount()`). React 19 **removed** `ReactDOM.render`. Migration is usually a two-line change plus fixing StrictMode effect issues.
