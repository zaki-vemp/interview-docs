# JavaScript Core (Advanced)

Senior frontend interviews almost always start with core JavaScript. Interviewers don't want definitions alone; they want the **mechanism** (how the engine resolves `this`, how the prototype chain is walked, what a closure keeps alive) and **practical consequences** (bugs you've seen, patterns you use).

> Every `JavaScript` block has a **▶ Run** button that opens it in the floating playground. Change the code and re-run it, because experimenting is the fastest way to make this stick. The playground runs code as a classic script (like a `<script>` tag), so `var` at the top level creates a global and sloppy-mode `this` rules apply.

## Types, values & coercion

### What are the data types in JavaScript? 🔥

There are **8 types**: **7 primitives** and **Object**.

| Primitive | Example | `typeof` |
|---|---|---|
| `undefined` | `let x;` | `'undefined'` |
| `null` | `null` | `'object'` ← historical bug, kept for compatibility |
| `boolean` | `true` | `'boolean'` |
| `number` | `42`, `NaN`, `Infinity` (IEEE-754 double) | `'number'` |
| `bigint` | `9007199254740993n` | `'bigint'` |
| `string` | `'hi'` (immutable UTF-16 code units) | `'string'` |
| `symbol` | `Symbol('id')` | `'symbol'` |

Everything else is an **object**: arrays, functions (`typeof` gives `'function'`, but they are callable objects), dates, maps, regexes and so on.

**Primitives are immutable and compared by value. Objects are compared by reference.** When you "modify" a string, you get a new string.

```js
console.log(typeof null, typeof [], typeof function () {}, typeof NaN, typeof 10n, typeof Symbol());

const s = 'hello';
s[0] = 'J';            // silently ignored (throws in strict mode)
console.log(s);        // 'hello'

console.log({} === {}, [1] === [1]);          // different references
const a = { n: 1 }; const b = a; b.n = 2;
console.log(a.n);                              // 2 — same object

test('typeof quirks', () => {
  expect(typeof null).toBe('object');
  expect(Array.isArray([])).toBe(true);
  expect(typeof NaN).toBe('number');
});
```

**Follow-up — how do you reliably check types?**

- `Array.isArray(x)` for arrays. It works across iframes/realms, where `instanceof Array` fails.
- `x === null` for null.
- `Number.isNaN(x)` instead of the global `isNaN`, which coerces first, so `isNaN('abc')` is `true`.
- `Object.prototype.toString.call(x)` gives `'[object Date]'`, `'[object Map]'` and so on.

### Explain `==` vs `===` vs `Object.is` 🔥

- `===` (**strict equality**) has no type coercion. If the types differ, the result is `false`. Special cases: `NaN !== NaN`, and `+0 === -0`.
- `==` (**loose equality**) applies the *Abstract Equality* algorithm, which coerces:
  - `null == undefined` is `true`, and neither equals anything else (`null == 0` is `false`).
  - Number vs String → the string is converted to a number.
  - Boolean vs anything → the boolean is converted to a number first (`true` → 1).
  - Object vs primitive → the object goes through `ToPrimitive` (`valueOf` / `toString` / `Symbol.toPrimitive`).
- `Object.is` (**SameValue**) works like `===` except `Object.is(NaN, NaN)` is `true` and `Object.is(0, -0)` is `false`. React uses it to compare state and dependency values.

```js
console.log(null == undefined, null == 0, null >= 0);   // true false true (!)
console.log('' == 0, '0' == 0, '' == '0');               // true true false (not transitive)
console.log(true == '1', [] == false, [] == ![]);        // true true true
console.log(NaN === NaN, Object.is(NaN, NaN));           // false true
console.log(0 === -0, Object.is(0, -0));                 // true false

test('equality edge cases', () => {
  expect(null == 0).toBe(false);
  expect(null >= 0).toBe(true); // relational operators convert null to 0
  expect([] == ![]).toBe(true); // ![] is false -> 0; [] -> '' -> 0
});
```

**Why `null >= 0` is `true` but `null == 0` is `false`:** relational comparisons (`>=`) convert `null` to a number (0), but `==` has a special rule where `null` only equals `undefined`.

**Rule to state in interviews:** "I use `===` everywhere. The one idiom I allow is `x == null`, which checks for both `null` and `undefined` in one go."

### What are truthy and falsy values?

The falsy values are: `false`, `0`, `-0`, `0n`, `''` (empty string), `null`, `undefined`, `NaN`, plus the legacy oddity `document.all` in browsers. **Everything else is truthy**, including `'0'`, `'false'`, `[]`, `{}`, `new Boolean(false)` and `function(){}`.

```js
const values = [0, -0, 0n, '', null, undefined, NaN, '0', 'false', [], {}, new Boolean(false)];
console.table(values.map((v) => ({ value: String(v), truthy: !!v })));
```

**Common bug:** `if (count)` treats `0` as "missing". Use `count != null` or `??` when 0 is a valid value.

### What's the difference between `||`, `??` and `?.`? 🔥

- `a || b` returns `b` if `a` is **falsy** (so `0`, `''` and `false` fall through).
- `a ?? b` returns `b` only if `a` is **null or undefined** (*nullish*). Use it for defaults where 0 or `''` are valid.
- `a?.b` returns `undefined` instead of throwing when `a` is nullish. It **short-circuits** the rest of the chain. `a?.b()`, `a?.[key]` and `fn?.()` also exist.
- Logical assignment: `a ||= b`, `a &&= b`, `a ??= b` (`??=` assigns only if `a` is nullish).

```js
const settings = { volume: 0, theme: '' };
console.log(settings.volume || 50, settings.volume ?? 50);  // 50 0
console.log(settings.theme || 'dark', settings.theme ?? 'dark'); // 'dark' ''

const user = { profile: null };
console.log(user.profile?.name, user.getName?.());          // undefined undefined

const cache = {};
(cache.items ??= []).push('x');
console.log(cache);

test('?? keeps 0', () => {
  expect(settings.volume ?? 50).toBe(0);
  expect(user.profile?.address?.city).toBeUndefined();
});
```

You can't mix `??` with `||` or `&&` without parentheses (`a || b ?? c` is a SyntaxError).

### Why does `0.1 + 0.2 !== 0.3`? How do you handle money and large integers? 🔥

Numbers are **IEEE-754 double-precision** floats. Many decimal fractions (0.1, 0.2) have no exact binary representation, so you get `0.30000000000000004`.

