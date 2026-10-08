# TypeScript (Advanced)

Your resume lists TypeScript across MeetHour (React, React Native, Electron) and the AWS projects. Senior interviews go beyond "add types to props". Expect **generics, conditional and mapped types, narrowing, React typing patterns and tsconfig strictness**.

> Code labelled **TypeScript** runs in the playground. Types are **stripped** (with sucrase), not type-checked, so the runtime behaviour executes. Blocks labelled **TypeScript · types only** are pure type-level code. Paste those into the TypeScript Playground (typescriptlang.org/play) or your editor to see the inferred types in hover tooltips.

## Fundamentals

### Why TypeScript? What does "structural typing" and "type erasure" mean? 🔥

- **Why:** you catch bugs at compile time (null/undefined access, wrong shapes, typos), refactoring is safe, editor tooling is excellent (autocomplete, go-to-definition), and types act as **living documentation** for API contracts. In large React codebases like MeetHour's, it makes changes to shared state shapes safe.
- **Structural typing:** compatibility is based on **shape**, not on declared names. If an object has the required properties, it fits, even if it was never declared with that interface. This is "duck typing at compile time". (Java and Kotlin are *nominal*.)
- **Type erasure:** types **don't exist at runtime**. `tsc`/esbuild/sucrase remove them. So you **can't** `instanceof` an interface or validate API responses with types alone. You need **runtime validation** (type guards, or zod/valibot) at trust boundaries.

```ts
interface Point { x: number; y: number }
class Vector { constructor(public x: number, public y: number, public z = 0) {} }

function len(p: Point) { return Math.hypot(p.x, p.y); }

console.log(len({ x: 3, y: 4 }));        // object literal fits
console.log(len(new Vector(6, 8)));       // a class with extra props also fits (structural)

// At runtime the interface is gone:
console.log(typeof (globalThis as any).Point); // 'undefined'
```

**Excess property checks** are the exception: an object **literal** passed directly is checked for extra properties (`len({ x: 1, y: 2, z: 3 })` is an error), because extra properties in a fresh literal are usually typos.

### `interface` vs `type`: when do you use which? 🔥

| | `interface` | `type` alias |
|---|---|---|
| Object shapes | ✅ | ✅ |
| Unions, tuples, primitives, mapped/conditional types | ❌ | ✅ |
| **Declaration merging** (re-opening) | ✅ (e.g. augment `Window`, library types) | ❌ (duplicate identifier) |
| Extending | `extends` (errors on conflicting members) | `&` intersection (conflicts become `never`) |
| Error messages and performance | Named in errors; interface `extends` checks are cached, so a bit faster for big hierarchies | Fine for most uses |

**Practical rule:** use `interface` for **public object contracts** that may need augmentation (props, API models, library extension points). Use `type` for **unions, compositions, mapped and conditional types**. Consistency within the codebase matters more than the choice.

```tstype
interface User { id: string }
interface User { name: string }          // merges: User = { id; name }

type Status = 'idle' | 'loading' | 'error';           // only possible with `type`
type WithTimestamps<T> = T & { createdAt: Date; updatedAt: Date };

declare global {
  interface Window { meetHourConfig?: { domain: string } } // augmentation needs interface
}
```

### Explain `any`, `unknown`, `never` and `void` 🔥

- **`any`** switches off type checking. Anything goes, and it **spreads silently** through your code. Avoid it (`noImplicitAny`, lint rule `no-explicit-any`).
- **`unknown`** is the type-safe "anything". You **must narrow** before using it. Use it for `JSON.parse` results, `catch (e)` variables (with `useUnknownInCatchVariables`, part of `strict`), and external input.
- **`never`** is the type with **no values**. It's the return type of functions that never return (throw, infinite loop), the result of impossible intersections (`string & number`), and what you get in exhaustive checks. It's the *bottom type*: assignable to everything, nothing is assignable to it.
- **`void`** means "the return value isn't meant to be used". A function type `() => void` **accepts** functions that return values, which is why `arr.forEach(x => list.push(x))` compiles.

