# Predict the Output (Tricky JS)

"What does this print?" questions test whether you understand the **mechanism**, not just syntax. Each puzzle below has runnable code. **Cover the answer, say your prediction and reasoning out loud, then press ▶ Run.** In an interview, explain *why*: interviewers care more about the reasoning than the final string.

> The playground runs code like a classic browser `<script>` (sloppy mode unless `'use strict'` appears), which matches how most of these puzzles are asked.

## Hoisting & scope

### Predict the output: `var` shadowing inside a function 🔥

```js
var a = 1;
function foo() {
  console.log(a);
  var a = 2;
  console.log(a);
}
foo();
console.log(a);
```

**Answer:** `undefined`, `2`, `1`

The `var a` inside `foo` is hoisted to the top of `foo` (initialised to `undefined`) and **shadows** the global `a` for the whole function, including the line before the declaration. The global `a` is never touched.

### Predict the output: function declaration vs `var` with the same name 🔥

```js
console.log(typeof foo);
var foo = 'string';
function foo() {}
console.log(typeof foo);
```

**Answer:** `function`, `string`

During hoisting, the function declaration wins over the bare `var foo` declaration, because a `var` declaration without a value doesn't overwrite an existing binding. At runtime, the assignment `foo = 'string'` executes on line 2 and replaces the function.

### Predict the output: `let` in a loop that also modifies the counter

```js
for (let i = 0; i < 3; i++) {
  setTimeout(() => console.log(i));
  i++;
}
```

**Answer:** `1`, `3`

Each iteration gets its **own** binding of `i`, but the body's `i++` mutates *that iteration's* binding before the timeout fires:

- **Iteration 1:** starts at `0`, then the body's `i++` makes it `1`. Its callback logs `1`.
- **Iteration 2:** the next binding is copied from `1`, and the loop's update makes it `2`. The body's `i++` makes it `3`, so its callback logs `3`.
- **Next iteration:** copied `3`, update makes it `4`, and `4 < 3` fails, so the loop ends.

### Predict the output: closure capturing a value too early 🔥

```js
function createIncrement() {
  let count = 0;
  function increment() { count++; }
  let message = `Count is ${count}`;
  function log() { console.log(message); }
  return [increment, log];
}
const [increment, log] = createIncrement();
increment();
increment();
increment();
log();
```

**Answer:** `Count is 0`

`message` is computed **once**, when `createIncrement` runs, while `count` is `0`. `log` closes over `message`, not over the expression that built it. This is exactly how **stale closures** happen in React hooks. The fix is to compute the message inside `log`.

### Predict the output: block-scoped `let` shadowing and the TDZ

```js
let x = 'outer';
function show() {
  try {
    console.log(x);
  } catch (e) {
    console.log(e.name);
  }
  let x = 'inner';
  console.log(x);
}
show();
```

**Answer:** `ReferenceError`, `inner`

The inner `let x` is hoisted to the top of `show`'s scope, but it's in the **Temporal Dead Zone** until its declaration line. So the first `console.log(x)` doesn't fall back to the outer `x`; it throws.

## `this` binding

### Predict the output: method extraction and nested functions 🔥

```js
'use strict';
const obj = {
  label: 'obj',
  regular() {
    return function () { return this?.label; };
  },
  arrow() {
    return () => this.label;
  },
};
console.log(obj.regular()());
console.log(obj.arrow()());
const { arrow } = obj;
try { console.log(arrow()()); } catch (e) { console.log(e.constructor.name); }
```

**Answer:** `undefined`, `obj`, `TypeError`

1. The inner `function` is called plainly, so in strict mode `this` is `undefined` and `this?.label` gives `undefined`.
2. The arrow returned from `obj.arrow()` captures `this` from that call, which is `obj`.
3. Destructuring `arrow` and calling it plainly makes `this` `undefined` inside `arrow`. The returned arrow inherits that `undefined`, so `this.label` throws a `TypeError`.

### Predict the output: `this` with a variable defined by `var` 🔥