- **Compare floats** with a tolerance: `Math.abs(a - b) < Number.EPSILON` (scale the tolerance for larger magnitudes).
- **Money:** store **integer minor units** (paise or cents), or use a decimal library. Format with `Intl.NumberFormat`.
- **Safe integers** only go up to `Number.MAX_SAFE_INTEGER` = 2^53 − 1 = 9007199254740991. Beyond that, integers lose precision; use **BigInt** (`123n`). You can't mix BigInt and Number in arithmetic without explicit conversion.
- IDs from APIs (e.g. 64-bit database IDs) should be sent as **strings** to avoid silent precision loss in `JSON.parse`.

```js
console.log(0.1 + 0.2, 0.1 + 0.2 === 0.3);
console.log(Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON);
console.log(Number.MAX_SAFE_INTEGER, 2 ** 53 === 2 ** 53 + 1); // true!  precision lost
console.log(2n ** 64n);
console.log(new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(123456.5));

const toPaise = (rupees) => Math.round(rupees * 100);
test('money in minor units', () => {
  expect(toPaise(0.1) + toPaise(0.2)).toBe(toPaise(0.3));
  expect(() => 1n + 1).toThrow(TypeError);
});
```

### How does type conversion work with `+`, and what is `ToPrimitive`? 🔥

- **Binary `+`:** convert both operands to primitives. If **either is a string**, concatenate; otherwise convert both to numbers and add.
- **Other arithmetic operators** (`-`, `*`, `/`) always convert to numbers.
- **`ToPrimitive(obj, hint)`:**
  1. If the object has `[Symbol.toPrimitive]`, call it with the hint `'number'`, `'string'` or `'default'`.
  2. Otherwise, for hint `'string'`, try `toString()` then `valueOf()`. For `'number'` or `'default'`, try `valueOf()` then `toString()`.
  3. Use the first one that returns a primitive.
  - Arrays: `valueOf()` returns the array itself (not primitive), so `toString()` is used → `[1,2].toString()` is `'1,2'`.
  - Plain objects: `toString()` gives `'[object Object]'`.

```js
console.log(1 + '2', '3' - 1, '3' * '4', true + 1, [] + [], [] + {}, [1, 2] + [3]);
console.log(+'', +' 12 ', +'1e3', +'12px', +[], +[5], +[1, 2], +{}, +null, +undefined);

const price = {
  [Symbol.toPrimitive](hint) {
    return hint === 'number' ? 99 : hint === 'string' ? '₹99' : 'default:99';
  },
};
console.log(+price, `${price}`, price + '');   // 99 '₹99' 'default:99'

test('ToPrimitive', () => {
  expect([] + []).toBe('');
  expect([1, 2] + [3]).toBe('1,23');
  expect(+[]).toBe(0);
  expect(Number.isNaN(+{})).toBe(true);
});
```

### What is the difference between `null` and `undefined`?

- `undefined` means "**no value assigned yet**". It's the default for uninitialised variables, missing properties, missing arguments, and functions without a `return`.
- `null` is an **intentional "no value"**, assigned by the programmer.
- `typeof undefined` is `'undefined'` and `typeof null` is `'object'`. `null == undefined` is `true`; `===` is `false`.
- `JSON.stringify` **omits** properties whose value is `undefined` (inside arrays they become `null`), but keeps `null`.
- **Default parameters** apply only for `undefined`, not `null`: `f(null)` keeps `null`.

```js
function greet(name = 'Guest') { return `Hi ${name}`; }
console.log(greet(undefined), greet(null));
console.log(JSON.stringify({ a: undefined, b: null, c: [undefined, null] }));
```

## Scope, hoisting & closures

### Explain `var`, `let` and `const`, and the Temporal Dead Zone 🔥

| | `var` | `let` | `const` |
|---|---|---|---|
| Scope | **Function** (or global) | **Block** `{}` | Block |
| Hoisted? | Yes, initialised to `undefined` | Yes, but **uninitialised (TDZ)** | Yes, TDZ |
| Re-declare in same scope | Allowed | SyntaxError | SyntaxError |
| Re-assign | Yes | Yes | **No** (but object contents can mutate) |
| Global property? | Top-level `var` creates `window.x` | No | No |

**TDZ (Temporal Dead Zone):** from the start of the block until the declaration line runs, the binding exists but **accessing it throws `ReferenceError`**. This catches use-before-declare bugs that `var` silently allows (it gives `undefined`).

```js
console.log(typeof hoistedVar, hoistedVar); // 'undefined' undefined
var hoistedVar = 1;

try {
  console.log(blockScoped);                 // TDZ
} catch (e) {
  console.log(e.name + ': ' + e.message);
}
let blockScoped = 2;

const config = { debug: false };
config.debug = true;                        // allowed: the binding is constant, not the object
console.log(config);

{
  var leaks = 'function-scoped';
  let stays = 'block-scoped';
}
console.log(leaks, typeof stays);

test('TDZ throws ReferenceError', () => {
  expect(() => { tdz; let tdz = 1; }).toThrow(ReferenceError);
});
```

**TDZ subtlety:** `typeof` is normally safe on undeclared variables (it gives `'undefined'`), but it **throws** inside the TDZ.

### What is hoisting? How do function declarations, expressions and classes differ? 🔥

Before executing a scope, the engine sets up all declarations in it (the "creation phase"):

- **Function declarations** are hoisted **with their body**, so you can call them before the line where they appear.
- **`var`** is hoisted and initialised to `undefined`.
- **`let`/`const`/`class`** are hoisted but stay **uninitialised** (TDZ).
- **Function expressions** (`const f = function () {}`) and **arrow functions** follow the rules of the variable they're assigned to.

```js
console.log(declared());          // works
function declared() { return 'declaration hoisted with body'; }

try { expressed(); } catch (e) { console.log(e.name, '-', e.message); }
var expressed = function () { return 'never reached'; };

try { new Animal(); } catch (e) { console.log(e.name, '-', e.message); }
class Animal {}

// Inside a function, a function declaration is hoisted to the top of that function:
function outer() {
  return inner();
  function inner() { return 'inner hoisted'; }
}
console.log(outer());
```

### What is a closure? Give real use cases 🔥

A **closure** is a function together with a reference to the **lexical environment** where it was created. The function can access variables from outer scopes **even after the outer function has returned**. Every function in JS forms a closure; it only becomes interesting when the function **outlives** its outer scope (returned, stored as a callback, passed around).

**Use cases:**