```ts
function parse(json: string): unknown {
  return JSON.parse(json);
}
const data = parse('{"name":"Zaki"}');
// data.name;                 // ❌ error: 'data' is of type 'unknown'
if (typeof data === 'object' && data !== null && 'name' in data) {
  console.log((data as { name: string }).name.toUpperCase()); // narrowed
}

function fail(message: string): never {
  throw new Error(message);
}

try {
  fail('unreachable state');
} catch (e: unknown) {
  console.log(e instanceof Error ? e.message : String(e));
}
```

### What are discriminated unions and exhaustive checks? 🔥

A **discriminated (tagged) union** is a union of object types that share a **literal "tag" property** (`type`, `kind`, `status`). Checking the tag **narrows** to the matching member. Use a `never` assignment in `default` so the compiler fails if a new member isn't handled. This is the TypeScript version of Kotlin's `sealed class` + `when`.

```ts
type RecordingSession =
  | { status: 'pending'; id: string }
  | { status: 'on'; id: string; startedAt: number; mode: 'file' | 'stream' }
  | { status: 'failed'; id: string; error: string }
  | { status: 'off'; id: string; durationMs: number };

function assertNever(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

function label(s: RecordingSession): string {
  switch (s.status) {
    case 'pending': return 'Starting…';
    case 'on': return `${s.mode === 'file' ? 'Recording' : 'Live'} since ${new Date(s.startedAt).toISOString().slice(11, 19)}`;
    case 'failed': return `Failed: ${s.error}`;          // s.error exists only in this branch
    case 'off': return `Stopped after ${Math.round(s.durationMs / 1000)}s`;
    default: return assertNever(s);                      // compile error if a status is added but not handled
  }
}

const sessions: RecordingSession[] = [
  { status: 'on', id: '1', startedAt: Date.UTC(2025, 0, 1, 10, 30), mode: 'stream' },
  { status: 'failed', id: '2', error: 'Invalid stream key' },
  { status: 'off', id: '3', durationMs: 65_400 },
];
sessions.forEach((s) => console.log(label(s)));

test('labels', () => {
  expect(label({ status: 'pending', id: 'x' })).toBe('Starting…');
  expect(() => label({ status: 'weird' } as any)).toThrow('Unhandled case');
});
```

The same pattern types **Redux/useReducer actions**, **API responses** (`{ ok: true, data } | { ok: false, error }`) and **UI state machines**. Prefer it over a bag of optional fields (`data?`, `error?`, `loading?`) that allows impossible combinations.

### How does type narrowing work? Name the narrowing techniques 🔥

TypeScript uses **control-flow analysis** to refine a variable's type inside a branch:

| Technique | Example |
|---|---|
| `typeof` | `typeof x === 'string'` |
| `instanceof` | `err instanceof DOMException` |
| `in` operator | `'error' in result` |
| Equality / literal checks | `s.status === 'on'`, `x === null` |
| Truthiness | `if (user)` (careful with `0` and `''`) |
| **User-defined type guard** | `function isUser(x: unknown): x is User` |
| **Assertion function** | `function assertUser(x: unknown): asserts x is User` |
| `Array.isArray` | narrows to `any[]` |
| Inferred type predicates (TS 5.5+) | `arr.filter(x => x !== null)` now narrows to non-null |

```ts
interface Participant { id: string; name: string; role: 'host' | 'guest' }

function isParticipant(x: unknown): x is Participant {
  return (
    typeof x === 'object' && x !== null &&
    typeof (x as Participant).id === 'string' &&
    typeof (x as Participant).name === 'string' &&
    ['host', 'guest'].includes((x as Participant).role)
  );
}

function assertIsParticipant(x: unknown): asserts x is Participant {
  if (!isParticipant(x)) throw new TypeError('Invalid participant payload');
}

const payload: unknown = JSON.parse('{"id":"p1","name":"Asha","role":"host"}');
assertIsParticipant(payload);
console.log(payload.name);                 // narrowed after the assertion

const mixed = [{ id: 'a', name: 'A', role: 'guest' }, null, { bad: true }];
const valid = mixed.filter(isParticipant);  // Participant[]
console.log(valid.length);

test('guards validate at runtime', () => {
  expect(isParticipant({ id: '1', name: 'x', role: 'admin' })).toBe(false);
  expect(() => assertIsParticipant(42)).toThrow(TypeError);
});
```

