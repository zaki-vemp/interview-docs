# Vue 3

Vue.js is on your resume. Companies that use Vue will expect **Composition API fluency** and an understanding of the **reactivity system**, and React developers are often asked to **compare the two**. This page covers Vue 3 (3.4/3.5+) at an advanced level.

## Fundamentals

### What are the main differences between Vue 2 and Vue 3? 🔥

| Area | Vue 2 | Vue 3 |
|---|---|---|
| Reactivity | `Object.defineProperty` getters/setters. **Couldn't detect property addition/deletion** or array index assignment (needed `Vue.set`) | **ES `Proxy`-based**: detects add/delete, array index and length changes, Map/Set |
| API style | Options API (+ mixins) | **Composition API** (`setup`, `<script setup>`) plus Options API |
| Logic reuse | Mixins (name collisions, unclear sources) | **Composables** (functions) |
| TypeScript | Weak | First-class (written in TS) |
| Templates | Single root element | **Fragments** (multiple roots) |
| New built-ins | — | **`<Teleport>`**, `<Suspense>` (experimental), `emits` option |
| `v-model` | `value`/`input`, `.sync` modifier | `modelValue`/`update:modelValue`, **multiple v-models**, `defineModel()` (3.4) |
| Removed | — | Filters, `$on`/`$off` event bus, `Vue.extend`, `$children`, `$listeners` (merged into `$attrs`) |
| Performance | VDOM | **Compiler-informed VDOM** (patch flags, static hoisting, block tree), tree-shakeable global API (`createApp`) |
| Status | **End of life Dec 31, 2023** | Current |

### Options API vs Composition API: which and why? 🔥

- **Options API** organises code by **option type**: `data`, `computed`, `methods`, `watch`, lifecycle hooks. It's easy for beginners. In big components, one **feature's logic is scattered** across options, and reuse needs mixins.
- **Composition API** (`setup()` or `<script setup>`) organises code by **feature**: related state, computed values, watchers and lifecycle hooks sit together and can be **extracted into composables**. It has better TypeScript inference, it minifies better, and it doesn't rely on `this`.
- **`<script setup>`** is compile-time sugar: top-level bindings are exposed to the template automatically, with `defineProps`, `defineEmits`, `defineModel`, `defineExpose` and `defineSlots` macros. It's the recommended style for SFCs.

```vue
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

const props = defineProps<{ meetingId: string; max?: number }>();
const emit = defineEmits<{ (e: 'joined', id: string): void }>();

const participants = ref<{ id: string; name: string }[]>([]);
const isFull = computed(() => participants.value.length >= (props.max ?? 100));

watch(() => props.meetingId, async (id) => {
  participants.value = await fetchParticipants(id);
}, { immediate: true });

onMounted(() => console.log('mounted'));

function join(id: string) {
  emit('joined', id);
}
</script>

<template>
  <p v-if="isFull">Meeting is full</p>
  <ul v-else>
    <li v-for="p in participants" :key="p.id" @click="join(p.id)">{{ p.name }}</li>
  </ul>
</template>
```

## Reactivity

### How does Vue 3's reactivity system work internally? 🔥

Vue 3 tracks dependencies **at runtime** using Proxies:

1. **`reactive(obj)`** returns a **Proxy**. Its `get` trap calls **`track(target, key)`** and its `set` trap calls **`trigger(target, key)`**.
2. Dependencies are stored in a global **`targetMap: WeakMap<target, Map<key, Set<effect>>>`**.
3. An **effect** is a function running inside a tracking context (`activeEffect`). Component render functions, `computed` and `watch` are all effects. Every reactive property **read** while the effect runs registers the effect as a **subscriber** of that property.
4. **Writing** a property looks up its subscribers and **re-runs** (or schedules) them. Component updates are **batched** into the next microtask through a scheduler queue, which is why you need **`nextTick()`** to see the updated DOM.
5. **`ref(value)`** wraps a value in an object with a `.value` getter/setter that tracks and triggers. That makes **primitives** reactive. Objects passed to `ref` are made deeply reactive with `reactive`.
6. **`computed(fn)`** is a **lazy, cached** effect. It recomputes only when its dependencies change *and* someone reads it.