- **Private state / encapsulation** (the module pattern, counters)
- **Function factories** and partial application
- **Memoisation caches**
- **Event handlers and callbacks** that remember context
- **React hooks**, where every render's handlers close over that render's props and state
- **once**, **debounce** and **throttle** implementations

```js
function createCounter(start = 0) {
  let count = start;                    // private — no outside access
  return {
    increment: () => ++count,
    decrement: () => --count,
    get value() { return count; },
  };
}
const c = createCounter(5);
c.increment(); c.increment(); c.decrement();
console.log(c.value, c.count);          // 6 undefined

function memoize(fn) {
  const cache = new Map();              // lives as long as the returned function
  return (n) => {
    if (!cache.has(n)) cache.set(n, fn(n));
    return cache.get(n);
  };
}
let calls = 0;
const slowSquare = (n) => { calls++; return n * n; };
const fastSquare = memoize(slowSquare);
fastSquare(9); fastSquare(9); fastSquare(9);
console.log('underlying calls:', calls);

test('closure keeps private state', () => {
  const k = createCounter();
  k.increment();
  expect(k.value).toBe(1);
  expect(calls).toBe(1);
});
```

**Closures keep the variable, not a snapshot of its value.** If the variable changes later, the closure sees the new value. This explains both the loop bug below and React's stale-closure bugs, where a callback captured an *old render's* variables.

### Explain the classic `for` loop with `setTimeout` closure bug 🔥

```js
const out = [];
for (var i = 0; i < 3; i++) {
  setTimeout(() => out.push(`var:${i}`), 0);       // one shared i (function-scoped)
}
for (let j = 0; j < 3; j++) {
  setTimeout(() => out.push(`let:${j}`), 0);       // a fresh j per iteration
}
for (var k = 0; k < 3; k++) {
  ((k) => setTimeout(() => out.push(`iife:${k}`), 0))(k); // pre-ES6 fix: IIFE parameter
}
setTimeout(() => console.log(out.join(' ')), 10);

test('var shares one binding, let creates one per iteration', async () => {
  await new Promise((r) => setTimeout(r, 20));
  expect(out.slice(0, 3)).toEqual(['var:3', 'var:3', 'var:3']);
  expect(out.slice(3, 6)).toEqual(['let:0', 'let:1', 'let:2']);
});
```

**Why:** with `var`, there's **one** `i` for the whole function, and by the time the callbacks run the loop has finished with `i === 3`. With `let`, the spec creates a **new binding for each iteration** (copying the value forward), so each callback closes over its own `j`. Other fixes: an IIFE, `forEach`, or passing `i` as a `setTimeout` argument (`setTimeout(fn, 0, i)`).

### What is lexical scope and the scope chain?

**Lexical (static) scope** means a variable's scope is determined by **where code is written**, not where it's called from. When resolving an identifier, the engine checks the current scope, then the enclosing scope, and so on up to the global scope. This is the **scope chain**. If the name isn't found anywhere, it throws `ReferenceError` (or, in sloppy mode, an *assignment* creates an accidental global).

```js
const x = 'global';
function printX() { console.log(x); }          // resolved where printX is DEFINED
function caller() { const x = 'caller'; printX(); }
caller();                                       // 'global', not 'caller'
```

`this` is the exception: it's determined by **how a function is called**. That's the next section.

### Can closures cause memory leaks? How?

A closure keeps its **entire captured environment reachable** while the closure itself is reachable. Leaks happen when a long-lived closure (an event listener, an interval, a cache, a global callback registry) captures large objects that are no longer needed.

- An `setInterval` callback that captures a big data array, never cleared.
- Event listeners added in a component and never removed (React: forgetting the cleanup function in `useEffect`).
- Caches (`Map`) keyed by objects that never get evicted. Use a `WeakMap` when the key's lifetime should control the entry.

Fixes: clean up timers and listeners, null out references, use `WeakMap`/`WeakRef`, and keep closures small. Find leaks with Chrome DevTools heap snapshots (look for detached DOM nodes and growing retained sizes).

### What is an IIFE and the module pattern? Are they still relevant?

An **IIFE** (Immediately Invoked Function Expression), `(function () { … })()`, creates a private scope. Before ES modules, the **module pattern** used one to expose a public API while hiding internals:

```js
const Store = (function () {
  const items = [];                 // private
  function add(x) { items.push(x); return api; }
  function size() { return items.length; }
  const api = { add, size };
  return api;
})();
Store.add('a').add('b');
console.log(Store.size(), Store.items);   // 2 undefined
```

Today, **ES modules** give file-level scope natively, and block scope (`{ let x }`) covers most other cases. IIFEs still appear in bundler output, in async IIFEs where top-level `await` isn't available, and in legacy code.

## `this`, call, apply & bind

### How is the value of `this` determined? 🔥

`this` is set **at call time**, based on **how** the function is called. Rules in order of precedence:

1. **`new` binding:** `new Fn()` → `this` is the newly created object.
2. **Explicit binding:** `fn.call(obj)`, `fn.apply(obj)`, `fn.bind(obj)` → `this` is `obj`. A bound function can't be re-bound, except by `new`.
3. **Implicit binding:** `obj.method()` → `this` is `obj`, the object **before the dot at call time**.
4. **Default binding:** a plain call `fn()` → `undefined` in **strict mode** (modules, classes), or `globalThis` in sloppy mode.

**Arrow functions** have **no own `this`**. They use `this` from the enclosing lexical scope, fixed when the arrow is created. `call`, `apply` and `bind` can't change it.

```js
'use strict';
const user = {
  name: 'Zaki',
  regular() { return this?.name; },
  arrow: () => typeof this,                 // `this` of the enclosing scope (script top level)
  delayed() {
    return [
      (() => this.name)(),                  // arrow inherits `this` from delayed()
      (function () { return this; })(),     // plain call in strict mode -> undefined
    ];
  },
};

console.log(user.regular());               // 'Zaki' (implicit)
const extracted = user.regular;
console.log(extracted());                  // undefined (default binding, strict)
console.log(extracted.call({ name: 'Call' }));
console.log(user.delayed());

function Person(name) { this.name = name; }
const p = new Person('New');
console.log(p.name);

test('bind is permanent; new overrides bind', () => {
  function who() { return this && this.name; }
  const bound = who.bind({ name: 'A' });
  expect(bound.call({ name: 'B' })).toBe('A');
  function Ctor(name) { this.name = name; }
  const BoundCtor = Ctor.bind({ name: 'ignored' });
  expect(new BoundCtor('made').name).toBe('made');
});
```