### Enums vs union literal types vs `as const` objects

- **Numeric enums** generate runtime objects with **reverse mappings**, and any number is assignable to them (a classic footgun in older TS).
- **String enums** are nominal-ish and generate code.
- **`const enum`** is inlined, but it's **problematic with `isolatedModules`/Babel/esbuild/sucrase**, which compile files one at a time.
- **Modern preference:** a **union of string literals** for types, plus an **`as const` object** when you also need runtime values to iterate. These are erasable, tree-shakeable and work with any transpiler. Newer TS flags such as `--erasableSyntaxOnly` push toward this, matching Node's type stripping.

```ts
const Roles = { Host: 'host', Cohost: 'cohost', Guest: 'guest' } as const;
type Role = (typeof Roles)[keyof typeof Roles];   // 'host' | 'cohost' | 'guest'

function canMute(role: Role) { return role === Roles.Host || role === Roles.Cohost; }

console.log(Object.values(Roles), canMute('guest'), canMute(Roles.Cohost));

enum Direction { Up, Down }                        // numeric enum: runtime object with reverse mapping
console.log(Direction.Up, Direction[0]);
```

### What does `as const` do? And `satisfies`? 🔥

- **`as const`** makes a literal **deeply readonly** and infers the **narrowest literal types** (`'GET'` instead of `string`, tuples instead of arrays).
- **`satisfies T`** (TS 4.9) **checks** that an expression matches `T` **without widening** its inferred type. You get validation *and* precise types, which a `: T` annotation can't give you, because the annotation widens.

```ts
type Route = { path: string; auth: boolean };

// With an annotation the keys are widened to string; with satisfies they stay precise.
const routes = {
  home: { path: '/', auth: false },
  meeting: { path: '/m/:id', auth: true },
} satisfies Record<string, Route>;

type RouteName = keyof typeof routes;            // 'home' | 'meeting' (not string)
const go = (name: RouteName) => routes[name].path;
console.log(go('meeting'));

const methods = ['GET', 'POST'] as const;          // readonly ['GET', 'POST']
type Method = (typeof methods)[number];            // 'GET' | 'POST'
const m: Method = 'GET';
console.log(m, methods.includes('POST'));
```

### Explain function overloads and when to use them

Overloads give a function **several call signatures** with **one implementation**. Callers see only the overload signatures. Use them when the **return type depends on the argument types** in a way a union can't express. Often a **generic or conditional type** is cleaner.

```ts
function getElement(id: string): HTMLElementLike | null;
function getElement(ids: string[]): (HTMLElementLike | null)[];
function getElement(idOrIds: string | string[]) {
  const lookup = (id: string) => (id.startsWith('#') ? { id } : null);
  return Array.isArray(idOrIds) ? idOrIds.map(lookup) : lookup(idOrIds);
}
interface HTMLElementLike { id: string }

const one = getElement('#video');            // HTMLElementLike | null
const many = getElement(['#a', 'b']);        // (HTMLElementLike | null)[]
console.log(one, many);
```

## Generics & type-level programming

### Explain generics with constraints and defaults 🔥

**Generics** are type parameters, so code works over many types while **preserving the relationship** between inputs and outputs.

- **Constraints** (`T extends X`) require a minimum shape.
- **Defaults** (`T = string`) apply when the type can't be inferred.
- **`keyof` + indexed access** (`T[K]`) lets you type property lookups precisely.

