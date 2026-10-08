# State Management: Redux, RTK, Jotai, SWR & more

You've used **Redux** (MeetHour, SCAI, V-Empower SPAs), **Jotai** (Nebraska Draw), and data-fetching libraries such as **SWR** (this very app is built on SWR). Interviewers test whether you can **classify state** and pick the right tool, and whether you understand how each library works underneath.

## Choosing the right tool

### What kinds of state exist in a frontend app, and where should each live? 🔥

| Kind | Examples | Best home |
|---|---|---|
| **Local UI state** | input value, open/closed, hover | `useState` / `useReducer` in the component |
| **Shared client state** | current user, theme, meeting participants, selected tool, layout | Context (low-frequency), Redux/Zustand/Jotai (frequent or complex) |
| **Server state** (a cache of remote data) | meetings list, recordings, documents, search results | **SWR / TanStack Query / RTK Query** |
| **URL state** | filters, pagination, selected tab, search query | the router: `useSearchParams`, path params |
| **Form state** | field values, validation, touched/dirty | React Hook Form, or local state |
| **Real-time/external state** | WebRTC connection state, audio levels, XMPP presence | an external store + `useSyncExternalStore`, or Redux fed by middleware |
| **Persistent client state** | preferences, drafts | localStorage-backed store (this app's progress store) |

**The key insight interviewers want:** **server state is different from client state.** It's **owned by the server**, can become **stale**, needs **caching, deduplication, revalidation, retries and pagination**, and is shared between components. Putting API responses into Redux by hand means re-implementing a cache badly. That's why **data-fetching libraries** took over that job and global client stores shrank.

### Redux vs Context vs Zustand vs Jotai vs SWR/React Query: when do you use which? 🔥

| Tool | Model | Strengths | Weaknesses | Use when |
|---|---|---|---|---|
| **Context** | Dependency injection | Built-in, simple | All consumers re-render on any change; not a state manager | Theme, auth user, locale, injecting services (e.g. a conference instance) |
| **Redux Toolkit** | Single store, actions → reducers, middleware | Predictable, **DevTools/time travel**, middleware for side effects, great for complex event-driven domains, huge ecosystem | More concepts, some boilerplate (much less with RTK) | Large apps, many developers, complex flows, **event-driven real-time apps** (lib-jitsi-meet events → actions) |
| **Zustand** | Small store with hooks + selectors | Tiny, minimal API, no provider, selectors avoid re-renders, usable outside React | Fewer conventions; DevTools via middleware | Medium apps that want simple global state |
| **Jotai** | **Atomic** bottom-up state | Precise re-renders, derived atoms, Suspense-friendly async atoms, `atomFamily` | Many atoms can get hard to trace; less suited to event sourcing | Fine-grained, interdependent UI state (Nebraska Draw: filters, selection, upload progress) |
| **SWR / TanStack Query** | **Server-state cache** | Caching, dedupe, revalidation, retries, pagination, optimistic updates | Not for client-only state | Anything fetched from an API |
| **RTK Query** | Server-state cache inside Redux | Same idea, integrated with the Redux store and DevTools, tag-based invalidation | Tied to Redux | Apps already on Redux |

**Model answer:**

> "I start with local state and the URL. Server data goes into a fetching library: SWR or TanStack Query, or RTK Query if we're on Redux. Truly global client state goes into Redux Toolkit when the domain is complex and event-driven, as in MeetHour where WebRTC and XMPP events map naturally to actions and middleware. For more modest apps I'd choose Zustand or Jotai. In Nebraska Draw we used Jotai because most of the shared state was fine-grained UI state, and atoms gave us precise re-renders with almost no boilerplate."

## Redux & Redux Toolkit

### Explain Redux's core principles and data flow 🔥

1. **Single source of truth:** the global state lives in one **store** (one object tree).
2. **State is read-only:** the only way to change it is to **dispatch an action**, a plain object describing *what happened* (`{ type: 'participant/joined', payload }`).
3. **Changes are made by pure reducers:** `(state, action) => newState`. No side effects, no mutation, deterministic.

**Data flow:** UI event → `dispatch(action)` → **middleware** (logging, async, side effects) → **root reducer** computes the new state → store notifies subscribers → `useSelector` hooks re-run their selectors → components whose selected values changed re-render.

**Why it's useful:**

- **predictability**: every change is an explicit, logged event
- **time-travel debugging** and DevTools
- easy testing of reducers (pure functions)
- **centralised side-effect handling** through middleware

(The Machine Coding doc implements `createStore`, `combineReducers` and `applyMiddleware` from scratch, which is a great way to prove you understand this.)

### What does Redux Toolkit add over classic Redux? 🔥

RTK is the **official, recommended way** to write Redux.

- **`configureStore`:** sets up the store with good defaults: thunk middleware, DevTools, and **dev-only checks for mutations and non-serialisable values**.
- **`createSlice`:** generates action creators and types from reducer functions. Reducers use **Immer**, so you can write "mutating" code (`state.list.push(x)`) that produces immutable updates safely.
- **`createAsyncThunk`:** async logic with automatic `pending`/`fulfilled`/`rejected` actions.
- **`createEntityAdapter`:** **normalised** collections (`ids` plus `entities`), with CRUD reducers and memoised selectors.
- **`createSelector`** (re-exported from Reselect) for memoised selectors.
- **`createListenerMiddleware`:** reacts to actions with async side effects; a lighter alternative to sagas.
- **RTK Query:** a data fetching and caching layer.

```jsx
import { createSlice, createEntityAdapter, createAsyncThunk, configureStore } from '@reduxjs/toolkit';

const participantsAdapter = createEntityAdapter({ sortComparer: (a, b) => a.joinedAt - b.joinedAt });

export const kickParticipant = createAsyncThunk('participants/kick', async (id, { extra: { conference }, rejectWithValue }) => {
  try {
    await conference.kickParticipant(id);
    return id;
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

const participantsSlice = createSlice({
  name: 'participants',
  initialState: participantsAdapter.getInitialState({ dominantSpeakerId: null }),
  reducers: {
    participantJoined: participantsAdapter.addOne,
    participantLeft: participantsAdapter.removeOne,
    participantUpdated: participantsAdapter.updateOne,          // { id, changes }
    dominantSpeakerChanged(state, action) { state.dominantSpeakerId = action.payload; }, // Immer "mutation"
  },
  extraReducers: (builder) => {
    builder.addCase(kickParticipant.fulfilled, participantsAdapter.removeOne);
  },
});

export const { participantJoined, participantLeft, participantUpdated, dominantSpeakerChanged } = participantsSlice.actions;
export const { selectAll: selectParticipants, selectById: selectParticipantById } =
  participantsAdapter.getSelectors((state) => state.participants);

export const store = configureStore({
  reducer: { participants: participantsSlice.reducer },
  middleware: (gDM) => gDM({ thunk: { extraArgument: { conference: getConference() } } }),
});
```

### How does Immer work? Why can you "mutate" state in RTK reducers? 🔥

Immer gives your reducer a **draft**, a **Proxy** wrapping the current state. When you "mutate" the draft, Immer **records the changes**. At the end, it produces a **new immutable state** using **structural sharing**: unchanged branches keep their **original references**, and only the changed path is copied.

**Rules:**

- **Either** mutate the draft **or** return a new value. Not both (unless you return `undefined`).
- Don't reassign `state = ...` (it does nothing); return the new value instead.
- Drafts are revoked after the reducer finishes, so don't use them asynchronously.

Here is a **mini Immer** showing copy-on-write with structural sharing:

```js
function produce(base, recipe) {
  const copies = new Map();                          // original object -> its copy
  const getCopy = (obj) => {
    if (!copies.has(obj)) copies.set(obj, Array.isArray(obj) ? [...obj] : { ...obj });
    return copies.get(obj);
  };
  const createDraft = (target, markParentDirty) => {
    const markDirty = () => {
      markParentDirty?.();
      return getCopy(target);
    };
    return new Proxy(target, {
      get(t, key) {
        const source = copies.has(t) ? copies.get(t) : t;
        const value = source[key];
        if (value && typeof value === 'object') {
          return createDraft(value, () => {           // nested write: copy this level and attach the child copy
            const copy = markDirty();
            copy[key] = getCopy(value);
          });
        }
        return value;
      },
      set(t, key, value) {
        markDirty()[key] = value;
        return true;
      },
    });
  };
  recipe(createDraft(base));
  return copies.get(base) ?? base;                   // nothing changed -> same reference
}

const state = { meeting: { title: 'Standup', recording: { on: false } }, chat: { messages: ['hi'] } };
const next = produce(state, (draft) => {
  draft.meeting.recording.on = true;                 // "mutation"
});

console.log(next.meeting.recording.on, state.meeting.recording.on);

test('structural sharing', () => {
  expect(next).not.toBe(state);
  expect(next.meeting).not.toBe(state.meeting);       // changed path is copied
  expect(next.chat).toBe(state.chat);                 // untouched branch is shared
  expect(state.meeting.recording.on).toBe(false);     // base is untouched
  expect(produce(state, () => {})).toBe(state);       // no changes -> same object
});
```

Real Immer also **freezes** the result in development, handles Maps, Sets, arrays and patches, and finalises nested drafts efficiently.

### Why must Redux state be immutable and serialisable?

- **Immutability:**
  - `useSelector`, `React.memo` and memoised selectors detect changes by **reference equality**. Mutating in place keeps the same reference, so **the UI doesn't update**.
  - It enables **time-travel debugging**, undo/redo and safe comparisons.
  - Reducers stay **pure** and testable.
- **Serialisability:** DevTools, persistence (redux-persist), SSR hydration and action replay all need plain data.
  - **Don't store** class instances, Promises, functions, **`MediaStream`s, `RTCPeerConnection`s or `JitsiTrack` objects** in Redux.
  - Store **IDs and plain metadata** in Redux, and keep the live objects in a separate registry (a `Map` keyed by ID) or in the media library.
  - RTK's serializability check warns you about violations.

### What is middleware in Redux? Thunk vs Saga vs Listener middleware 🔥

**Middleware** wraps `dispatch`: `store => next => action => {…}`. It sits **between dispatching an action and the reducer**, so it can log, transform, delay, cancel or dispatch other actions. It's the home for **side effects**.

| | Thunk | Saga (redux-saga) | Listener middleware (RTK) | Observable (redux-observable) |
|---|---|---|---|---|
| Style | Dispatch functions with `(dispatch, getState)` | **Generators** that yield declarative effects (`call`, `put`, `take`, `fork`, `race`) | `startListening({ actionCreator, effect })` with async/await | RxJS streams of actions |
| Good for | Simple async (fetch → dispatch) | Complex long-running flows: **cancellation**, debouncing, retries, websockets, `takeLatest` | Most "react to action X with side effect" cases; supports `take`, `condition`, `cancelActiveListeners` | Teams already invested in RxJS |
| Cost | Tiny | Steep learning curve, more code | Small, built into RTK | RxJS knowledge |

**MeetHour-style example:** a custom middleware that turns `START_RECORDING` into an XMPP IQ, and lib-jitsi-meet events into actions:

```jsx
const recordingMiddleware = ({ dispatch, getState }) => (next) => (action) => {
  const result = next(action);                                  // let reducers run first
  if (action.type === 'recording/startRequested') {
    const conference = getState().conference.instance;          // (better: a non-serialisable registry)
    conference
      .startRecording({ mode: action.payload.mode, streamId: action.payload.streamKey })
      .then((session) => dispatch({ type: 'recording/sessionUpdated', payload: { id: session.getID(), status: 'pending' } }))
      .catch((e) => dispatch({ type: 'recording/failed', payload: e.message }));
  }
  return result;
};
```

### How do you structure a large Redux codebase? 🔥

- **Feature folders ("ducks" / slices):** `features/participants/{slice.ts, selectors.ts, middleware.ts, components/}`. Jitsi Meet uses this structure: `react/features/<feature>/{actions, reducer, middleware, functions}`.
- **Normalise** relational data (`ids` plus `entities`, via `createEntityAdapter`). Store references by ID, never duplicate objects.
- **Keep server data out** where possible: use RTK Query for fetched data.
- **Selectors are the public API of a slice.** Components never read the state shape directly, so you can refactor the state freely.
- **Model events, not setters:** `participantJoined`, not `setParticipants`. Action names describe *what happened*.
- **Minimal state; derive the rest** with selectors.
- **Typed hooks** (`useAppSelector`, `useAppDispatch`).

### What is RTK Query and how does cache invalidation work in it?

RTK Query generates hooks from an API definition. Each endpoint's data is **cached by endpoint and arguments**, and **automatically refetched** when invalidated:

- **`providesTags`:** a query declares which tags its data represents (`[{ type: 'Recording', id }]`, or `{ type: 'Recording', id: 'LIST' }`).
- **`invalidatesTags`:** a mutation declares which tags it makes stale. All queries providing those tags **refetch automatically**.
- **Other features:** request dedup, polling, `keepUnusedDataFor` (cache lifetime after the last subscriber leaves), optimistic updates with `onQueryStarted` + `updateQueryData`, streaming updates through `onCacheEntryAdded`, and code-generation from OpenAPI.

```jsx
export const api = createApi({
  baseQuery: fetchBaseQuery({ baseUrl: '/api', prepareHeaders: (h, { getState }) => { h.set('Authorization', `Bearer ${getState().auth.token}`); return h; } }),
  tagTypes: ['Recording'],
  endpoints: (b) => ({
    getRecordings: b.query({
      query: (meetingId) => `meetings/${meetingId}/recordings`,
      providesTags: (result = []) => [...result.map(({ id }) => ({ type: 'Recording', id })), { type: 'Recording', id: 'LIST' }],
    }),
    deleteRecording: b.mutation({
      query: (id) => ({ url: `recordings/${id}`, method: 'DELETE' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Recording', id }, { type: 'Recording', id: 'LIST' }],
    }),
  }),
});
export const { useGetRecordingsQuery, useDeleteRecordingMutation } = api;
```

## Atomic & minimal stores

### How does Jotai work? Explain atoms, derived atoms and async atoms 🔥

- An **atom** is a **config object** describing a piece of state (`atom(initialValue)`). The actual **value lives in a store** (the default store, or one per `<Provider>`), keyed by the atom object.
- **Primitive atoms:** `const countAtom = atom(0)`, then `const [count, setCount] = useAtom(countAtom)`.
- **Derived (read-only) atoms:** `atom((get) => get(a) * 2)`. Jotai tracks the dependency graph and **recomputes only when dependencies change**. Only components using the atom re-render.
- **Writable derived atoms:** `atom(read, (get, set, arg) => …)`. These hold actions that update several atoms at once.
- **Async atoms:** a read function that returns a promise **suspends** with Suspense (or use `loadable()` to get `{ state: 'loading' | 'hasData' | 'hasError' }` without suspending).
- **Utilities:** `atomWithStorage` (localStorage), `atomFamily` (parameterised atoms, e.g. per document), `selectAtom`, `splitAtom` (an atom per array item), `atomWithReset`.
- **vs Recoil:** a similar idea with a smaller API, no string keys, and it's maintained (Recoil was archived).

```jsx
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { atomWithStorage, loadable } from 'jotai/utils';

const folderIdAtom = atom('root');
const sortAtom = atomWithStorage('docs:sort', 'updatedAt');                 // persisted
const documentsAtom = atom(async (get) => {                                   // async derived atom
  const res = await fetch(`/api/folders/${get(folderIdAtom)}/docs?sort=${get(sortAtom)}`);
  return res.json();
});
const docCountAtom = atom(async (get) => (await get(documentsAtom)).length);
const openFolderAtom = atom(null, (get, set, folderId) => {                 // write-only action atom
  set(folderIdAtom, folderId);
});

function DocCount() {
  const count = useAtomValue(loadable(docCountAtom));                        // no Suspense needed
  return count.state === 'hasData' ? <span>{count.data} documents</span> : <span>…</span>;
}
```

### How does Zustand work, and how do selectors prevent re-renders?

Zustand creates a store with **`create((set, get) => ({ …state, …actions }))`**. Under the hood it's a vanilla store (state + `setState` + `subscribe`), and the React hook is built on **`useSyncExternalStore`**. Components call `useStore(selector)` and re-render **only when the selected slice changes** (strict equality, or `useShallow` for objects and arrays). There's no Provider, and the store is usable outside React (`useStore.getState()`). Middleware: `persist`, `devtools`, `immer`, `subscribeWithSelector`.

```jsx
const useMeetingStore = create((set) => ({
  participants: {},
  handRaised: new Set(),
  join: (p) => set((s) => ({ participants: { ...s.participants, [p.id]: p } })),
  raiseHand: (id) => set((s) => ({ handRaised: new Set(s.handRaised).add(id) })),
}));

// Re-renders only when this participant's name changes
const name = useMeetingStore((s) => s.participants[id]?.name);
// Multiple values: useShallow avoids re-renders from a new object each time
const { join, raiseHand } = useMeetingStore(useShallow((s) => ({ join: s.join, raiseHand: s.raiseHand })));
```

## Server state: SWR & TanStack Query

### What does "stale-while-revalidate" mean? How does SWR work? 🔥

**Stale-while-revalidate** (originally an HTTP `Cache-Control` extension, RFC 5861): **return cached (stale) data immediately**, then **revalidate in the background** and update the UI when fresh data arrives. Users see content instantly and it becomes fresh shortly after.

**SWR** (by Vercel) applies this to React:

- **`useSWR(key, fetcher, options)`**: the **key** (a string, array or `null`) identifies the resource and is passed to the fetcher. A `null` key means **don't fetch** (conditional fetching).
- **Global cache:** every component using the same key **shares the data**. Requests are **deduplicated** within `dedupingInterval` (2 s by default).
- **Automatic revalidation** on mount, **window focus**, **network reconnect** and an optional `refreshInterval`.
- `mutate()` for local updates and **optimistic UI**, `useSWRMutation` for remote mutations, `useSWRInfinite` for pagination, `preload()` to prefetch, `suspense: true` mode, **error retry with exponential backoff**, and `keepPreviousData`.
- **`useSWRImmutable`:** never revalidate (for data that doesn't change).

**This application uses SWR exactly this way:**

- `useSWR('/resources/manifest.json')` for the manifest.
- `useSWRImmutable(docUrl)` per document.
- **`preload()` on sidebar hover** to prefetch documents.
- The search page fetches **all** documents and seeds each document's individual cache entry with `mutate(key, data, { revalidate: false })`.

```jsx
const fetcher = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); });

function Recordings({ meetingId }) {
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    meetingId ? `/api/meetings/${meetingId}/recordings` : null,   // conditional fetching
    fetcher,
    { revalidateOnFocus: true, dedupingInterval: 5000 },
  );

  async function remove(id) {
    await mutate(
      async (current) => { await fetch(`/api/recordings/${id}`, { method: 'DELETE' }); return current.filter((r) => r.id !== id); },
      { optimisticData: (current) => current.filter((r) => r.id !== id), rollbackOnError: true, revalidate: true },
    );
  }

  if (error) return <ErrorState retry={() => mutate()} />;
  if (isLoading) return <Skeleton />;
  return <RecordingList items={data} onDelete={remove} refreshing={isValidating} />;
}
```

### SWR vs TanStack Query: what are the differences?

Both are **server-state caches** with similar ideas.

| | SWR | TanStack Query (React Query) |
|---|---|---|
| Size and API | Smaller, minimal API | Larger, more features |
| Cache control | Revalidation-focused (`dedupingInterval`, focus/reconnect) | Explicit **`staleTime`** (how long data is fresh) and **`gcTime`** (how long unused data stays cached) |
| Mutations | `mutate`, `useSWRMutation` | `useMutation` with lifecycle callbacks (`onMutate` for optimistic updates, `onError` rollback, `onSettled`) |
| Invalidation | By key / key matcher (`mutate(key => …)`) | **`queryClient.invalidateQueries({ queryKey })`** with hierarchical keys |
| Devtools | Community | Official devtools |
| Extra | — | Infinite and parallel queries, prefetching and hydration for SSR, offline/persisted cache, query cancellation, selectors (`select`) |

**Pick SWR** for simplicity and a small bundle (Next.js-friendly). **Pick TanStack Query** for complex mutation and invalidation workflows.

### How do you implement optimistic updates safely? 🔥

**Optimistic update:** update the UI **before** the server confirms, so the app feels instant. Roll back if the request fails.

**Steps** (TanStack Query flavour):

1. **Cancel** in-flight refetches for that key, so they don't overwrite the optimistic data.
2. **Snapshot** the previous data.
3. **Apply** the optimistic change to the cache.
4. On **error**, **roll back** to the snapshot and show a message.
5. On **settle** (success or failure), **invalidate or refetch** to sync with the server's truth.

**When not to be optimistic:** irreversible or high-stakes operations (payments, deleting evidence, starting a recording that others will see). Show a pending state instead.

```js
// Framework-agnostic optimistic update with rollback (runnable)
function createCache(initial) {
  let data = initial;
  const listeners = new Set();
  return {
    get: () => data,
    set: (next) => { data = typeof next === 'function' ? next(data) : next; listeners.forEach((l) => l(data)); },
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
  };
}

async function optimisticMutate(cache, optimisticFn, request) {
  const snapshot = cache.get();
  cache.set(optimisticFn);                 // instant UI
  try {
    const serverData = await request();
    cache.set(serverData);                 // reconcile with server truth
  } catch (err) {
    cache.set(snapshot);                   // rollback
    throw err;
  }
}

const cache = createCache([{ id: 1, title: 'Weekly sync' }]);
const history = [];
cache.subscribe((d) => history.push(d.map((x) => x.title).join(',')));

const failingRename = () => new Promise((_, rej) => setTimeout(() => rej(new Error('500')), 10));

test('optimistic update rolls back on failure', async () => {
  await expect(optimisticMutate(cache, (d) => d.map((x) => ({ ...x, title: 'Renamed' })), failingRename)).rejects.toThrow('500');
  expect(history).toEqual(['Renamed', 'Weekly sync']);
  expect(cache.get()[0].title).toBe('Weekly sync');
});
```

### How do you handle cache invalidation and data consistency across screens?

- **Hierarchical query keys:** `['meetings', meetingId, 'recordings']`. Invalidate `['meetings', meetingId]` to refresh everything about one meeting.
- **After mutations:** invalidate affected keys (TanStack), use `mutate(key)` (SWR), or use tags (RTK Query). Or **update the cache directly** with the server's response to avoid an extra request.
- **Real-time updates:** a WebSocket message (e.g. "recording finished") **invalidates or patches** the relevant cache entry, so polling isn't needed.
- **Normalised caches** (Apollo, Relay, RTK entity adapters) update an entity once and every query showing it updates. Document caches (SWR, TanStack) cache per query, so you invalidate related queries.
- **Stale times:** set `staleTime` per data type. Reference data can stay fresh for minutes; live data for 0 s.

## State & architecture questions

### How would you design state for a video conferencing app like MeetHour? 🔥

| State | Where | Why |
|---|---|---|
| Participants (id, name, role, muted, hand raised, sources) | **Redux** (normalised by id), fed by lib-jitsi-meet events through middleware | Shared everywhere, event-driven, needs DevTools to debug sequences of events |
| Live media objects (`JitsiTrack`, `MediaStream`, `RTCPeerConnection`) | **Outside Redux**: a registry keyed by participant/source ID | Not serialisable; mutable objects owned by the media library |
| Audio levels, connection stats | **External store or subscription per tile**, throttled; not global Redux | High frequency; only a few leaf components care |
| Recording/streaming sessions | Redux slice as a **map keyed by session ID** with a status machine | Several concurrent sessions (multi-Jibri); all clients show status |
| Room settings, roles and permissions | Redux, derived **capability selectors** | Drives UI enablement; updated from server presence |
| Meeting list, recordings library, user profile | **SWR / RTK Query** | Server state with caching |
| Layout (tile view vs stage), open panels | Redux or Zustand (local preferences in localStorage) | UI state that's shared between components |
| Pre-join form | Local state | Only that screen cares |

**Principles:**

- The server is the **source of truth** for permissions.
- The UI reacts to **events**.
- Avoid storing what you can **derive**.
- Keep **high-frequency state** local.

### What is normalisation and why does it matter? 🔥

Store collections **like database tables**: `{ ids: ['a', 'b'], entities: { a: {...}, b: {...} } }`. Store references by ID instead of nesting copies.

**Benefits:**

- **Single place to update** an entity: no inconsistent duplicates.
- **O(1) lookups** by ID.
- Updating one item doesn't create new references for **unrelated items**, so memoised components and selectors stay stable.
- Simpler reducers.

**Tools:** RTK's `createEntityAdapter`, `normalizr` for nested API responses.

```js
function normalize(list, idKey = 'id') {
  return list.reduce(
    (acc, item) => {
      acc.ids.push(item[idKey]);
      acc.entities[item[idKey]] = item;
      return acc;
    },
    { ids: [], entities: {} },
  );
}

const apiResponse = [
  { id: 'p1', name: 'Asha', role: 'host' },
  { id: 'p2', name: 'Ravi', role: 'guest' },
];
const state = normalize(apiResponse);

const updated = { ...state, entities: { ...state.entities, p2: { ...state.entities.p2, role: 'cohost' } } };
console.log(updated.entities.p2.role, updated.entities.p1 === state.entities.p1);

test('updating one entity keeps other references stable', () => {
  expect(updated.entities.p1).toBe(state.entities.p1);
  expect(updated.entities.p2).not.toBe(state.entities.p2);
});
```

### Context API vs Redux: can Context replace Redux?

**Context is a transport mechanism, not a state manager.** It passes a value down without prop drilling. Combined with `useReducer`, it can manage modest global state.

It **lacks**:

- **selective subscriptions**: every consumer re-renders on any change, unless you split contexts or use a selector library
- **middleware** for side effects
- **DevTools/time travel**
- conventions for large teams

**Rule:**

- Context for **low-frequency, app-wide values**: theme, auth, locale, feature flags, service instances.
- A **store with selectors** for **frequently changing shared state**.
- A **server-state library** for API data.

### How do you persist and rehydrate state (e.g. drafts, preferences)?

- **What to persist:** user preferences, drafts and offline queues. **Not** server-cache data (re-fetch it) or secrets (never put tokens in localStorage if you can avoid it).
- **Tools:** `redux-persist` (with versioned **migrations**), Zustand's `persist` middleware, Jotai's `atomWithStorage`, TanStack Query's persisters.
- **Storage choices:**
  - `localStorage` is synchronous and about 5 MB, so keep it small.
  - **IndexedDB** for larger data (via `idb-keyval`, Dexie).
- **Cross-tab sync** via the `storage` event or `BroadcastChannel`.
- **Versioning:** store a schema version and migrate or discard old shapes on load, so app updates don't crash on old data.
- **This app** persists your progress, notes and playground snippets in localStorage, with an **export/import** feature to move them between machines.