### What's the difference between `call`, `apply` and `bind`? 🔥

- `fn.call(thisArg, a, b)` **invokes now** with arguments listed individually.
- `fn.apply(thisArg, [a, b])` **invokes now** with arguments as an array. Classic use: `Math.max.apply(null, arr)`; today you'd write `Math.max(...arr)`.
- `fn.bind(thisArg, a)` **returns a new function** with `this` permanently bound and optional **pre-filled arguments** (partial application). It doesn't invoke.

```js
function introduce(greeting, punctuation) {
  return `${greeting}, I'm ${this.name}${punctuation}`;
}
const me = { name: 'Syed' };
console.log(introduce.call(me, 'Hello', '!'));
console.log(introduce.apply(me, ['Hi', '.']));
const hey = introduce.bind(me, 'Hey');      // partially applied
console.log(hey('?'));

// Borrowing methods
const arrayLike = { 0: 'a', 1: 'b', length: 2 };
console.log(Array.prototype.map.call(arrayLike, (s) => s.toUpperCase()));
```

(Implementing `bind`, `call` and `apply` from scratch is covered in **Machine Coding & Polyfills**.)

### Why do we "lose `this`" in callbacks and how do you fix it? 🔥

Passing `obj.method` as a callback passes **only the function**. When it's later called as `callback()`, the implicit binding is lost.

```js
class Timer {
  constructor() { this.ticks = 0; }
  tick() { this.ticks++; }
  // Class field with an arrow: `this` is bound per instance at construction
  tickArrow = () => { this.ticks++; };
}
const t = new Timer();
const run = (cb) => cb();

try { run(t.tick); } catch (e) { console.log('lost this ->', e.constructor.name, e.message); }
run(t.tick.bind(t));          // fix 1: bind
run(() => t.tick());          // fix 2: wrap in an arrow
run(t.tickArrow);             // fix 3: arrow class field
console.log(t.ticks);         // 3
```

Class bodies are always in **strict mode**, so the lost `this` is `undefined` and `this.ticks++` throws a `TypeError`.

**React relevance:** class components needed `this.handleClick = this.handleClick.bind(this)` or arrow class fields. Function components avoid `this` entirely.

### How do arrow functions differ from regular functions? 🔥

| | Regular function | Arrow function |
|---|---|---|
| `this` | Dynamic (call site) | **Lexical** (enclosing scope), can't be changed |
| `arguments` | Has its own | None (uses the outer one; use rest params `...args`) |
| `new` | Can be a constructor (has `prototype`) | **TypeError** (not constructible, no `prototype`) |
| `super`, `new.target` | Own | Lexical |
| Methods | Good as object methods | Bad as object methods that need `this` |
| Syntax | `function f() {}` | `(x) => x * 2` (implicit return) |

```js
const Arrow = () => {};
console.log(typeof Arrow.prototype);          // 'undefined'
try { new Arrow(); } catch (e) { console.log(e.message); }

function regular() { return arguments.length; }
const arrowArgs = (...args) => args.length;
console.log(regular(1, 2, 3), arrowArgs(1, 2, 3));

// returning an object literal needs parentheses
const make = (id) => ({ id });
console.log(make(7));
```

## Prototypes, `new` & classes

### Explain prototypal inheritance and the prototype chain 🔥

Every object has an internal link, **`[[Prototype]]`**, to another object (or `null`). When you read a property:

1. The engine checks the object's **own** properties.
2. If it isn't found, it follows `[[Prototype]]` and checks that object.
3. It repeats until the property is found or the chain ends at `null` (result: `undefined`).

**Writes** don't walk the chain: assignment creates or updates an **own** property, *shadowing* the inherited one. The exception is a setter, or a non-writable property, on the chain.

- `obj.__proto__` (legacy accessor) and `Object.getPrototypeOf(obj)` (preferred) read an object's `[[Prototype]]`.
- `Fn.prototype` is a **property on functions**: the object that becomes the `[[Prototype]]` of instances created with `new Fn()`.
- `Object.create(proto)` creates an object with the given prototype; `Object.create(null)` creates one with **no prototype** (useful for dictionaries).

```js
const animal = {
  speak() { return `${this.name} makes a sound`; },
};
const dog = Object.create(animal);
dog.name = 'Rex';
dog.bark = function () { return 'Woof'; };

console.log(dog.speak());                                  // found on the prototype
console.log(Object.getPrototypeOf(dog) === animal);        // true
console.log(Object.hasOwn(dog, 'speak'), 'speak' in dog);  // false true

dog.speak = () => 'shadowed';                              // own property shadows the prototype's
console.log(dog.speak(), animal.speak.call(dog));

function Car(make) { this.make = make; }
Car.prototype.describe = function () { return `Car: ${this.make}`; };
const car = new Car('Tata');
console.log(car.describe(), Object.getPrototypeOf(car) === Car.prototype, Car.prototype.constructor === Car);

const dict = Object.create(null);
dict.toString = 'safe key';
console.log('toString' in {}, Object.getPrototypeOf(dict));

test('prototype chain lookup', () => {
  expect(Object.getPrototypeOf(Object.getPrototypeOf(car))).toBe(Object.prototype);
  expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
});
```

**Performance note:** methods on the prototype are **shared** by all instances (one copy in memory). Methods created inside the constructor (`this.fn = function(){}`) are duplicated per instance.

### What exactly does the `new` keyword do? Implement it 🔥

`new Fn(...args)`:

1. Creates a new empty object.
2. Sets its `[[Prototype]]` to `Fn.prototype`.
3. Calls `Fn` with `this` set to the new object.
4. If `Fn` returns an **object** (or function), that object is the result. Otherwise the new object is returned. Primitive return values are ignored.

```js
function myNew(Constructor, ...args) {
  if (typeof Constructor !== 'function') throw new TypeError('Constructor must be a function');
  const obj = Object.create(Constructor.prototype);
  const result = Constructor.apply(obj, args);
  return result !== null && (typeof result === 'object' || typeof result === 'function') ? result : obj;
}

function User(name) { this.name = name; }
User.prototype.hi = function () { return `hi ${this.name}`; };

function ReturnsObject() { this.a = 1; return { b: 2 }; }
function ReturnsPrimitive() { this.a = 1; return 42; }

const u = myNew(User, 'Zaki');
console.log(u.hi(), u instanceof User);
console.log(myNew(ReturnsObject), myNew(ReturnsPrimitive));