```ts
function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}

interface Meeting { id: number; title: string; live: boolean }
const meetings: Meeting[] = [
  { id: 1, title: 'Standup', live: true },
  { id: 2, title: 'Webinar', live: false },
];
const titles = pluck(meetings, 'title');   // string[]
const ids = pluck(meetings, 'id');         // number[]
// pluck(meetings, 'nope');                // ❌ not a key of Meeting

function groupBy<T, K extends PropertyKey>(items: T[], keyFn: (item: T) => K): Record<K, T[]> {
  return items.reduce((acc, item) => {
    (acc[keyFn(item)] ??= []).push(item);
    return acc;
  }, {} as Record<K, T[]>);
}

interface ApiResponse<T = unknown, E = { message: string }> { data?: T; error?: E }
const res: ApiResponse<Meeting[]> = { data: meetings };

console.log(titles, ids, Object.keys(groupBy(meetings, (m) => (m.live ? 'live' : 'scheduled'))), res.data?.length);
```

**Generic React components** (`function List<T>({ items, render }: …)`) are covered in the React section below.

### What are mapped types? Implement `Partial`, `Readonly`, `Pick` and `Record` 🔥

A **mapped type** iterates over keys: `{ [K in Keys]: … }`.

- **Modifiers:** `?` and `readonly`, which you can add with `+` or remove with `-`.
- **Key remapping** with `as` (TS 4.1) lets you rename or filter keys.

```tstype
type MyPartial<T> = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };            // remove optional
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
type Mutable<T> = { -readonly [K in keyof T]: T[K] };       // remove readonly
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyRecord<K extends PropertyKey, V> = { [P in K]: V };

// Key remapping: build getter names and filter keys by value type
type Getters<T> = { [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K] };
type OnlyFunctions<T> = { [K in keyof T as T[K] extends (...a: any[]) => any ? K : never]: T[K] };

interface Settings { volume: number; muted: boolean; save(): void }
type SettingsGetters = Getters<Settings>;
//   { getVolume: () => number; getMuted: () => boolean; getSave: () => () => void }
type SettingsMethods = OnlyFunctions<Settings>;   // { save(): void }
```

### What are conditional types and `infer`? Implement `ReturnType`, `Awaited` and `Parameters` 🔥

- **`T extends U ? X : Y`** is a type-level if/else.
- **`infer R`** declares a type variable **captured by pattern matching** inside the `extends` clause.
- **Distributive behaviour:** when `T` is a **naked type parameter** and receives a union, the conditional applies to **each member separately**. Wrap it in brackets (`[T] extends [U]`) to stop that.

```tstype
type MyReturnType<F> = F extends (...args: any[]) => infer R ? R : never;
type MyParameters<F> = F extends (...args: infer P) => any ? P : never;
type MyAwaited<T> = T extends PromiseLike<infer V> ? MyAwaited<V> : T;   // recursive unwrap
type ElementType<T> = T extends readonly (infer E)[] ? E : T;

type MyExclude<T, U> = T extends U ? never : T;          // distributive over T
type MyExtract<T, U> = T extends U ? T : never;
type MyNonNullable<T> = T extends null | undefined ? never : T;
type MyOmit<T, K extends PropertyKey> = Pick<T, Exclude<keyof T, K>>;

async function fetchUser(id: string, includeRoles = false) { return { id, roles: includeRoles ? ['host'] : [] }; }
type U1 = MyAwaited<MyReturnType<typeof fetchUser>>;   // { id: string; roles: string[] }
type P1 = MyParameters<typeof fetchUser>;              // [id: string, includeRoles?: boolean]

type T1 = MyExclude<'a' | 'b' | 'c', 'a'>;            // 'b' | 'c'
type IsString<T> = T extends string ? true : false;
type D = IsString<string | number>;                    // boolean (distributed: true | false)
type ND = [string | number] extends [string] ? true : false; // false (non-distributive)
```

### Implement `DeepPartial` and `DeepReadonly`

```tstype
type DeepPartial<T> = T extends (...args: any[]) => any
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

type DeepReadonly<T> = T extends (...args: any[]) => any
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

interface MeetingConfig { video: { resolution: number; simulcast: { enabled: boolean } }; audio: { stereo: boolean } }
const override: DeepPartial<MeetingConfig> = { video: { simulcast: { enabled: false } } }; // ✅ nested partial
```