```js
var fullname = 'global';
const company = {
  fullname: 'company',
  team: {
    fullname: 'team',
    getFullname() { return this.fullname; },
  },
};
console.log(company.team.getFullname());
const getFullname = company.team.getFullname;
console.log(getFullname());
```

**Answer:** `team`, `global`

The first call uses implicit binding: `this` is `company.team`. The second is a plain call in sloppy mode, so `this` is the global object. A top-level `var fullname` creates `globalThis.fullname`, so it prints `global`. In strict mode or an ES module, it would throw instead.

### Predict the output: double `bind` 🔥

```js
function show() { return this.v; }
const once = show.bind({ v: 1 });
const twice = once.bind({ v: 2 });
console.log(once(), twice(), twice.call({ v: 3 }));
```

**Answer:** `1 1 1`

A bound function's `this` is **fixed forever**. Binding it again, or using `call`/`apply`, can't change it. Only `new` can override a bound `this`.

### Predict the output: class methods vs arrow class fields

```js
class Player {
  name = 'field';
  getName() { return this.name; }
  arrowName = () => this.name;
}
const p = new Player();
const { getName, arrowName } = p;
console.log(arrowName());
try {
  getName();
} catch (e) {
  console.log(e.constructor.name);
}
```

**Answer:** `field`, `TypeError`

The arrow field is created per instance in the constructor and captures `this`. `getName` lives on the prototype. Class bodies are strict, so the extracted `getName()` runs with `this` as `undefined`, and `this.name` throws.

## Objects, arrays & coercion

### Predict the output: objects as object keys 🔥

```js
const a = {};
const b = { key: 'b' };
const c = { key: 'c' };
a[b] = 123;
a[c] = 456;
console.log(a[b], Object.keys(a));
```

**Answer:** `456 [ '[object Object]' ]`

Object keys are strings (or symbols). Both `b` and `c` are converted to the string `'[object Object]'`, so the second assignment overwrites the first. Use a `Map` for object keys.

### Predict the output: array length and holes

```js
const arr = [1, 2, 3];
arr[10] = 11;
console.log(arr.length, arr.filter(() => true).length, arr[5]);
arr.length = 2;
console.log(arr);
```

**Answer:** `11 4 undefined`, then `[ 1, 2 ]`

Assigning index 10 makes `length` 11 and leaves **holes** at indexes 3–9. `filter` skips holes, so 4 elements remain. Setting `length` to 2 **truncates** the array.

### Predict the output: sparse arrays and iteration methods

```js
const sparse = [1, , 3];
console.log(sparse.length);
console.log(sparse.map((x) => x * 2));
console.log(Object.keys(sparse));
console.log(sparse.indexOf(undefined), sparse.includes(undefined));
```

**Answer:** `3`, `[ 2, <1 empty item>, 6 ]`, `[ '0', '2' ]`, `-1 true`

`map`, `forEach`, `filter`, `indexOf` and `Object.keys` **skip holes**. `includes` and `for…of` treat holes as `undefined`, as do `Array.from` and spread.

### Predict the output: loose equality with arrays 🔥

```js
console.log([1, 2, 3] == '1,2,3');
console.log([] == '');
console.log([0] == false);
console.log([1] == true);
console.log([2] == true);
console.log(null == false, undefined == 0);
```

**Answer:** `true`, `true`, `true`, `true`, `false`, `false false`

- Arrays go through `ToPrimitive`, which uses `toString()`: `[1,2,3]` → `'1,2,3'`, `[]` → `''`, `[0]` → `'0'`.
- A boolean converts to a number: `false` → 0, `true` → 1.
  - `[0] == false` becomes `'0' == 0`, which is `0 == 0`.
  - `[2] == true` becomes `2 == 1`, which is false.
- `null` and `undefined` only equal each other.

### Predict the output: `+` with mixed types 🔥

```js
console.log(1 + 2 + '3');
console.log('1' + 2 + 3);
console.log('b' + 'a' + +'a' + 'a');
console.log([] + null + 1);
console.log({} + []);
console.log(true + true + '1');
console.log('5' - - '2');
```