test('myNew matches new', () => {
  expect(myNew(User, 'x')).toEqual(new User('x'));
  expect(myNew(ReturnsObject)).toEqual(new ReturnsObject());
  expect(myNew(ReturnsPrimitive)).toEqual(new ReturnsPrimitive());
  expect(Object.getPrototypeOf(myNew(User, 'y'))).toBe(User.prototype);
});
```

### How does `instanceof` work? Can it be fooled?

`obj instanceof C` walks `obj`'s prototype chain looking for `C.prototype`. A class can customise this with `static [Symbol.hasInstance](x)`.

It can be fooled, or it can fail:

- **across realms** (iframes, Node `vm`): an array from an iframe isn't `instanceof Array` in the parent window, so use `Array.isArray`
- when someone changes the prototype with `Object.setPrototypeOf`
- with primitives: `'str' instanceof String` is `false`

```js
function myInstanceOf(obj, C) {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return false;
  let proto = Object.getPrototypeOf(obj);
  while (proto) {
    if (proto === C.prototype) return true;
    proto = Object.getPrototypeOf(proto);
  }
  return false;
}
class A {} class B extends A {}
console.log(myInstanceOf(new B(), A), myInstanceOf(new A(), B), myInstanceOf('s', String));

class Even { static [Symbol.hasInstance](n) { return n % 2 === 0; } }
console.log(4 instanceof Even, 3 instanceof Even);
```

### Are ES6 classes just syntactic sugar? What's different? 🔥

**Mostly** sugar over constructor functions and prototypes, with real differences:

- Class bodies run in **strict mode**.
- Classes are **not hoisted like functions**: they're in the TDZ until defined.
- Calling a class **without `new` throws** a `TypeError`.
- Methods are **non-enumerable** (they don't show up in `for…in`) and are **not constructible**.
- `extends` sets up **both** chains: instance prototypes and static inheritance (`Child.__proto__ === Parent`).
- In derived classes, `this` is **uninitialised until `super()`** is called, because the base constructor creates the object. That's what makes extending built-ins like `Array` and `Error` work properly.
- Things you can't do with constructor functions: **private fields and methods (`#x`)**, **static blocks**, class fields.

```js
class Shape {
  static count = 0;                  // static field
  #id;                               // private field (truly private, enforced by the engine)
  constructor(name) {
    this.name = name;
    this.#id = ++Shape.count;
  }
  get id() { return this.#id; }
  area() { return 0; }
  toString() { return `${this.name}#${this.#id} area=${this.area().toFixed(2)}`; }
  static isShape(x) { return #id in x; } // ergonomic brand check (ES2022)
}

class Circle extends Shape {
  constructor(r) {
    super('circle');                 // must come before using `this`
    this.r = r;
  }
  area() { return Math.PI * this.r ** 2; }
  toString() { return `(${super.toString()})`; }
}

const c = new Circle(2);
console.log(String(c), c.id, Shape.isShape(c), Shape.isShape({}));
console.log(Object.keys(c), 'area' in c, Object.keys(Circle.prototype));
try { Shape('x'); } catch (e) { console.log(e.message); }

test('class semantics', () => {
  expect(Object.getPrototypeOf(Circle)).toBe(Shape);           // static inheritance
  expect(c instanceof Shape).toBe(true);
  expect(Object.keys(Circle.prototype)).toEqual([]);           // methods are non-enumerable
});
```

### How do private fields (`#x`) compare to closures and WeakMaps for privacy?

| Technique | Truly private? | Per-instance memory | Notes |
|---|---|---|---|
| `_convention` | No | — | Just a naming convention |
| Closure in constructor | Yes | Methods duplicated per instance | Pre-ES2022 pattern |
| `WeakMap` keyed by instance | Yes (module-scoped) | Shared methods | Garbage-collected with the instance |
| `#private` fields | **Yes (engine-enforced)** | Shared methods | Accessing from outside is a **SyntaxError**. Not visible to `Object.keys`, JSON or Proxy |

Gotcha: private fields **don't work through a Proxy** (`proxy.#x` throws), because the proxy object doesn't have the private slot. This matters for libraries like Vue that wrap objects in proxies.

### What are property descriptors? What's the difference between freeze, seal and preventExtensions?

Each property has a descriptor:

- a **data** descriptor: `value`, `writable`, `enumerable`, `configurable`
- or an **accessor** descriptor: `get`, `set`, `enumerable`, `configurable`

`Object.defineProperty` defaults all flags to `false`. Normal assignment sets them to `true`.

| | Add props | Delete props | Change values | Reconfigure |
|---|---|---|---|---|
| `Object.preventExtensions` | ✗ | ✓ | ✓ | ✓ |
| `Object.seal` | ✗ | ✗ | ✓ | ✗ |
| `Object.freeze` | ✗ | ✗ | ✗ | ✗ |

All three are **shallow**: nested objects stay mutable. A deep freeze must recurse.

```js
'use strict';
const account = {};
Object.defineProperty(account, 'id', { value: 42, enumerable: false });
console.log(Object.getOwnPropertyDescriptor(account, 'id'), Object.keys(account));

const cfg = Object.freeze({ api: { url: '/v1' }, retries: 3 });
try { cfg.retries = 5; } catch (e) { console.log('frozen:', e.message); }
cfg.api.url = '/v2';                     // nested object is NOT frozen
console.log(cfg.api.url);

function deepFreeze(obj) {
  Object.values(obj).forEach((v) => v && typeof v === 'object' && !Object.isFrozen(v) && deepFreeze(v));
  return Object.freeze(obj);
}
const deep = deepFreeze({ a: { b: { c: 1 } } });
test('deepFreeze freezes nested objects', () => {
  expect(Object.isFrozen(deep.a.b)).toBe(true);
  expect(() => { deep.a.b.c = 2; }).toThrow(TypeError);
});
```

## Objects, arrays & copying

### Shallow copy vs deep copy: what are your options and their pitfalls? 🔥

- **Shallow copies** copy the top level only; nested objects are **shared**. Examples: `{ ...obj }`, `Object.assign({}, obj)`, `[...arr]`, `arr.slice()`, `Array.from(arr)`.
- **`structuredClone(value)`** (modern browsers, Node 17+) makes a **deep** copy. It supports Date, Map, Set, RegExp, ArrayBuffer, typed arrays, Error and **circular references**. It **throws** on functions and DOM nodes, and it **loses class prototypes** (instances come back as plain objects), getters/setters and symbol keys.
- **`JSON.parse(JSON.stringify(x))`** loses `undefined`, functions and symbols. Dates become strings. `NaN` and `Infinity` become `null`. Map and Set become `{}`. It **throws on circular references**.
- **Custom recursive clone** when you need class instances preserved (see Machine Coding).