`DeepPartial` is useful for config overrides and test fixtures. `DeepReadonly` is useful for Redux state and immutable config.

### What are template literal types? Give a practical example 🔥

Template literal types build string literal types from other types. Combined with mapped types and `infer`, they can type **event names, routes, CSS values and i18n keys**.

```tstype
type Events = { 'participant-joined': { id: string }; 'recording-started': { mode: 'file' | 'stream' } };
type HandlerName<K extends string> = `on${Capitalize<CamelCase<K>>}`;
type CamelCase<S extends string> = S extends `${infer H}-${infer T}` ? `${H}${Capitalize<CamelCase<T>>}` : S;

type Handlers = { [K in keyof Events as HandlerName<K & string>]: (payload: Events[K]) => void };
//   { onParticipantJoined: (p: { id: string }) => void; onRecordingStarted: (p: { mode: ... }) => void }

// Extract route params: '/m/:meetingId/rec/:recId' -> 'meetingId' | 'recId'
type Params<Path extends string> =
  Path extends `${string}:${infer P}/${infer Rest}` ? P | Params<`/${Rest}`>
  : Path extends `${string}:${infer P}` ? P
  : never;
type RecParams = Record<Params<'/m/:meetingId/rec/:recId'>, string>; // { meetingId: string; recId: string }
```

React Router and tRPC use exactly this technique to give typed route params.

### Explain covariance and contravariance in TypeScript

- **Covariant:** if `Dog extends Animal`, then `Dog[]` is assignable to `Animal[]`. Return types are covariant.
- **Contravariant:** function **parameters** go the other way. A handler for `Animal` can be used where a handler for `Dog` is expected, but not the reverse. With `strictFunctionTypes`, TS checks function-type parameters contravariantly.
- **Method bivariance:** parameters of **methods** (declared with method syntax, `handle(x: Dog): void`) are still checked **bivariantly** for compatibility with common patterns. That's a known unsoundness. Prefer property syntax (`handle: (x: Dog) => void`) for stricter checking.
- TS 4.7 added explicit variance annotations for type parameters: `interface Producer<out T>` and `interface Consumer<in T>`.
- **Arrays are unsoundly covariant** in TS: you can push a `Cat` into a `Dog[]` viewed as `Animal[]`. Use `readonly` arrays to stay safe.

```tstype
interface Animal { name: string }
interface Dog extends Animal { bark(): void }

let handleAnimal = (a: Animal) => console.log(a.name);
let handleDog = (d: Dog) => d.bark();

handleDog = handleAnimal;   // ✅ contravariance: an Animal handler can handle Dogs
// handleAnimal = handleDog; // ❌ with strictFunctionTypes: a Dog handler can't handle every Animal
```

### What are branded (nominal) types and why use them? 🔥

Structural typing means `type UserId = string` and `type MeetingId = string` are interchangeable, so swapping them is a silent bug. **Branding** adds a phantom property so they become distinct. Create branded values only through **validating constructors**.

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, 'UserId'>;
type MeetingId = Brand<string, 'MeetingId'>;

const UserId = (s: string): UserId => {
  if (!/^u_[a-z0-9]{6}$/.test(s)) throw new Error(`Invalid UserId: ${s}`);
  return s as UserId;
};
const MeetingId = (s: string): MeetingId => s as MeetingId;

function kick(meeting: MeetingId, user: UserId) { return `kicked ${user} from ${meeting}`; }

const u = UserId('u_abc123');
const m = MeetingId('weekly-sync');
console.log(kick(m, u));
// kick(u, m);            // ❌ compile error: arguments swapped

test('validating constructor', () => {
  expect(() => UserId('bob')).toThrow('Invalid UserId');
});
```

### How do you type a recursive structure such as JSON?

```tstype
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

interface TreeNode<T> { value: T; children?: TreeNode<T>[] }