**Answer:** `33`, `123`, `baNaNa`, `null1`, `[object Object]`, `21`, `7`

`+` is evaluated **left to right**: as soon as one operand is a string, it concatenates. `+'a'` is `NaN`. `[] + null` is `'' + 'null'`. `'5' - -'2'` is `5 - (-2)`.

### Predict the output: chained comparisons

```js
console.log(1 < 2 < 3);
console.log(3 > 2 > 1);
console.log('10' < '9', 10 < 9, '10' < 9);
```

**Answer:** `true`, `false`, `true false false`

`3 > 2 > 1` is `(3 > 2) > 1`, which is `true > 1`, which is `1 > 1`: false. Comparing two **strings** is lexicographic (`'1'` < `'9'`). Comparing a string with a number converts the string to a number.

### Predict the output: `parseInt` with `map` 🔥

```js
console.log(['1', '2', '3'].map(parseInt));
console.log(['1', '2', '3'].map(Number));
console.log(parseInt('08'), parseInt('0x10'), parseInt('12px'), Number('12px'));
console.log(parseInt(0.0000005));
```

**Answer:** `[ 1, NaN, NaN ]`, `[ 1, 2, 3 ]`, `8 16 12 NaN`, `5`

`map` passes `(value, index)`, so the calls are `parseInt('1', 0)`, `parseInt('2', 1)` and `parseInt('3', 2)`:

- Radix `0` means "auto", so `'1'` → `1`.
- Radix `1` is invalid → `NaN`.
- `'3'` isn't a valid base-2 digit → `NaN`.

`parseInt(0.0000005)` first converts the number to the string `'5e-7'`, then parses the leading `5`.

### Predict the output: `Math.max()` with no arguments

```js
console.log(Math.max(), Math.min());
console.log(Math.max() < Math.min());
console.log(Math.max(1, '3', null), Math.max(1, undefined));
```

**Answer:** `-Infinity Infinity`, `true`, `3 NaN`

The surprising part is the first line: `Math.max()` with no arguments returns `-Infinity`, the identity element for `max` (any number is bigger), and `Math.min()` returns `Infinity`. So "the max of nothing" is smaller than "the min of nothing". `null` converts to 0 and `'3'` to 3, but `undefined` converts to `NaN`, which poisons the result. This is why `Math.max(...[])` on an empty array is a common bug.

### Predict the output: `NaN`, `includes` and `indexOf`

```js
console.log([NaN].includes(NaN), [NaN].indexOf(NaN));
console.log([0].includes(-0), Object.is(0, -0));
console.log(NaN === NaN, Number.isNaN('abc'), isNaN('abc'));
```

**Answer:** `true -1`, `true false`, `false false true`

`includes` uses **SameValueZero** (`NaN` equals `NaN`, `+0` equals `-0`). `indexOf` uses `===`. `Object.is` distinguishes `0` from `-0`. The global `isNaN` coerces its argument first, so `isNaN('abc')` is true.

### Predict the output: object key ordering

```js
const obj = { b: 1, 2: 'two', a: 2, 1: 'one', '-1': 'neg', b2: 3 };
console.log(Object.keys(obj));
const merged = { a: 1, b: 2, a: 3 };
console.log({ ...merged, b: 4, ...{ c: 5 } });
```

**Answer:** `[ '1', '2', 'b', 'a', '-1', 'b2' ]` and `{ a: 3, b: 4, c: 5 }`

Property order:

1. **Integer-like keys in ascending order** come first.
2. Then **string keys in insertion order**. `'-1'` isn't a valid array index, so it's an ordinary string key.
3. Then symbols.

Duplicate literal keys keep the **last value**, but the key stays in its **first position**. Later spreads overwrite earlier properties.

### Predict the output: passing objects to functions (reference vs reassignment) 🔥

```js
function change(o) {
  o.x = 2;          // mutates the caller's object
  o = { x: 3 };     // rebinds the local parameter only
  return o;
}
const original = { x: 1 };
const returned = change(original);
console.log(original.x, returned.x);
```