**Vue 3.5 reworked the internals** (doubly-linked-list dependency tracking, version counting), with large memory savings. Mentioning that shows you stay current.

Here's a **runnable mini version** of the same design:

```js
const targetMap = new WeakMap();
let activeEffect = null;

function track(target, key) {
  if (!activeEffect) return;
  let depsMap = targetMap.get(target);
  if (!depsMap) targetMap.set(target, (depsMap = new Map()));
  let dep = depsMap.get(key);
  if (!dep) depsMap.set(key, (dep = new Set()));
  dep.add(activeEffect);
}

function trigger(target, key) {
  const dep = targetMap.get(target)?.get(key);
  if (dep) [...dep].forEach((effect) => (effect.scheduler ? effect.scheduler() : effect()));
}

const proxyCache = new WeakMap();                    // one proxy per target (Vue's reactiveMap)

function reactive(obj) {
  if (proxyCache.has(obj)) return proxyCache.get(obj);
  const proxy = new Proxy(obj, {
    get(t, key, receiver) {
      track(t, key);
      const value = Reflect.get(t, key, receiver);
      return value !== null && typeof value === 'object' ? reactive(value) : value; // lazy deep reactivity
    },
    set(t, key, value, receiver) {
      const old = t[key];
      const oldLength = Array.isArray(t) ? t.length : undefined;
      const ok = Reflect.set(t, key, value, receiver);
      if (!Object.is(old, value)) trigger(t, key);
      if (Array.isArray(t) && t.length !== oldLength) trigger(t, 'length'); // push/index add changes length
      return ok;
    },
    deleteProperty(t, key) {
      const had = Object.hasOwn(t, key);
      const ok = Reflect.deleteProperty(t, key);
      if (had) trigger(t, key);           // Vue 2 couldn't detect this
      return ok;
    },
  });
  proxyCache.set(obj, proxy);
  return proxy;
}

function effect(fn, scheduler) {
  const run = () => {
    const prev = activeEffect;
    activeEffect = run;
    try { return fn(); } finally { activeEffect = prev; }
  };
  run.scheduler = scheduler;
  run();
  return run;
}

function ref(value) {
  const box = {
    get value() { track(box, 'value'); return value; },
    set value(v) { if (!Object.is(v, value)) { value = v; trigger(box, 'value'); } },
  };
  return box;
}

function computed(getter) {
  let cached;
  let dirty = true;
  const box = {
    get value() {
      if (dirty) { cached = runner(); dirty = false; }
      track(box, 'value');
      return cached;
    },
  };
  const runner = effect(getter, () => { if (!dirty) { dirty = true; trigger(box, 'value'); } }); // lazy: just mark dirty
  dirty = true;
  return box;
}

// --- usage ---
const state = reactive({ participants: ['Asha'], meta: { title: 'Standup' } });
const max = ref(3);
let computeRuns = 0;
const seatsLeft = computed(() => { computeRuns++; return max.value - state.participants.length; });

const renders = [];
effect(() => renders.push(`${state.meta.title}: ${seatsLeft.value} seats left`));   // like a component render

state.participants.push('Ravi');   // array mutation is tracked (length/index)
state.meta.title = 'Sync';         // nested property
max.value = 5;
console.log(renders);

test('reactivity tracks reads and re-runs effects on writes', () => {
  expect(renders).toEqual(['Standup: 2 seats left', 'Standup: 1 seats left', 'Sync: 1 seats left', 'Sync: 3 seats left']);
  const before = computeRuns;
  void seatsLeft.value; void seatsLeft.value;   // cached: no recompute without changes
  expect(computeRuns).toBe(before);
});
```

### `ref` vs `reactive`: which should you use? 🔥