const config: Json = { theme: 'dark', features: ['rec', 'webinar'], limits: { visitors: 10000 } };
// const bad: Json = { when: new Date() }; // ❌ Date is not Json
```

## TypeScript with React

### How do you type component props, children, events and refs? 🔥

```tsx
import { useRef, useState, type ReactNode, type ChangeEvent, type FormEvent, type ComponentPropsWithoutRef } from 'react';

type ButtonProps = ComponentPropsWithoutRef<'button'> & {   // all native button props
  variant?: 'primary' | 'ghost';
  icon?: ReactNode;
};

export function Button({ variant = 'primary', icon, children, ...rest }: ButtonProps) {
  return <button className={`btn btn-${variant}`} {...rest}>{icon}{children}</button>;
}

export function JoinForm({ onJoin }: { onJoin: (name: string) => void }) {
  const [name, setName] = useState('');                          // inferred string
  const [error, setError] = useState<string | null>(null);      // explicit union
  const inputRef = useRef<HTMLInputElement>(null);              // DOM ref

  const onChange = (e: ChangeEvent<HTMLInputElement>) => setName(e.target.value);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name required'); inputRef.current?.focus(); return; }
    onJoin(name);
  };
  return (
    <form onSubmit={onSubmit}>
      <input ref={inputRef} value={name} onChange={onChange} aria-invalid={!!error} />
      {error && <p role="alert">{error}</p>}
      <Button type="submit">Join</Button>
    </form>
  );
}
```

**Key points:**

- **`children: ReactNode`** accepts anything renderable. Avoid `React.FC`'s historical implicit-children issues; typing props directly is the common style today.
- **`ComponentPropsWithoutRef<'button'>`** (or `ComponentProps<typeof X>`) **inherits native props** for wrappers.
- **Event types:** `ChangeEvent<HTMLInputElement>`, `MouseEvent<HTMLButtonElement>`, `KeyboardEvent`, `FormEvent<HTMLFormElement>`.
- **`useRef<HTMLDivElement>(null)`** for DOM refs (`.current` is read-only and nullable) vs `useRef<number>()` for mutable values.
- **React 19:** `ref` is a regular prop for function components, so `forwardRef` is no longer needed. Type it as `ref?: Ref<HTMLInputElement>`.

### How do you type `useReducer` and Context safely? 🔥

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';

type State = { participants: Record<string, { name: string; muted: boolean }>; dominantSpeaker: string | null };
type Action =
  | { type: 'joined'; id: string; name: string }
  | { type: 'left'; id: string }
  | { type: 'muteToggled'; id: string }
  | { type: 'dominantSpeakerChanged'; id: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'joined':
      return { ...state, participants: { ...state.participants, [action.id]: { name: action.name, muted: false } } };
    case 'left': {
      const { [action.id]: _removed, ...rest } = state.participants;
      return { ...state, participants: rest };
    }
    case 'muteToggled': {
      const p = state.participants[action.id];
      return p ? { ...state, participants: { ...state.participants, [action.id]: { ...p, muted: !p.muted } } } : state;
    }
    case 'dominantSpeakerChanged':
      return { ...state, dominantSpeaker: action.id };
  }
}

// Context with `undefined` default + a guard hook: no fake default values, clear error if the Provider is missing
const ConferenceContext = createContext<{ state: State; dispatch: Dispatch<Action> } | undefined>(undefined);

export function ConferenceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { participants: {}, dominantSpeaker: null });
  return <ConferenceContext.Provider value={{ state, dispatch }}>{children}</ConferenceContext.Provider>;
}

export function useConference() {
  const ctx = useContext(ConferenceContext);
  if (!ctx) throw new Error('useConference must be used inside <ConferenceProvider>');
  return ctx;
}
```

Because `Action` is a discriminated union, `dispatch({ type: 'joined', id })` without `name` is a compile error.

### How do you write a generic React component? 🔥