**Answer:** `2 3`

JavaScript is **pass-by-value**, but for objects the *value* is a reference. Mutating through the reference affects the caller's object. Reassigning the parameter only changes the local variable.

### Predict the output: `JSON.stringify` edge cases

```js
console.log(JSON.stringify({ a: undefined, b: () => 1, c: Symbol('s'), d: NaN, e: new Date(0), f: [undefined, () => 1] }));
console.log(JSON.stringify({ toJSON() { return 'custom'; } }));
console.log(JSON.stringify('str'), JSON.stringify(undefined));
console.log(JSON.stringify({ n: 1, s: 'x' }, null, 0) === JSON.stringify({ n: 1, s: 'x' }));
```

**Answer:**

```text
{"d":null,"e":"1970-01-01T00:00:00.000Z","f":[null,null]}
"custom"
"str" undefined
true
```

`undefined`, functions and symbols are **omitted** as object properties but become `null` **inside arrays**. `NaN` and `Infinity` become `null`. Dates serialise through `Date.prototype.toJSON` (ISO string). `JSON.stringify(undefined)` returns `undefined` (not a string).

## Functions

### Predict the output: default parameters and `arguments`

```js
function f(a, b = a * 2) {
  a = 10;
  return [a, b, arguments[0], arguments.length];
}
function g(a) {
  arguments[0] = 99;
  return a;
}
function h(a) {
  'use strict';
  arguments[0] = 99;
  return a;
}
console.log(f(1), g(1), h(1));
```

**Answer:** `[ 10, 2, 1, 1 ] 99 1`

In **sloppy mode with simple parameters**, `arguments` is **aliased** to the parameters, so `g` returns 99. Default parameters (or rest/destructuring) **or** strict mode make `arguments` an unlinked copy. `arguments.length` counts what was **passed** (1), not the declared parameters.

### Predict the output: `function.length`

```js
function a(x, y = 1, ...rest) {}
console.log(a.length, ((...args) => {}).length, function (p, q) {}.length);
console.log(typeof class {}, typeof function* () {}, typeof (async () => {}));
```

**Answer:** `1 0 2`, `function function function`

`length` counts parameters **before the first one with a default value or rest**. Classes, generators and async functions are all functions to `typeof`.

### Predict the output: `try/finally` with return 🔥

```js
function f() {
  try {
    return 'try';
  } finally {
    console.log('finally runs before the function returns');
  }
}
function g() {
  try {
    return 'try';
  } finally {
    return 'finally';
  }
}
function h() {
  try {
    throw new Error('lost');
  } finally {
    return 'finally swallows the error';
  }
}
console.log(f(), g(), h());
```

**Answer:** first `finally runs before the function returns`, then `try finally finally swallows the error`

`finally` always runs. A `return` inside `finally` **overrides** the try's return value and even **swallows thrown errors**, which is why most linters flag it.

### Predict the output: changing a constructor's prototype after creating instances

```js
function Person() {}
Person.prototype.greet = function () { return 'hi'; };
const p = new Person();
Person.prototype = { greet() { return 'hello'; } };
const q = new Person();
console.log(p.greet(), q.greet(), p instanceof Person, q instanceof Person);
```

**Answer:** `hi hello false true`

`p`'s `[[Prototype]]` still points to the **old** prototype object. Replacing `Person.prototype` only affects instances created afterwards. `instanceof` checks against the **current** `Person.prototype`, which isn't in `p`'s chain.

### Predict the output: generators and `next(value)` 🔥

```js
function* gen() {
  const x = yield 1;
  console.log('x =', x);
  const y = yield x * 2;
  return x + y;
}
const it = gen();
console.log(it.next(10).value);
console.log(it.next(5).value);
console.log(it.next(1));
console.log(it.next());
```

**Answer:** `1`, `x = 5`, `10`, `{ value: 6, done: true }`, `{ value: undefined, done: true }`