| | `ref()` | `reactive()` |
|---|---|---|
| Works with | **Any value**, including primitives | **Objects only** (objects, arrays, Map, Set) |
| Access | `.value` in JS; **auto-unwrapped in templates** | Direct property access |
| Reassigning the whole value | ✅ `list.value = newArray` | ❌ Replacing the variable loses reactivity; you must mutate properties |
| Destructuring | Keeps reactivity (it's an object holding `.value`) | ❌ **Destructuring loses reactivity.** Use `toRefs(state)` |
| Passing to functions/composables | Safe | Passing a property (`state.count`) passes a plain value |

**The Vue docs recommend `ref()` as the primary API** because of these pitfalls. Use `reactive` for grouped local state when you never reassign it.

**Related APIs:**

- **`shallowRef`/`shallowReactive`:** only top-level reactivity. Use them for large immutable data, or for non-Vue objects such as a `MediaStream`, a chart instance or a map SDK object, which shouldn't be proxied.
- **`markRaw`:** never proxy this object.
- **`readonly`:** a read-only proxy.
- **`toRef`/`toRefs`:** convert reactive properties into refs.
- **`unref`/`toValue`:** normalise refs, getters and plain values.
- **`triggerRef`:** manually trigger a `shallowRef`.

```js
// Why destructuring a reactive object breaks reactivity (illustrated with a getter-based object)
const state = { _count: 0, get count() { return this._count; } };
let { count } = state;          // copies the CURRENT value, not a live binding
state._count = 5;
console.log(count, state.count); // 0 5 — same problem as `const { count } = reactive(...)`
```

### `computed` vs `watch` vs `watchEffect` 🔥

- **`computed`** returns a **derived value**: **cached**, lazy and side-effect-free. Use it for anything you display that comes from other state, e.g. `fullName`, `filteredList`, `isFull`. A writable computed (`get`/`set`) exists for v-model proxies.
- **`watch(source, callback, options)`** runs **side effects in response to specific changes**, with access to **old and new values**. The source can be a ref, a getter or an array of sources.
  - **Lazy by default** (runs only on change). Use `{ immediate: true }` to run on start.
  - `deep: true` (or a depth number in 3.5), `once: true` (3.4).
  - `flush: 'pre'` (default, before the component updates), `'post'` (after the DOM updates, for reading the DOM) or `'sync'` (rarely).
  - Use it for fetching when an ID changes, syncing to localStorage, or calling imperative APIs.
- **`watchEffect(fn)`** **runs immediately** and **auto-tracks** whatever reactive state it reads. It's convenient, but its dependencies are implicit and it doesn't give old values.
- **Cleanup:** the `onCleanup` argument, or **`onWatcherCleanup()`** (3.5), cancels stale requests when the source changes again, like React effect cleanup.

```js
// watch(() => props.meetingId, async (id, oldId, onCleanup) => {
//   const controller = new AbortController();
//   onCleanup(() => controller.abort());          // previous request cancelled if id changes again
//   participants.value = await fetchParticipants(id, controller.signal);
// }, { immediate: true });
```

### What is `nextTick` and why do you need it?

Vue **batches** DOM updates. Changing state queues a component update, and the actual DOM patch happens **asynchronously** in a microtask, with multiple changes coalesced. If you need to **read the DOM after a state change** (scroll to the new chat message, measure an element, focus a new input), `await nextTick()` first.

```js
// messages.value.push(msg);
// await nextTick();                 // DOM now contains the new message
// listEl.value.scrollTop = listEl.value.scrollHeight;
```

## Components

### How do components communicate in Vue? 🔥

| Direction | Mechanism |
|---|---|
| Parent → child | **Props** (`defineProps`, with types/validators/defaults). They're one-way: **never mutate props** in the child |
| Child → parent | **Emits** (`defineEmits`), e.g. `emit('update', value)` |
| Two-way binding | **`v-model`**: `modelValue` + `update:modelValue`, multiple named v-models (`v-model:title`), **`defineModel()`** (3.4) |
| Ancestor → descendants | **`provide` / `inject`** (with `InjectionKey<T>` for types; provide refs for reactivity) |
| Parent → child content | **Slots**: default, named (`#header`), **scoped slots** (child passes data up to the slot content) |
| Parent calling child methods | Template ref + **`defineExpose`** (children in `<script setup>` are closed by default) |
| Global/shared state | **Pinia** store |
| Non-prop attributes | `$attrs` fallthrough (class, style, listeners); `inheritAttrs: false` to control placement |

```vue
<!-- ParticipantList.vue: scoped slot lets the parent decide how each row renders -->
<script setup lang="ts">
defineProps<{ participants: { id: string; name: string; muted: boolean }[] }>();
const selected = defineModel<string | null>('selected', { default: null });   // v-model:selected
</script>
<template>
  <ul>
    <li v-for="p in participants" :key="p.id" @click="selected = p.id" :class="{ active: selected === p.id }">
      <slot name="row" :participant="p">{{ p.name }}</slot>
    </li>
  </ul>
</template>

<!-- Parent -->
<ParticipantList :participants="list" v-model:selected="activeId">
  <template #row="{ participant }">
    {{ participant.name }} <span v-if="participant.muted">🔇</span>
  </template>
</ParticipantList>
```

### `v-if` vs `v-show`, and `v-if` with `v-for`

- **`v-if`** **creates or destroys** the element and its component instances. It has a higher toggle cost, but no cost when false. Use it for rarely toggled content, or for content that shouldn't exist at all (permissions).
- **`v-show`** always renders and toggles CSS `display`. Initial render cost, cheap toggles. Use it for frequently toggled UI (dropdowns, tabs). It doesn't work on `<template>`.
- **`v-if` + `v-for` on the same element:** in **Vue 3, `v-if` has higher precedence** (the opposite of Vue 2), so `v-if` can't access the loop variable. **Don't combine them.** Filter with a computed property, or wrap the loop in `<template v-for>` with `v-if` inside.
- **Always use a stable `:key`** with `v-for`. The same index-key pitfalls as React apply.

### What are composables? How do they compare to mixins and React hooks? 🔥

**Composables** are functions using the Composition API that **encapsulate reusable stateful logic**, by convention named `useX`. They return refs and functions.

**vs mixins:**

- explicit sources (you see where each value comes from)
- no namespace collisions
- they can take arguments
- they're type-safe

**vs React hooks:**

- `setup` runs **once per component instance**, not on every render, so **there are no stale-closure problems** and no dependency arrays
- reactivity tracks dependencies automatically
- composables can be called conditionally (still synchronously, inside `setup`)

```tslib
// useFetch.ts — composable with reactive input and abort on change
import { ref, watchEffect, toValue, type MaybeRefOrGetter } from 'vue';

export function useFetch<T>(url: MaybeRefOrGetter<string | null>) {
  const data = ref<T | null>(null);
  const error = ref<Error | null>(null);
  const loading = ref(false);

  watchEffect(async (onCleanup) => {
    const u = toValue(url);                 // tracks the ref/getter
    if (!u) return;
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    loading.value = true;
    error.value = null;
    try {
      const res = await fetch(u, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data.value = await res.json();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') error.value = e as Error;
    } finally {
      loading.value = false;
    }
  });

  return { data, error, loading };
}
// const { data: recordings } = useFetch(() => `/api/meetings/${props.id}/recordings`);
```

### Explain lifecycle hooks in the Composition API

`onBeforeMount` → `onMounted` (DOM available) → `onBeforeUpdate` → `onUpdated` → `onBeforeUnmount` → `onUnmounted` (clean up listeners, timers, sockets). There are also:

- **`onErrorCaptured`** (an error-boundary-like hook)
- **`onActivated`/`onDeactivated`** for components inside **`<KeepAlive>`** (cached instead of destroyed)
- `onServerPrefetch` for SSR
- `onRenderTracked`/`onRenderTriggered` for debugging

`setup()` itself runs before `onBeforeMount` and replaces `beforeCreate`/`created`.

### What are `<KeepAlive>`, `<Teleport>`, `<Transition>` and `<Suspense>`?

- **`<KeepAlive include max>`** caches inactive component instances (preserving state and DOM) when switching dynamic components or routes, e.g. tabs or a meeting sidebar.
- **`<Teleport to="body">`** renders content into another DOM location: modals, toasts, tooltips. It's like React portals.
- **`<Transition>` / `<TransitionGroup>`** apply enter/leave CSS classes or JS hooks for animations, including list moves.
- **`<Suspense>`** (still marked experimental) shows fallback content while async `setup()` components or async components resolve.

### What are custom directives? Give an example

Directives give **low-level DOM access** for reusable behaviour: `v-focus`, `v-click-outside`, `v-tooltip`, lazy-loading images. Hooks: `created`, `beforeMount`, `mounted`, `beforeUpdate`, `updated`, `beforeUnmount` and `unmounted`. Each receives `(el, binding, vnode)`.

```tslib
// v-click-outside
export const vClickOutside = {
  mounted(el: HTMLElement & { __handler?: (e: Event) => void }, binding: { value: (e: Event) => void }) {
    el.__handler = (e) => { if (!el.contains(e.target as Node)) binding.value(e); };
    document.addEventListener('pointerdown', el.__handler);
  },
  unmounted(el: HTMLElement & { __handler?: (e: Event) => void }) {
    document.removeEventListener('pointerdown', el.__handler!);
  },
};
// <div v-click-outside="closeMenu">…</div>
```

## Ecosystem

### Pinia vs Vuex: how does Pinia work? 🔥

**Pinia** is the official state library for Vue 3 (Vuex is in maintenance mode).

- **No mutations:** actions can be sync or async and modify state directly.
- **Multiple stores** (modular by design) instead of one store with nested modules.
- **Excellent TypeScript inference.**
- **Two styles:** options stores (`state`, `getters`, `actions`) or **setup stores** (a function using `ref`/`computed`, like a composable).
- **Devtools**, plugins (e.g. persistence), SSR support, hot module replacement.
- **`storeToRefs(store)`** destructures state and getters **without losing reactivity**. Actions can be destructured directly.

```tslib
// stores/meeting.ts — setup store
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export const useMeetingStore = defineStore('meeting', () => {
  const participants = ref<Record<string, { name: string; handRaised: boolean }>>({});
  const handsUp = computed(() => Object.entries(participants.value).filter(([, p]) => p.handRaised).map(([id]) => id));
  function join(id: string, name: string) { participants.value[id] = { name, handRaised: false }; }
  function raiseHand(id: string) { const p = participants.value[id]; if (p) p.handRaised = true; }
  async function load(meetingId: string) {
    participants.value = await (await fetch(`/api/meetings/${meetingId}/participants`)).json();
  }
  return { participants, handsUp, join, raiseHand, load };
});

// component
// const store = useMeetingStore();
// const { participants, handsUp } = storeToRefs(store);   // stays reactive
// const { raiseHand } = store;                            // actions are fine to destructure
```

### Explain Vue Router: dynamic routes, guards and lazy loading 🔥

```tslib
const router = createRouter({
  history: createWebHistory(),              // HTML5 history (needs server fallback); createWebHashHistory for static hosting
  routes: [
    { path: '/', component: () => import('./pages/Home.vue') },                       // lazy-loaded chunk
    { path: '/meetings/:id', component: () => import('./pages/Meeting.vue'), props: true, meta: { requiresAuth: true } },
    { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFound.vue') },    // catch-all
  ],
  scrollBehavior: (to, from, saved) => saved ?? { top: 0 },
});

router.beforeEach(async (to) => {           // global guard
  const auth = useAuthStore();
  if (to.meta.requiresAuth && !auth.isLoggedIn) return { path: '/login', query: { next: to.fullPath } };
});
```

- **Guards:**
  - global: `beforeEach`, `beforeResolve`, `afterEach`
  - per route: `beforeEnter`
  - in component: `onBeforeRouteLeave` (e.g. "leave the meeting?" confirmation) and `onBeforeRouteUpdate`
- **Composition API:** `useRoute()`, `useRouter()`. Nested routes use `<RouterView>`, and named views are supported.
- **The params-only-change gotcha:** navigating from `/meetings/1` to `/meetings/2` **reuses the component**, so watch `route.params.id` or use `onBeforeRouteUpdate`.

### How does Vue's compiler optimise rendering compared to React? 🔥

Vue templates are **compiled** to render functions. Because the compiler **knows which parts are static**, it emits hints:

- **Static hoisting:** fully static nodes and props are created once and reused.
- **Patch flags:** dynamic nodes get flags (`TEXT`, `CLASS`, `PROPS`…). At runtime Vue only diffs what can change, not every attribute.
- **Block tree:** each block tracks its **dynamic descendants in a flat array**, so updates skip static subtrees entirely instead of walking the whole tree.
- **Cached event handlers**, plus `v-once` and **`v-memo`** for manual control.

On top of that, **fine-grained reactivity** means **only components whose reactive dependencies changed re-render**. There's no "parent re-renders all children by default" problem as in React, so there's much less need for manual memoisation.

**Vapor Mode** (in development for Vue 3.6) compiles templates to **direct DOM operations without a VDOM**, similar to Solid. It's opt-in per component.

### Vue vs React: how do you compare them? 🔥

| | Vue 3 | React |
|---|---|---|
| Templates | HTML-like templates (+ JSX optional), SFCs with scoped CSS | JSX (JavaScript all the way) |
| Reactivity | **Automatic dependency tracking** (Proxies); fine-grained re-renders | **Explicit** `setState`; re-render the component and its children; memoise manually or use the React Compiler |
| Logic reuse | Composables (`setup` runs once) | Hooks (run every render, so dependency arrays and stale closures exist) |
| Two-way binding | `v-model` built-in | Controlled components |
| Official ecosystem | Router, Pinia, Devtools, Vite (same author), Nuxt | Unopinionated: choose a router, state and framework (Next.js, React Router) |
| Styling | Scoped CSS, CSS modules, `v-bind()` in CSS | CSS modules, CSS-in-JS, Tailwind… |
| Mobile | (Capacitor, NativeScript) | **React Native** |
| Server components | Nuxt server components (experimental) | **RSC**, mature in Next.js |
| Market | Strong in Asia/Europe, Laravel ecosystem | Largest ecosystem and job market |

**Balanced answer:**

> "Both are excellent. Vue gives you more out of the box and fewer performance footguns thanks to fine-grained reactivity. React gives you a huge ecosystem, React Native, and the most mature server-component story. Moving between them is mostly about the reactivity mental model: in Vue, state is mutable and tracked; in React, state is immutable and rendering is explicit."

### What is Nuxt and how does it compare to Next.js?

**Nuxt** is the Vue meta-framework, Next.js's counterpart:

- file-based routing (`pages/`), layouts, middleware
- **SSR/SSG/hybrid rendering per route** (`routeRules`: `prerender`, `swr`, `isr`, `ssr: false`)
- **auto-imports** (components, composables)
- **`useFetch`/`useAsyncData`** for SSR-safe data fetching with payload transfer, so there's no double fetch on hydration
- server routes and API via the **Nitro** engine, which deploys anywhere (Node, serverless, edge)
- modules ecosystem (Pinia, i18n, image, content)

`useFetch` is similar in spirit to Next's server-side data fetching plus hydration, without RSC.

### How do you optimise performance in a Vue app?

- **`shallowRef`/`markRaw`** for large datasets and third-party objects, so Vue doesn't deep-proxy them (expensive on huge arrays).
- **`computed`** for derived data (cached) instead of methods in templates (re-run on every render).
- **Stable `:key`**, `v-once` for static content, and `v-memo` for expensive list rows.
- **Lazy components:** `defineAsyncComponent` and route-level lazy loading.
- **Virtual scrolling** for long lists (vue-virtual-scroller, TanStack Virtual for Vue).
- **Avoid deep watchers** on big objects. Watch specific getters instead.
- **`KeepAlive`** for expensive views switched often. Props stability matters less than in React, but avoid recreating large objects in parents.
- Measure with the Vue Devtools performance timeline and the browser Performance panel.

### How do you handle errors and test Vue components?

- **Errors:**
  - `onErrorCaptured` in parent components (return `false` to stop propagation)
  - **`app.config.errorHandler`** for global reporting (Sentry)
  - `app.config.warnHandler` in development
  - async errors in composables: catch them and expose an error ref
- **Testing:**
  - **Vitest** + **Vue Test Utils** (`mount`, `wrapper.find`, `trigger`, `setProps`, `emitted()`)
  - or **@testing-library/vue** for behaviour-focused tests (same philosophy as RTL)
  - mock Pinia with `createTestingPinia`
  - E2E with Playwright or Cypress