```js
const original = {
  date: new Date('2025-01-01T00:00:00Z'),
  tags: new Set(['react']),
  nested: { n: 1 },
  missing: undefined,
};
original.self = original; // circular

const shallow = { ...original };
shallow.nested.n = 99;                       // affects original too!
console.log('shallow shares nested:', original.nested.n);

const deep = structuredClone(original);
deep.nested.n = 1;
console.log(deep.date instanceof Date, deep.tags.has('react'), deep.self === deep, original.nested.n);

try { JSON.stringify(original); } catch (e) { console.log('JSON fails:', e.message.split('\n')[0]); }
const { self, ...noCycle } = original;
console.log(JSON.parse(JSON.stringify(noCycle)));

class Point { constructor(x) { this.x = x; } norm() { return Math.abs(this.x); } }
const cloned = structuredClone(new Point(-3));
console.log(cloned instanceof Point, cloned);   // prototype is lost

test('structuredClone handles cycles but not functions', () => {
  expect(deep.self).toBe(deep);
  expect(() => structuredClone({ fn() {} })).toThrow();
});
```

### When should you use `Map` vs a plain object, and `Set` vs an array? 🔥

**Use a `Map` when:**

- keys are **not strings** (objects, numbers kept as numbers)
- you add or remove keys **frequently** (Maps are optimised for this)
- you need **insertion order** and a reliable `.size`
- keys could collide with prototype properties (`'__proto__'`, `'constructor'`)

**Use a plain object for** fixed-shape records, JSON-serialisable data and config.

**Use a `Set` for** uniqueness and **O(1) membership checks**. `arr.includes(x)` is O(n).

```js
const visits = new Map();
const userA = { id: 1 }; const userB = { id: 2 };
visits.set(userA, 3).set(userB, 1);
console.log(visits.get(userA), visits.size, [...visits.keys()].map((u) => u.id));

const obj = {};
obj[userA] = 'a'; obj[userB] = 'b';          // both keys become '[object Object]'!
console.log(Object.keys(obj), obj[userA]);

const unique = [...new Set([3, 1, 3, 2, 1])];
console.log(unique);

// ES2025 Set methods (modern browsers / Node 22+)
const a = new Set([1, 2, 3]); const b = new Set([2, 3, 4]);
if (typeof a.union === 'function') {
  console.log([...a.union(b)], [...a.intersection(b)], [...a.difference(b)], a.isSubsetOf(new Set([1, 2, 3, 4])));
}
```

### What are WeakMap, WeakSet, WeakRef and FinalizationRegistry used for?

- **`WeakMap`/`WeakSet`** hold keys **weakly**. If nothing else references a key object, it can be garbage-collected and the entry disappears. Keys must be objects (or non-registered symbols, since ES2023). They're **not iterable** and have no `.size`, because their contents depend on GC timing.
  - **Use cases:** attaching metadata or caches to objects you don't own (DOM nodes, library objects) without leaking memory; private data per instance; memoising by object identity.
- **`WeakRef`** is a weak reference to an object (`ref.deref()` returns the object or `undefined`). It's for caches of large objects.
- **`FinalizationRegistry`** runs a callback *sometime after* an object is collected.

Both are **non-deterministic**: never rely on them for program logic, only for optimisation.

```js
const metadata = new WeakMap();
function track(node) {
  metadata.set(node, { seenAt: Date.now() });
}
let el = { tag: 'div' };
track(el);
console.log(metadata.has(el));     // true
el = null;                         // the entry is now eligible for GC (we can't observe it)

const cache = new WeakMap();
function expensiveFor(obj) {
  if (!cache.has(obj)) cache.set(obj, Object.keys(obj).length * 1000);
  return cache.get(obj);
}
const k = { a: 1, b: 2 };
console.log(expensiveFor(k), expensiveFor(k));
```

### Which array methods mutate, and what are the ES2023 "change array by copy" methods? 🔥

**Mutating:** `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`.

**Non-mutating:** `map`, `filter`, `reduce`, `slice`, `concat`, `flat`, `flatMap`, `find`, `findLast`, `some`, `every`, `includes`, `at`, `join`, plus the **ES2023 copies**: `toSorted()`, `toReversed()`, `toSpliced()` and `with(index, value)`.

Mutation matters in **React and Redux**: sorting state in place (`state.items.sort()`) mutates the existing array, so React may not re-render and other code sees changed data. Use `toSorted()` or `[...arr].sort()`.

```js
const scores = [10, 1, 5, 100];
console.log(scores.toSorted(), scores.toSorted((a, b) => a - b), scores); // default sort is lexicographic!
console.log(scores.with(1, 42), scores.toReversed(), scores.toSpliced(1, 2), scores);
console.log(scores.at(-1), scores.findLast((n) => n < 50));

const nested = [1, [2, [3, [4]]]];
console.log(nested.flat(), nested.flat(Infinity));
console.log(['a b', 'c'].flatMap((s) => s.split(' ')));

test('toSorted does not mutate', () => {
  const arr = [3, 1, 2];
  const sorted = arr.toSorted((a, b) => a - b);
  expect(sorted).toEqual([1, 2, 3]);
  expect(arr).toEqual([3, 1, 2]);
  expect([10, 1, 5, 100].sort()).toEqual([1, 10, 100, 5]);
});
```

**Gotcha:** the default `sort()` converts elements to **strings**, so `[10, 1, 5, 100].sort()` gives `[1, 10, 100, 5]`. Always pass a comparator for numbers. Since ES2019, `sort` is guaranteed to be **stable**.

### Explain `reduce` with non-trivial examples

`arr.reduce((acc, item, index, array) => newAcc, initial)`. **Always pass an initial value.** Without one, the first element becomes the accumulator, and an empty array **throws** a `TypeError`.

```js
const orders = [
  { id: 1, city: 'Hyderabad', amount: 250 },
  { id: 2, city: 'Pune', amount: 100 },
  { id: 3, city: 'Hyderabad', amount: 400 },
];

const totalByCity = orders.reduce((acc, o) => {
  acc[o.city] = (acc[o.city] ?? 0) + o.amount;
  return acc;
}, {});

const byId = orders.reduce((acc, o) => acc.set(o.id, o), new Map());

const pipeline = [(x) => x + 1, (x) => x * 10, (x) => `#${x}`];
const run = (x) => pipeline.reduce((v, fn) => fn(v), x);