The **first** `next(10)` only starts the generator; its argument is discarded, because no `yield` is waiting for it. `next(5)` resumes, making `x = 5`, and the generator yields `10`. `next(1)` sets `y = 1` and returns `6` with `done: true`. After that, the generator is finished.

## Promises & the event loop

### Predict the output: sync, microtasks and timers 🔥

```js
console.log('start');
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
(async () => {
  console.log('async start');
  await undefined;
  console.log('async end');
})();
console.log('end');
```

**Answer:** `start`, `async start`, `end`, `promise`, `async end`, `timeout`

The async IIFE runs synchronously until its first `await`. Microtasks run FIFO: the `.then` was queued before the `await` continuation. The timer runs last.

### Predict the output: returning a promise from `.then` (extra ticks) 🔥

```js
Promise.resolve()
  .then(() => {
    console.log(0);
    return Promise.resolve(4);
  })
  .then((res) => console.log(res));

Promise.resolve()
  .then(() => console.log(1))
  .then(() => console.log(2))
  .then(() => console.log(3))
  .then(() => console.log(5))
  .then(() => console.log(6));
```

**Answer:** `0 1 2 3 4 5 6`

When a `.then` callback **returns a promise** (a thenable), the outer promise doesn't fulfil directly. The spec queues a `PromiseResolveThenableJob`, which calls `.then` on the returned promise; that's **one extra microtask**. The returned promise's reaction is a **second** extra microtask. So `4` is delayed by two ticks, while the other chain advances one step per tick.

### Predict the output: `async` function returning a value vs a promise

```js
async function returnsValue() { return 1; }
async function returnsPromise() { return Promise.resolve(2); }
returnsPromise().then((v) => console.log('promise', v));
returnsValue().then((v) => console.log('value', v));
Promise.resolve().then(() => console.log('tick 1')).then(() => console.log('tick 2')).then(() => console.log('tick 3'));
```

**Answer:** `value 1`, `tick 1`, `tick 2`, `promise 2`, `tick 3`

Returning a plain value fulfils the async function's promise immediately. Returning a **promise** goes through the same thenable-resolution steps as above (two extra ticks), so `promise 2` arrives later even though `returnsPromise` was called first.

### Predict the output: `async`/`await` interleaving 🔥

```js
async function a() {
  console.log('a1');
  await b();
  console.log('a2');
}
async function b() {
  console.log('b');
}
console.log('start');
a();
console.log('end');
```

**Answer:** `start`, `a1`, `b`, `end`, `a2`

`a()` runs synchronously: it logs `a1` and calls `b()`, which logs `b` synchronously and returns a resolved promise. `await` suspends `a` and returns control to the caller, which logs `end`. Then the continuation logs `a2`.

### Predict the output: throwing after resolving

```js
new Promise((resolve) => {
  resolve('ok');
  throw new Error('thrown after resolve');
})
  .then((v) => console.log('then:', v))
  .catch((e) => console.log('catch:', e.message));

new Promise(() => {
  throw new Error('thrown before resolve');
}).catch((e) => console.log('catch:', e.message));
```

**Answer:** `then: ok`, `catch: thrown before resolve`

The executor is wrapped in try/catch. A throw **before** settling rejects the promise. A throw **after** `resolve` is ignored, because a settled promise can't change state.

### Predict the output: `setTimeout` inside a loop with promises

```js
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log('timeout', i), 0);
  Promise.resolve(i).then((v) => console.log('promise', v, i));
}
```

**Answer:** `promise 0 3`, `promise 1 3`, `promise 2 3`, `timeout 3`, `timeout 3`, `timeout 3`

The promises were **resolved with** the current value (`v` is 0, 1, 2), but the callbacks read the shared `var i` **later**, after the loop finished (3). All microtasks run before any timer.

### Predict the output: `Promise.all` with mixed values and ordering

```js
const delay = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
const started = [];
const tasks = [3, 1, 2].map((n) => {
  started.push(n);
  return delay(n * 10, `task${n}`);
});
console.log('started', started);
Promise.all([...tasks, 'plain', Promise.resolve('resolved')]).then((r) => console.log(r));
```