```tsx
type ListProps<T> = {
  items: T[];
  getKey: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  emptyText?: string;
};

export function List<T>({ items, getKey, renderItem, emptyText = 'Nothing here' }: ListProps<T>) {
  if (!items.length) return <p>{emptyText}</p>;
  return <ul>{items.map((item) => <li key={getKey(item)}>{renderItem(item)}</li>)}</ul>;
}

// T is inferred as Participant: renderItem gets full autocomplete
<List items={participants} getKey={(p) => p.id} renderItem={(p) => p.name} />;

// In .tsx files, generic arrow functions need a trailing comma: const Select = <T,>(props: SelectProps<T>) => …
```

### How do you build a polymorphic `as` prop component?

```tsx
import type { ElementType, ComponentPropsWithoutRef, ReactNode } from 'react';

type TextProps<C extends ElementType> = {
  as?: C;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<C>, 'as' | 'children'>;

export function Text<C extends ElementType = 'span'>({ as, children, ...rest }: TextProps<C>) {
  const Component = as ?? 'span';
  return <Component {...rest}>{children}</Component>;
}

<Text as="a" href="/docs">Docs</Text>;          // ✅ href allowed because as="a"
// <Text as="button" href="/x">Bad</Text>;      // ❌ href not valid on button
```

### How do you type API responses safely? Why isn't `fetch<T>()` enough? 🔥

`const data = (await res.json()) as User` is a **lie to the compiler**. If the backend changes, you get runtime crashes far away from the cause. At trust boundaries, **validate at runtime** and **derive the static type from the schema**: zod, valibot or ArkType (`z.infer<typeof Schema>`), or generated types from OpenAPI or GraphQL.

```ts
// A tiny schema validator showing the idea behind zod's z.infer
type Validator<T> = { parse: (x: unknown) => T };
type Infer<V> = V extends Validator<infer T> ? T : never;

const str: Validator<string> = { parse: (x) => { if (typeof x !== 'string') throw new TypeError('expected string'); return x; } };
const num: Validator<number> = { parse: (x) => { if (typeof x !== 'number') throw new TypeError('expected number'); return x; } };
const object = <S extends Record<string, Validator<any>>>(shape: S): Validator<{ [K in keyof S]: Infer<S[K]> }> => ({
  parse(x) {
    if (typeof x !== 'object' || x === null) throw new TypeError('expected object');
    const out: any = {};
    for (const key in shape) {
      try { out[key] = shape[key].parse((x as any)[key]); }
      catch (e) { throw new TypeError(`${key}: ${(e as Error).message}`); }
    }
    return out;
  },
});

const UserSchema = object({ id: str, name: str, age: num });
type User = Infer<typeof UserSchema>;            // { id: string; name: string; age: number }

const ok: User = UserSchema.parse(JSON.parse('{"id":"1","name":"Zaki","age":30}'));
console.log(ok);

test('rejects bad payloads with a useful path', () => {
  expect(() => UserSchema.parse({ id: '1', name: 'x', age: '30' })).toThrow('age: expected number');
});
```

### How do you type Redux Toolkit (RootState, AppDispatch, typed hooks)?

```tsx
// store.ts
export const store = configureStore({ reducer: { participants: participantsReducer, recording: recordingReducer } });
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// hooks.ts — use these everywhere instead of plain useDispatch/useSelector
import { useDispatch, useSelector } from 'react-redux';
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

// slice.ts
const participantsSlice = createSlice({
  name: 'participants',
  initialState: {} as Record<string, Participant>,
  reducers: {
    joined(state, action: PayloadAction<Participant>) { state[action.payload.id] = action.payload; }, // Immer
  },
});
```

`.withTypes<>()` exists in React-Redux 9+. Older code used `TypedUseSelectorHook<RootState>`.

## Configuration & tooling

### Which `tsconfig` options matter most? 🔥