console.log(totalByCity, byId.get(3).city, run(4));

// ES2024: Object.groupBy / Map.groupBy
if (Object.groupBy) console.log(Object.groupBy(orders, (o) => (o.amount > 200 ? 'big' : 'small')));

test('reduce', () => {
  expect(totalByCity).toEqual({ Hyderabad: 650, Pune: 100 });
  expect(run(4)).toBe('#50');
  expect(() => [].reduce((a, b) => a + b)).toThrow(TypeError);
});
```

## Iterators, generators, Symbols & Proxy

### What are Symbols and well-known Symbols?

`Symbol('desc')` creates a **unique** primitive, useful as **collision-free property keys** (library metadata, "hidden" properties). Symbol keys are skipped by `for…in`, `Object.keys` and `JSON.stringify`. You can find them with `Object.getOwnPropertySymbols` or `Reflect.ownKeys`.

`Symbol.for('key')` uses a **global registry**, so the same key returns the same symbol everywhere.

**Well-known symbols** let you hook into language behaviour:

- `Symbol.iterator`: `for…of` and spread
- `Symbol.asyncIterator`: `for await…of`
- `Symbol.toPrimitive`: type conversion
- `Symbol.hasInstance`: `instanceof`
- `Symbol.toStringTag`: `Object.prototype.toString`

```js
const ID = Symbol('id');
const user = { name: 'Zaki', [ID]: 123 };
console.log(Object.keys(user), JSON.stringify(user), user[ID], Reflect.ownKeys(user));
console.log(Symbol('x') === Symbol('x'), Symbol.for('x') === Symbol.for('x'));

class Temperature {
  constructor(c) { this.c = c; }
  get [Symbol.toStringTag]() { return 'Temperature'; }
}
console.log(Object.prototype.toString.call(new Temperature(30)));
```

### Explain the iterator protocol and make a custom object iterable 🔥

- An **iterable** has a `[Symbol.iterator]()` method that returns an **iterator**.
- An **iterator** has a `next()` method that returns `{ value, done }`.
- `for…of`, spread (`...`), destructuring, `Array.from`, `Promise.all`, and `new Map()`/`new Set()` all consume iterables.

```js
class Range {
  constructor(start, end, step = 1) { Object.assign(this, { start, end, step }); }
  [Symbol.iterator]() {
    let current = this.start;
    const { end, step } = this;
    return {
      next: () => (current <= end ? { value: (current += step) - step, done: false } : { value: undefined, done: true }),
      [Symbol.iterator]() { return this; }, // iterators are usually iterable too
    };
  }
}

const r = new Range(1, 10, 3);
console.log([...r], Math.max(...r));
for (const n of new Range(0, 2)) console.log('for..of', n);
const [first, , third] = new Range(5, 100, 5);
console.log(first, third);

test('custom iterable', () => {
  expect(Array.from(new Range(1, 5, 2))).toEqual([1, 3, 5]);
});
```

### What are generators and when are they useful? 🔥

A **generator function** (`function*`) returns a **generator object**, which is both an iterator and an iterable. Execution **pauses at each `yield`** and resumes on the next `next()` call. That makes generators good for:

- **Lazy / infinite sequences** (values computed on demand)
- **Custom iterables** with far less code than a hand-written iterator
- **Two-way communication**: `next(value)` sends a value **into** the generator, which becomes the result of the paused `yield` expression
- **Control-flow libraries**: redux-saga is built on generators. `async/await` is conceptually generators plus promises.

```js
function* idGenerator(prefix = 'id') {
  let n = 0;
  while (true) yield `${prefix}-${++n}`;     // infinite, but lazy
}
const ids = idGenerator('user');
console.log(ids.next().value, ids.next().value);

function* take(iterable, n) {
  let i = 0;
  for (const v of iterable) {
    if (i++ >= n) return;
    yield v;
  }
}
function* map(iterable, fn) { for (const v of iterable) yield fn(v); }
console.log([...take(map(idGenerator('row'), (s) => s.toUpperCase()), 3)]);

function* conversation() {
  const name = yield 'What is your name?';
  const lang = yield `Hi ${name}! Favourite language?`;
  return `${name} likes ${lang}`;
}
const chat = conversation();
console.log(chat.next().value);           // first next() runs until the first yield
console.log(chat.next('Zaki').value);     // 'Zaki' becomes the result of the first yield
console.log(chat.next('TypeScript'));     // { value: ..., done: true }

test('generators are lazy', () => {
  expect([...take([10, 20, 30, 40], 2)]).toEqual([10, 20]);
});
```

**ES2025 iterator helpers** (`Iterator.prototype.map`, `filter`, `take`, `drop`, `toArray`…) bring lazy pipelines natively: `idGenerator().map(f).take(3).toArray()`.

### What is a Proxy? Give practical uses 🔥

A **Proxy** wraps an object and intercepts fundamental operations through **traps**: `get`, `set`, `has`, `deleteProperty`, `ownKeys`, `apply`, `construct` and others. **Reflect** provides the default behaviour for each trap (`Reflect.get(target, key, receiver)`), so you can add behaviour and then forward.

**Uses:**

- **Reactivity:** Vue 3's `reactive()` tracks reads in `get` and triggers updates in `set`. MobX and Immer also use proxies (Immer uses them to record "mutations" as a draft).
- **Validation** and **default values**
- **Negative array indexes**
- **Logging/observability**, API clients (`api.users.get()` building URLs)
- **Read-only views**

```js
function reactive(target, onChange) {
  return new Proxy(target, {
    get(t, key, receiver) {
      const value = Reflect.get(t, key, receiver);
      return value && typeof value === 'object' ? reactive(value, onChange) : value; // deep, lazily
    },
    set(t, key, value, receiver) {
      const old = t[key];
      const ok = Reflect.set(t, key, value, receiver);
      if (ok && old !== value) onChange(String(key), old, value);
      return ok;
    },
  });
}

const changes = [];
const state = reactive({ user: { name: 'A' }, count: 0 }, (k, o, n) => changes.push(`${k}: ${o} -> ${n}`));
state.count++;
state.user.name = 'B';
console.log(changes);

const withNegativeIndex = (arr) =>
  new Proxy(arr, { get: (t, k, r) => Reflect.get(t, typeof k === 'string' && /^-\d+$/.test(k) ? t.length + Number(k) : k, r) });