**Answer:** `started [ 3, 1, 2 ]`, then `[ 'task3', 'task1', 'task2', 'plain', 'resolved' ]`

All tasks **start immediately** when `map` runs, because promises are eager. `Promise.all` preserves **input order**, not completion order. Non-promise values pass through unchanged.

### Predict the output: microtask starvation of timers

```js
let count = 0;
setTimeout(() => console.log('timer finally ran after', count, 'microtasks'), 0);
function spin() {
  if (count++ < 100000) queueMicrotask(spin);
}
spin();
```

**Answer:** `timer finally ran after 100001 microtasks`

Each microtask schedules another one, and the microtask queue must be **completely drained** before the next task. So the timer waits for all 100,000 microtasks. An unbounded version would freeze the page forever.

## Grab bag

### Predict the output: `typeof` and `instanceof` combinations

```js
console.log(typeof typeof 1);
console.log(typeof null === 'object', null instanceof Object);
console.log([] instanceof Array, [] instanceof Object, typeof []);
console.log(typeof NaN, typeof Infinity, typeof new Number(1));
```

**Answer:** `string`, `true false`, `true true object`, `number number object`

`typeof` always returns a string, so `typeof typeof x` is always `'string'`. `null` has no prototype chain. `new Number(1)` is a wrapper **object**.

### Predict the output: string immutability and methods

```js
let s = 'hello';
s[0] = 'H';
s.toUpperCase();
console.log(s);
s = s.replace('l', 'L');
console.log(s, s.replaceAll('l', 'L'), 'abc'.at(-1), 'a-b-c'.split('-', 2));
```

**Answer:** `hello`, `heLlo heLLo c [ 'a', 'b' ]`

Strings are immutable. Index assignment is ignored, and methods return **new** strings that must be assigned. `replace` with a string pattern replaces only the **first** match. `split` has an optional limit argument.

### Predict the output: `delete` on arrays and objects

```js
const arr = ['a', 'b', 'c'];
delete arr[1];
console.log(arr, arr.length);
const o = { x: 1 };
console.log(delete o.x, delete o.nothing, o);
const frozen = Object.freeze({ y: 1 });
console.log(delete frozen.y, frozen);
```

**Answer:** `[ 'a', <1 empty item>, 'c' ] 3`, `true true {}`, `false { y: 1 }`

`delete` on an array leaves a **hole**; length is unchanged. Use `splice` to actually remove an element. Deleting a non-existent property returns `true`. Deleting from a frozen object fails silently in sloppy mode (it throws in strict mode).

### Predict the output: closures in a returned object with getters

```js
function counter() {
  let n = 0;
  return {
    inc() { n++; return this; },
    get value() { return n; },
    snapshot: n,
  };
}
const c = counter();
c.inc().inc().inc();
console.log(c.value, c.snapshot);
```

**Answer:** `3 0`

`inc` returns `this`, which allows chaining. The getter reads the **live** closure variable. `snapshot` was a plain property **copied once** at creation.

### Predict the output: `==` with objects having `valueOf`

```js
const weird = {
  i: 1,
  valueOf() { return this.i++; },
};
console.log(weird == 1 && weird == 2 && weird == 3);
```

**Answer:** `true`

Each `==` against a number calls `ToPrimitive`, which calls `valueOf()`. It returns 1, 2, then 3 because of the side effect. This classic trick shows why `==` with objects is dangerous.

### Predict the output: optional chaining short-circuit

```js
let calls = 0;
const getId = () => { calls++; return 1; };
const user = null;
console.log(user?.profile.name, user?.[getId()], calls);
const settings = { theme: undefined };
console.log(settings.theme?.toUpperCase() ?? 'default', settings.missing?.());
```

**Answer:** `undefined undefined 0`, `default undefined`

When the left side of `?.` is nullish, the **whole rest of the chain** is skipped. That includes the property access on `.profile.name` and the computed key expression `getId()`, which never runs.