| Option | Why |
|---|---|
| `"strict": true` | Enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`, `useUnknownInCatchVariables`, `alwaysStrict` and more. **Non-negotiable for new code.** |
| `noUncheckedIndexedAccess` | `arr[i]` and `record[key]` become `T \| undefined`. Catches real bugs in lookups. |
| `exactOptionalPropertyTypes` | `{ a?: string }` no longer accepts `{ a: undefined }` explicitly |
| `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noUnusedLocals/Parameters` | Hygiene |
| `"moduleResolution": "bundler"` | Matches Vite/webpack resolution (package `exports`, no extension needed) |
| `isolatedModules` | Each file must be transpilable on its own. **Required** for esbuild/SWC/Babel/sucrase, which strip types per file without type checking. |
| `skipLibCheck` | Skip type-checking `.d.ts` in `node_modules` (faster builds) |
| `"jsx": "react-jsx"` | New JSX transform (no `import React` needed) |
| `paths` / `baseUrl` | Import aliases (`@/components`). Configure the bundler to match. |
| `verbatimModuleSyntax` | Forces `import type` for type-only imports, so transpilers drop them predictably |

**Important:** Vite (esbuild/Rolldown) **doesn't type-check**. It only strips types. Run `tsc --noEmit` (or `tsc -b`) in CI and in your editor.

### What are declaration files (`.d.ts`), `declare module` and module augmentation?

- **`.d.ts`** files describe types for JS code. Libraries ship them, or they come from **DefinitelyTyped** (`@types/xyz`).
- **`declare module 'untyped-lib' { … }`** declares types for a module without types. A **wildcard** handles asset imports: `declare module '*.svg' { const src: string; export default src; }`.
- **Module augmentation** adds to existing types: `declare module 'express-serve-static-core' { interface Request { user?: User } }`.
- **Global augmentation:** `declare global { interface Window { analytics: Analytics } }` (inside a module file, which needs at least one `export {}`).

```tstype
// types/lib-jitsi-meet.d.ts — typing a JS library you consume
declare module 'lib-jitsi-meet' {
  export interface JitsiConference {
    join(password?: string): void;
    on(event: string, listener: (...args: any[]) => void): void;
    getParticipants(): Array<{ getId(): string; getDisplayName(): string }>;
  }
  const JitsiMeetJS: {
    init(options?: object): void;
    JitsiConnection: new (appId: string | null, token: string | null, options: object) => unknown;
    events: Record<string, Record<string, string>>;
  };
  export default JitsiMeetJS;
}
```

### What's new in TypeScript 5.x (and 7)? 🔥

| Version | Feature |
|---|---|
| 5.0 | **Standard ECMAScript decorators**, `const` type parameters (`<const T>` infers literal types), `--moduleResolution bundler`, `--verbatimModuleSyntax` |
| 5.2 | **`using` declarations** (explicit resource management: `Symbol.dispose`), decorator metadata |
| 5.3 / 5.4 | Import attributes; **`NoInfer<T>`** utility; better narrowing in closures after the last assignment |
| 5.5 | **Inferred type predicates** (`filter(x => x !== undefined)` narrows), regex syntax checking, `isolatedDeclarations` |
| 5.6 – 5.8 | Disallowed always-truthy/nullish checks, iterator helper types, `--erasableSyntaxOnly`, better return-type checks for conditional expressions |
| **7.0** | The **native TypeScript compiler** (the Go port, "Project Corsa"), with roughly 10× faster type-checking and builds and the same type system. 6.0 was the bridge release that deprecated legacy options. |

```ts
// `using`: automatic cleanup at the end of the scope (TS 5.2+, needs Symbol.dispose at runtime)
const dispose: symbol = (Symbol as any).dispose ?? Symbol.for('Symbol.dispose');
function openTrack(name: string) {
  console.log(`open ${name}`);
  return { name, [dispose]() { console.log(`stop ${name}`); } };
}
// With TS 5.2+: `using track = openTrack('camera');` calls track[Symbol.dispose]() automatically.
// Equivalent manual version:
const track = openTrack('camera');
try { console.log(`using ${track.name}`); } finally { (track as any)[dispose](); }

// const type parameter: literal inference without `as const` at the call site
function tuple<const T extends readonly unknown[]>(...xs: T) { return xs; }
const t = tuple('host', 1, true);   // type: readonly ['host', 1, true]
console.log(t);
```