const letters = withNegativeIndex(['a', 'b', 'c']);
console.log(letters[-1], letters.length);

const strictUser = new Proxy({}, {
  set(t, k, v) {
    if (k === 'age' && (!Number.isInteger(v) || v < 0)) throw new TypeError('age must be a non-negative integer');
    t[k] = v;
    return true;
  },
});
try { strictUser.age = -5; } catch (e) { console.log(e.message); }

test('reactive proxy reports nested changes', () => {
  expect(changes).toEqual(['count: 0 -> 1', 'name: A -> B']);
});
```

### What are tagged template literals?

A **tag function** receives the template's **string parts** (an array that also has `.raw`) and the **interpolated values** separately. Uses:

- **safe HTML escaping** and SQL parameterisation
- `styled-components`, `graphql-tag`, `lit-html`
- i18n
- `String.raw`

```js
function safeHtml(strings, ...values) {
  const escape = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  return strings.reduce((out, s, i) => out + s + (i < values.length ? escape(values[i]) : ''), '');
}
const name = '<img src=x onerror=alert(1)>';
console.log(safeHtml`<p>Hello ${name}!</p>`);
console.log(String.raw`C:\new\table`);
```

## Modules, strict mode & memory

### ES Modules vs CommonJS: what are the differences? 🔥

| | ES Modules (`import`/`export`) | CommonJS (`require`/`module.exports`) |
|---|---|---|
| Loading | **Static** structure, analysed before execution; asynchronous loading | Dynamic, **synchronous** `require()` at runtime |
| Bindings | **Live bindings** (importers see updates to exported `let`) | **Copies** of the exported value at require time (for primitives) |
| Tree shaking | Yes (bundlers can drop unused exports) | Hard (dynamic) |
| Top-level `await` | Yes | No |
| `this` at top level | `undefined` | `module.exports` |
| Strict mode | Always | Opt-in |
| Conditional/dynamic import | `import()` returns a promise | `require()` anywhere |
| File/extension in Node | `.mjs`, or `"type": "module"` | `.cjs`, or the default |

**Interop:** ESM can import CJS (as a default export). Node 22+ can `require()` synchronous ESM graphs. Older Node needed `import()` for that.

**Circular dependencies:** in CJS you get a **partially filled `exports` object**. In ESM, live bindings may be in the TDZ, which throws a `ReferenceError` if accessed too early.

### What does `'use strict'` change?

- Assigning to an **undeclared variable throws** instead of creating a global.
- `this` in plain function calls is **`undefined`** instead of `globalThis`.
- Assigning to read-only or non-writable properties, or adding properties to frozen objects, **throws** instead of failing silently.
- **Duplicate parameter names** and **octal literals** (`010`) are SyntaxErrors. `with` is forbidden, and `eval` gets its own scope.
- `arguments` doesn't alias named parameters.
- **ES modules and class bodies are always strict.**

```js
function sloppy() { return this === globalThis; }
function strict() { 'use strict'; return this; }
console.log(sloppy(), strict());

try {
  (function () { 'use strict'; undeclared = 1; })();
} catch (e) { console.log(e.name, e.message); }
```

### How does garbage collection work in JavaScript, and what causes memory leaks? 🔥

- Engines use **reachability**. Objects reachable from the **roots** (globals, the current call stack, closures still referenced, active handles) are kept; everything else is garbage.
- V8 uses a **generational** collector:
  - The **young generation** (*Scavenger*, a copying collector) is collected frequently and cheaply. Most objects die young.
  - The **old generation** uses **mark-sweep-compact**, with **incremental and concurrent** marking to avoid long pauses.
- Reference cycles are **not** a problem for mark-and-sweep. Only *reachability* matters.

**Common leaks in frontend apps:**

1. **Forgotten timers and intervals** that capture state.
2. **Event listeners** never removed: `window.addEventListener` inside a component without cleanup.
3. **Detached DOM nodes** still referenced from JS (caches, closures).
4. **Unbounded caches**/Maps keyed by objects. Use `WeakMap` or an LRU with a limit.
5. **Subscriptions** (WebSocket handlers, store subscriptions, RxJS) not unsubscribed.
6. **Accidental globals** (sloppy-mode assignments).
7. In WebRTC apps: **MediaStream tracks** not stopped, `RTCPeerConnection`s not closed, `AudioContext`s not closed.

**Finding leaks:** Chrome DevTools → Memory → take heap snapshots before and after an action, repeated several times, then compare; filter by "Detached". Use the Performance monitor (JS heap size, DOM nodes, listeners), the Allocation timeline, and `performance.memory` (Chrome only).

### What's new in recent ECMAScript versions (2020–2025)? 🔥

| Year | Highlights you should be able to explain |
|---|---|
| **ES2020** | Optional chaining `?.`, nullish coalescing `??`, `BigInt`, `Promise.allSettled`, `globalThis`, dynamic `import()`, `String.prototype.matchAll` |
| **ES2021** | `String.prototype.replaceAll`, `Promise.any` + `AggregateError`, logical assignment (`||=`, `&&=`, `??=`), numeric separators `1_000_000`, `WeakRef`/`FinalizationRegistry` |
| **ES2022** | Class fields, **private `#fields` and methods**, static blocks, `#x in obj`, **top-level `await`**, `.at()`, `Object.hasOwn`, `Error` `cause`, RegExp `/d` indices |
| **ES2023** | `findLast`/`findLastIndex`, **change-array-by-copy** (`toSorted`, `toReversed`, `toSpliced`, `with`), hashbang grammar, symbols as WeakMap keys |
| **ES2024** | `Object.groupBy`/`Map.groupBy`, `Promise.withResolvers`, RegExp `v` flag, resizable `ArrayBuffer`, `String.prototype.isWellFormed` |
| **ES2025** | **Iterator helpers**, **Set methods** (`union`, `intersection`, `difference`…), **import attributes and JSON modules**, `Promise.try`, `RegExp.escape`, `Float16Array` |

```js
// A few of them in action
const { promise, resolve } = Promise.withResolvers();
setTimeout(() => resolve('resolved later'), 10);
promise.then((v) => console.log(v));

try {
  throw new Error('Upload failed', { cause: { status: 503 } });
} catch (e) {
  console.log(e.message, e.cause);
}

console.log(1_000_000, 'a-b-c'.replaceAll('-', '+'), [1, 2, 3].at(-1), Object.hasOwn({ x: 1 }, 'x'));
```
