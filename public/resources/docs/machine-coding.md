# Machine Coding & Polyfills

"Implement X from scratch" questions are the most common **live-coding** format for senior frontend roles at product companies. These are usually asked instead of heavy DSA. Each solution below is **interview-ready**: it handles edge cases, has a short explanation, and comes with **tests you can run** in the playground.

> **How to practise:** read the problem, close the answer, write your own version in the playground (`Ctrl + backquote`), paste the tests from below and make them pass. Then compare with the reference solution. In the interview, **talk while you code**: clarify requirements, state edge cases, write the simple version first, then improve it.

## Timing utilities

### Implement `debounce` (with leading/trailing, cancel and flush) 🔥

**Debounce** delays calling `fn` until `wait` ms have passed **without another call**. Uses: search-as-you-type, resize handlers, autosave.

- `trailing` (default): call once at the end of a burst, with the **latest** arguments.
- `leading`: call immediately on the first call of a burst.
- `cancel()` drops the pending call. `flush()` runs it now.
- Preserve `this` and the arguments.

```js
function debounce(fn, wait, { leading = false, trailing = true } = {}) {
  let timer = null;
  let lastArgs;
  let lastThis;
  let result;

  const invoke = () => {
    const args = lastArgs;
    const ctx = lastThis;
    lastArgs = lastThis = undefined;
    result = fn.apply(ctx, args);
    return result;
  };

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    const isNewBurst = timer === null;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (trailing && lastArgs) invoke(); // lastArgs is cleared if leading already handled the only call
    }, wait);
    if (leading && isNewBurst) invoke();
    return result;
  }

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
    lastArgs = lastThis = undefined;
  };
  debounced.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      if (lastArgs) invoke();
    }
    return result;
  };
  return debounced;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('trailing: one call with the latest arguments', async () => {
  const spy = jest.fn();
  const d = debounce(spy, 30);
  d('a'); d('b'); d('c');
  expect(spy).not.toHaveBeenCalled();
  await sleep(50);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith('c');
});

test('leading: fires immediately, then once more at the end of the burst', async () => {
  const spy = jest.fn();
  const d = debounce(spy, 30, { leading: true });
  d(1); d(2); d(3);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenLastCalledWith(1);
  await sleep(50);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(spy).toHaveBeenLastCalledWith(3);
});

test('a single leading call does not also fire on the trailing edge', async () => {
  const spy = jest.fn();
  const d = debounce(spy, 20, { leading: true });
  d('only');
  await sleep(40);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('cancel and flush', async () => {
  const spy = jest.fn((x) => x * 2);
  const d = debounce(spy, 30);
  d(1);
  d.cancel();
  await sleep(40);
  expect(spy).not.toHaveBeenCalled();
  d(21);
  expect(d.flush()).toBe(42);
  expect(spy).toHaveBeenCalledTimes(1);
});

test('preserves this', async () => {
  const obj = { name: 'ctx', save: debounce(function () { this.saved = this.name; }, 10) };
  obj.save();
  await sleep(20);
  expect(obj.saved).toBe('ctx');
});
```

**Follow-ups:** "debounce vs throttle?" (below). "How do you use debounce in React?" Create it with `useMemo`/`useRef` so it survives re-renders, and `cancel()` it in the effect cleanup (see the React Hooks doc).

### Implement `throttle` 🔥

**Throttle** guarantees `fn` runs **at most once every `wait` ms**. Uses: scroll and resize handlers, mouse-move during drag, sending cursor positions in a collaborative whiteboard, rate-limiting audio-level UI updates.

This version is **leading + trailing**: the first call runs immediately, and the last call in a window is not lost.

```js
function throttle(fn, wait) {
  let lastRun = -Infinity;
  let timer = null;
  let pending = null;

  function throttled(...args) {
    const now = Date.now();
    const remaining = wait - (now - lastRun);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = null;
      pending = null;
      lastRun = now;
      fn.apply(this, args);
    } else {
      pending = { ctx: this, args };          // remember the latest call
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          lastRun = Date.now();
          const p = pending;
          pending = null;
          if (p) fn.apply(p.ctx, p.args);      // trailing call with the latest args
        }, remaining);
      }
    }
  }
  throttled.cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
    lastRun = -Infinity;
  };
  return throttled;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('runs at most once per window, first and last calls are kept', async () => {
  const calls = [];
  const t = throttle((x) => calls.push(x), 50);
  for (let i = 1; i <= 10; i++) {
    t(i);
    await sleep(10);
  }
  await sleep(80);
  console.log('throttled calls:', calls);
  expect(calls[0]).toBe(1);                   // leading
  expect(calls[calls.length - 1]).toBe(10);   // trailing with the latest argument
  expect(calls.length).toBeLessThanOrEqual(4);
  expect(calls.length).toBeGreaterThanOrEqual(2);
});
```

**Debounce vs throttle:**

| | Debounce | Throttle |
|---|---|---|
| Fires | after activity **stops** | at a **steady rate during** activity |
| Search input | ✅ wait until the user pauses | ❌ |
| Scroll position, drag, cursor sharing | ❌ (would wait until the user stops) | ✅ |
| Window resize relayout | ✅ (once at the end) | ✅ (if live updates are needed) |

For visual updates, `requestAnimationFrame`-based throttling (at most once per frame) is often better than a fixed `wait`.

### Implement `setInterval` using `setTimeout`, and explain why you might

A recursive `setTimeout` waits for the previous run to finish before scheduling the next, so runs **never overlap**. That makes it ideal for **polling an API**. `setInterval` fires on schedule even if the previous async work hasn't finished.

```js
function interval(fn, ms) {
  let timer = null;
  let stopped = false;
  const tick = async () => {
    await fn();                         // waits for async work: no overlap
    if (!stopped) timer = setTimeout(tick, ms);
  };
  timer = setTimeout(tick, ms);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

test('polls without overlapping and stops cleanly', async () => {
  let running = 0;
  let maxConcurrent = 0;
  let runs = 0;
  const stop = interval(async () => {
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    await new Promise((r) => setTimeout(r, 15)); // work takes longer than the interval
    running--;
    runs++;
  }, 5);
  await new Promise((r) => setTimeout(r, 100));
  stop();
  const after = runs;
  await new Promise((r) => setTimeout(r, 50));
  expect(maxConcurrent).toBe(1);
  expect(runs).toBeLessThanOrEqual(after + 1);
});
```

## Promise polyfills

### Implement `Promise.all` 🔥

Requirements:

- accepts any **iterable**, including non-promise values
- results stay in **input order**
- **rejects on the first rejection**
- an empty input resolves to `[]`

```js
function promiseAll(iterable) {
  return new Promise((resolve, reject) => {
    const items = Array.from(iterable);
    const results = new Array(items.length);
    let remaining = items.length;
    if (remaining === 0) return resolve(results);
    items.forEach((item, i) => {
      Promise.resolve(item).then((value) => {
        results[i] = value;                // index keeps input order
        if (--remaining === 0) resolve(results);
      }, reject);                          // first rejection wins (later calls are ignored)
    });
  });
}

const delay = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error(v)) : res(v)), ms));

test('keeps order, accepts values', async () => {
  await expect(promiseAll([delay(30, 'a'), delay(10, 'b'), 42])).resolves.toEqual(['a', 'b', 42]);
});
test('empty iterable', async () => {
  await expect(promiseAll([])).resolves.toEqual([]);
  await expect(promiseAll(new Set([1, 2]))).resolves.toEqual([1, 2]);
});
test('rejects with the first error', async () => {
  await expect(promiseAll([delay(30, 'slow'), delay(5, 'boom', true), delay(10, 'later', true)])).rejects.toThrow('boom');
});
```

### Implement `Promise.allSettled`, `Promise.race` and `Promise.any` 🔥

```js
function allSettled(iterable) {
  return Promise.all(
    Array.from(iterable, (p) =>
      Promise.resolve(p).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
    ),
  );
}

function race(iterable) {
  return new Promise((resolve, reject) => {
    for (const p of iterable) Promise.resolve(p).then(resolve, reject); // first settle wins
  });
}

function any(iterable) {
  return new Promise((resolve, reject) => {
    const items = Array.from(iterable);
    const errors = new Array(items.length);
    let remaining = items.length;
    if (remaining === 0) return reject(new AggregateError([], 'All promises were rejected'));
    items.forEach((p, i) => {
      Promise.resolve(p).then(resolve, (err) => {
        errors[i] = err;
        if (--remaining === 0) reject(new AggregateError(errors, 'All promises were rejected'));
      });
    });
  });
}

const delay = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error(v)) : res(v)), ms));

test('allSettled reports every outcome', async () => {
  const r = await allSettled([delay(5, 'ok'), delay(5, 'bad', true), 7]);
  expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  expect(r[1].reason.message).toBe('bad');
});
test('race settles with the fastest', async () => {
  await expect(race([delay(20, 'slow'), delay(5, 'fast')])).resolves.toBe('fast');
  await expect(race([delay(20, 'slow'), delay(5, 'err', true)])).rejects.toThrow('err');
});
test('any resolves with the first success or rejects with AggregateError', async () => {
  await expect(any([delay(5, 'e1', true), delay(15, 'win')])).resolves.toBe('win');
  const err = await any([delay(5, 'e1', true), delay(5, 'e2', true)]).catch((e) => e);
  expect(err).toBeInstanceOf(AggregateError);
  expect(err.errors.map((e) => e.message)).toEqual(['e1', 'e2']);
});
```

### Implement a Promise from scratch (simplified Promises/A+) 🔥

This is a senior-level question. Key points to get right:

1. **State machine:** pending → fulfilled/rejected, **settled once**.
2. `then` callbacks always run **asynchronously** (microtasks), and `then` returns a **new promise**.
3. The **resolution procedure**: resolving with a **thenable adopts its state**, resolving with itself is a `TypeError`, and a throwing `then` getter rejects.
4. A missing handler **passes the value or reason through** the chain.
5. `catch`, `finally` (pass-through semantics) and the static helpers.

```js
class MyPromise {
  #state = 'pending';
  #value = undefined;
  #handlers = [];
  #done = false; // resolve/reject from the executor take effect only once

  constructor(executor) {
    const once = (fn) => (v) => {
      if (this.#done) return;
      this.#done = true;
      fn(v);
    };
    try {
      executor(once((v) => this.#resolveWith(v)), once((e) => this.#settle('rejected', e)));
    } catch (e) {
      if (!this.#done) {
        this.#done = true;
        this.#settle('rejected', e);
      }
    }
  }

  #resolveWith(value) {
    if (value === this) return this.#settle('rejected', new TypeError('Chaining cycle detected'));
    if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
      let then;
      try {
        then = value.then;
      } catch (e) {
        return this.#settle('rejected', e);
      }
      if (typeof then === 'function') {
        let called = false;
        queueMicrotask(() => {
          try {
            then.call(
              value,
              (v) => { if (!called) { called = true; this.#resolveWith(v); } },
              (e) => { if (!called) { called = true; this.#settle('rejected', e); } },
            );
          } catch (e) {
            if (!called) { called = true; this.#settle('rejected', e); }
          }
        });
        return;
      }
    }
    this.#settle('fulfilled', value);
  }

  #settle(state, value) {
    if (this.#state !== 'pending') return;
    this.#state = state;
    this.#value = value;
    this.#handlers.forEach((h) => this.#run(h));
    this.#handlers = [];
  }

  #run({ onFulfilled, onRejected, resolve, reject }) {
    queueMicrotask(() => {
      const fulfilled = this.#state === 'fulfilled';
      const cb = fulfilled ? onFulfilled : onRejected;
      if (typeof cb !== 'function') return (fulfilled ? resolve : reject)(this.#value); // pass-through
      try {
        resolve(cb(this.#value));
      } catch (e) {
        reject(e);
      }
    });
  }

  then(onFulfilled, onRejected) {
    return new MyPromise((resolve, reject) => {
      const h = { onFulfilled, onRejected, resolve, reject };
      if (this.#state === 'pending') this.#handlers.push(h);
      else this.#run(h);
    });
  }
  catch(onRejected) {
    return this.then(undefined, onRejected);
  }
  finally(fn) {
    return this.then(
      (v) => MyPromise.resolve(fn()).then(() => v),
      (e) => MyPromise.resolve(fn()).then(() => { throw e; }),
    );
  }
  static resolve(v) {
    return v instanceof MyPromise ? v : new MyPromise((r) => r(v));
  }
  static reject(e) {
    return new MyPromise((_, r) => r(e));
  }
}

test('then callbacks are async', async () => {
  const order = [];
  MyPromise.resolve(1).then(() => order.push('then'));
  order.push('sync');
  await new Promise((r) => setTimeout(r, 0));
  expect(order).toEqual(['sync', 'then']);
});
test('chaining, thenable adoption and pass-through', async () => {
  const v = await new MyPromise((r) => setTimeout(() => r(2), 5))
    .then()                                        // pass-through
    .then((x) => new MyPromise((r) => r(x * 10)))  // adopt
    .then((x) => ({ then: (ok) => ok(x + 1) }));   // foreign thenable
  expect(v).toBe(21);
});
test('errors propagate to catch; finally passes values through', async () => {
  const msg = await MyPromise.reject(new Error('x'))
    .then(() => 'skipped')
    .catch((e) => e.message)
    .finally(() => 'ignored');
  expect(msg).toBe('x');
});
test('settles only once; throwing executor rejects', async () => {
  await expect(new MyPromise((res, rej) => { res('first'); rej(new Error('no')); res('second'); })).resolves.toBe('first');
  await expect(new MyPromise(() => { throw new Error('boom'); })).rejects.toThrow('boom');
});
test('self-resolution is a TypeError', async () => {
  const p = MyPromise.resolve(1).then(() => p);
  await expect(p).rejects.toThrow('Chaining cycle');
});
```

## Function utilities

### Implement `Function.prototype.bind`, `call` and `apply` 🔥

```js
Function.prototype.myCall = function (ctx, ...args) {
  if (typeof this !== 'function') throw new TypeError('myCall must be called on a function');
  // sloppy-mode semantics: null/undefined -> globalThis, primitives -> wrapper objects
  const target = ctx === null || ctx === undefined ? globalThis : Object(ctx);
  const key = Symbol('fn');               // unique key: no collision with existing props
  target[key] = this;
  try {
    return target[key](...args);
  } finally {
    delete target[key];
  }
};

Function.prototype.myApply = function (ctx, args = []) {
  return this.myCall(ctx, ...args);
};

Function.prototype.myBind = function (ctx, ...preset) {
  const fn = this;
  if (typeof fn !== 'function') throw new TypeError('Bind must be called on a function');
  return function bound(...args) {
    // when called with `new`, ignore ctx and construct (like native bind)
    if (new.target) return Reflect.construct(fn, [...preset, ...args], new.target === bound ? fn : new.target);
    return fn.apply(ctx, [...preset, ...args]);
  };
};

function describe3(greeting, punct) { return `${greeting} ${this.name}${punct}`; }
const user = { name: 'Zaki' };

test('call/apply', () => {
  expect(describe3.myCall(user, 'Hi', '!')).toBe('Hi Zaki!');
  expect(describe3.myApply(user, ['Hello', '.'])).toBe('Hello Zaki.');
  expect(Object.keys(user)).toEqual(['name']);          // temp key cleaned up
});
test('bind with partial application', () => {
  const hi = describe3.myBind(user, 'Hey');
  expect(hi('?')).toBe('Hey Zaki?');
  expect(hi.call({ name: 'Other' }, '!')).toBe('Hey Zaki!');
});
test('bound constructor with new', () => {
  function Point(x, y) { this.x = x; this.y = y; }
  const P = Point.myBind(null, 1);
  const p = new P(2);
  expect(p).toEqual({ x: 1, y: 2 });
  expect(p instanceof Point).toBe(true);
});
```

**Interview notes:**

- Using a `Symbol` key avoids clobbering an existing property.
- Native `call` in **strict-mode** functions passes `null`/`undefined`/primitives through unchanged. This polyfill mimics sloppy mode, so say that out loud.

### Implement `curry` (and an infinite `sum(1)(2)(3)()`) 🔥

```js
function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) return fn.apply(this, args);
    return (...more) => curried.apply(this, [...args, ...more]);
  };
}

const volume = curry((l, w, h) => l * w * h);

// infinite currying: call with no args to get the result
function sum(a) {
  return (b) => (b === undefined ? a : sum(a + b));
}

// variant: coerce to a number with valueOf / Symbol.toPrimitive
function add(...nums) {
  const total = nums.reduce((s, n) => s + n, 0);
  const next = (...more) => add(total, ...more);
  next[Symbol.toPrimitive] = () => total;
  return next;
}

test('curry', () => {
  expect(volume(2)(3)(4)).toBe(24);
  expect(volume(2, 3)(4)).toBe(24);
  expect(volume(2)(3, 4)).toBe(24);
  expect(volume(2, 3, 4)).toBe(24);
});
test('infinite sum', () => {
  expect(sum(1)(2)(3)()).toBe(6);
  expect(sum(5)()).toBe(5);
  expect(+add(1)(2, 3)(4)).toBe(10);
});
```

`fn.length` doesn't count default or rest parameters, so curry functions with fixed arity. Mention this as a limitation.

### Implement `compose` and `pipe` (sync and async)

```js
const compose = (...fns) => (x) => fns.reduceRight((acc, fn) => fn(acc), x);
const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x);
const pipeAsync = (...fns) => (x) => fns.reduce((p, fn) => p.then(fn), Promise.resolve(x));

const trim = (s) => s.trim();
const lower = (s) => s.toLowerCase();
const slug = (s) => s.replace(/\s+/g, '-');

test('pipe and compose', async () => {
  expect(pipe(trim, lower, slug)('  Hello World ')).toBe('hello-world');
  expect(compose(slug, lower, trim)('  Hello World ')).toBe('hello-world');
  const fetchUser = async (id) => ({ id, name: 'zaki' });
  const greet = (u) => `hi ${u.name}`;
  await expect(pipeAsync(fetchUser, greet)(1)).resolves.toBe('hi zaki');
});
```

### Implement `memoize` and `once` 🔥

```js
function memoize(fn, { resolver = (...args) => (args.length === 1 ? args[0] : JSON.stringify(args)), maxSize = Infinity } = {}) {
  const cache = new Map();
  function memoized(...args) {
    const key = resolver(...args);
    if (cache.has(key)) {
      const v = cache.get(key);
      cache.delete(key);       // refresh recency (LRU-ish eviction)
      cache.set(key, v);
      return v;
    }
    const value = fn.apply(this, args);
    cache.set(key, value);
    if (cache.size > maxSize) cache.delete(cache.keys().next().value);
    return value;
  }
  memoized.cache = cache;
  return memoized;
}

function once(fn) {
  let called = false;
  let result;
  return function (...args) {
    if (!called) {
      called = true;
      result = fn.apply(this, args);
    }
    return result;
  };
}

test('memoize caches by arguments', () => {
  const slowAdd = jest.fn((a, b) => a + b);
  const fastAdd = memoize(slowAdd);
  fastAdd(1, 2); fastAdd(1, 2); fastAdd(2, 1);
  expect(slowAdd).toHaveBeenCalledTimes(2);
});
test('memoize respects maxSize', () => {
  const m = memoize((x) => x * 2, { maxSize: 2 });
  m(1); m(2); m(3);
  expect([...m.cache.keys()]).toEqual([2, 3]);
});
test('memoized recursive fibonacci', () => {
  const fib = memoize((n) => (n < 2 ? n : fib(n - 1) + fib(n - 2)));
  expect(fib(80)).toBe(23416728348467685);
});
test('once', () => {
  const init = jest.fn(() => 'ready');
  const initOnce = once(init);
  expect([initOnce(), initOnce(), initOnce()]).toEqual(['ready', 'ready', 'ready']);
  expect(init).toHaveBeenCalledTimes(1);
});
```

**Pitfalls:**

- `JSON.stringify` keys fail for functions, `undefined` and object identity. Use a `WeakMap` per object argument when identity matters.
- An unbounded cache is a memory leak. Use `maxSize` or a TTL.
- Memoising impure functions is a bug.

## Arrays & objects

### Implement `Array.prototype.map`, `filter` and `reduce` 🔥

```js
Array.prototype.myMap = function (cb, thisArg) {
  if (typeof cb !== 'function') throw new TypeError(`${cb} is not a function`);
  const out = new Array(this.length);
  for (let i = 0; i < this.length; i++) {
    if (i in this) out[i] = cb.call(thisArg, this[i], i, this);   // skip holes like native
  }
  return out;
};

Array.prototype.myFilter = function (cb, thisArg) {
  const out = [];
  for (let i = 0; i < this.length; i++) {
    if (i in this && cb.call(thisArg, this[i], i, this)) out.push(this[i]);
  }
  return out;
};

Array.prototype.myReduce = function (cb, ...init) {
  let i = 0;
  let acc;
  if (init.length) acc = init[0];
  else {
    while (i < this.length && !(i in this)) i++;            // find the first real element
    if (i >= this.length) throw new TypeError('Reduce of empty array with no initial value');
    acc = this[i++];
  }
  for (; i < this.length; i++) if (i in this) acc = cb(acc, this[i], i, this);
  return acc;
};

test('map/filter/reduce behave like the natives', () => {
  const arr = [1, 2, 3, 4];
  expect(arr.myMap((x, i) => x * i)).toEqual(arr.map((x, i) => x * i));
  expect(arr.myFilter((x) => x % 2 === 0)).toEqual([2, 4]);
  expect(arr.myReduce((a, b) => a + b)).toBe(10);
  expect(arr.myReduce((a, b) => a + b, 10)).toBe(20);
  expect([, 5].myReduce((a, b) => a + b)).toBe(5);       // holes skipped
  expect(() => [].myReduce((a, b) => a + b)).toThrow(TypeError);
  expect([].myReduce((a, b) => a + b, 'init')).toBe('init');
});
```

### Implement `flat` (array flattening) recursively and iteratively 🔥

```js
function flatten(arr, depth = 1) {
  return depth > 0
    ? arr.reduce((acc, v) => acc.concat(Array.isArray(v) ? flatten(v, depth - 1) : [v]), [])
    : arr.slice();
}

// Iterative with an explicit stack — no recursion depth limit
function flattenDeep(arr) {
  const stack = [...arr];
  const out = [];
  while (stack.length) {
    const next = stack.pop();
    if (Array.isArray(next)) stack.push(...next);
    else out.push(next);
  }
  return out.reverse();
}

// Generator version: lazy
function* flatGen(arr) {
  for (const v of arr) Array.isArray(v) ? yield* flatGen(v) : yield v;
}

const nested = [1, [2, [3, [4, [5]]]], 6];
test('flatten', () => {
  expect(flatten(nested)).toEqual(nested.flat());
  expect(flatten(nested, 2)).toEqual(nested.flat(2));
  expect(flatten(nested, Infinity)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(flattenDeep(nested)).toEqual([1, 2, 3, 4, 5, 6]);
  expect([...flatGen(nested)]).toEqual([1, 2, 3, 4, 5, 6]);
});
```

### Implement a deep clone that handles cycles, Dates, Maps, Sets and prototypes 🔥

```js
function deepClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value; // primitives & functions
  if (seen.has(value)) return seen.get(value);                   // cycles / shared refs

  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) {
    const m = new Map();
    seen.set(value, m);
    value.forEach((v, k) => m.set(deepClone(k, seen), deepClone(v, seen)));
    return m;
  }
  if (value instanceof Set) {
    const s = new Set();
    seen.set(value, s);
    value.forEach((v) => s.add(deepClone(v, seen)));
    return s;
  }

  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value)); // keep the class
  seen.set(value, copy);
  for (const key of Reflect.ownKeys(value)) {                    // includes symbols & non-enumerables
    const desc = Object.getOwnPropertyDescriptor(value, key);
    if ('value' in desc) desc.value = deepClone(desc.value, seen);
    Object.defineProperty(copy, key, desc);
  }
  return copy;
}

class User {
  constructor(name) { this.name = name; }
  hello() { return `hi ${this.name}`; }
}
const src = {
  user: new User('zaki'),
  when: new Date('2025-06-01'),
  tags: new Set(['a']),
  meta: new Map([[{ k: 1 }, 'objKey']]),
  list: [1, { deep: true }],
  [Symbol('id')]: 7,
};
src.self = src;

const copy = deepClone(src);

test('deep clone', () => {
  expect(copy).not.toBe(src);
  expect(copy.self).toBe(copy);                 // cycle preserved
  expect(copy.user).toBeInstanceOf(User);       // prototype preserved
  expect(copy.user.hello()).toBe('hi zaki');
  expect(copy.when.getTime()).toBe(src.when.getTime());
  expect(copy.when).not.toBe(src.when);
  expect(copy.list[1]).toEqual({ deep: true });
  expect(copy.list[1]).not.toBe(src.list[1]);
  expect(Object.getOwnPropertySymbols(copy)).toHaveLength(1);
  expect([...copy.meta.keys()][0]).toEqual({ k: 1 });
});
```

Compare this with `structuredClone`, which loses prototypes and throws on functions, and with JSON, which loses types and throws on cycles. Saying **when** you'd write your own shows judgement.

### Implement deep equality

```js
function deepEqual(a, b, seen = new Map()) {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp) return a.toString() === b.toString();
  if (seen.get(a) === b) return true;           // cycle guard
  seen.set(a, b);
  if (a instanceof Map || a instanceof Set) {
    if (a.size !== b.size) return false;
    if (a instanceof Set) return [...a].every((v) => b.has(v) || [...b].some((w) => deepEqual(v, w, seen)));
    return [...a].every(([k, v]) => b.has(k) && deepEqual(v, b.get(k), seen));
  }
  const ka = Reflect.ownKeys(a);
  const kb = Reflect.ownKeys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k], seen));
}

test('deepEqual', () => {
  expect(deepEqual({ a: [1, { b: NaN }] }, { a: [1, { b: NaN }] })).toBe(true);
  expect(deepEqual([1, 2], { 0: 1, 1: 2, length: 2 })).toBe(false);
  expect(deepEqual(new Map([['x', { y: 1 }]]), new Map([['x', { y: 1 }]]))).toBe(true);
  expect(deepEqual(new Set([{ a: 1 }]), new Set([{ a: 1 }]))).toBe(true);
  expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  const x = { v: 1 }; x.self = x;
  const y = { v: 1 }; y.self = y;
  expect(deepEqual(x, y)).toBe(true);
});
```

### Implement lodash `get` and `set` 🔥

```js
const toPath = (path) =>
  Array.isArray(path) ? path : String(path).replace(/\[(\w+)\]/g, '.$1').split('.').filter(Boolean);

function get(obj, path, defaultValue) {
  let cur = obj;
  for (const key of toPath(path)) {
    if (cur == null) return defaultValue;
    cur = cur[key];
  }
  return cur === undefined ? defaultValue : cur;
}

function set(obj, path, value) {
  const keys = toPath(path);
  keys.reduce((cur, key, i) => {
    if (i === keys.length - 1) cur[key] = value;
    else if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    return cur[key];
  }, obj);
  return obj;
}

const data = { user: { roles: [{ name: 'host' }, { name: 'presenter' }] } };
test('get', () => {
  expect(get(data, 'user.roles[1].name')).toBe('presenter');
  expect(get(data, ['user', 'roles', 0, 'name'])).toBe('host');
  expect(get(data, 'user.missing.deep', 'n/a')).toBe('n/a');
  expect(get(null, 'a', 1)).toBe(1);
});
test('set creates intermediate objects and arrays', () => {
  const o = {};
  set(o, 'a.b[0].c', 5);
  expect(o).toEqual({ a: { b: [{ c: 5 }] } });
});
```

### Flatten a nested object to dot-paths (and back)

Common in form libraries, i18n files and analytics payloads.

```js
function flattenObject(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flattenObject(v, key, out);
    else out[key] = v;
  }
  return out;
}

function unflattenObject(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.');
    keys.reduce((cur, k, i) => (i === keys.length - 1 ? (cur[k] = value) : (cur[k] ??= {})), out);
  }
  return out;
}

const nested = { a: 1, b: { c: 2, d: { e: 3 } }, f: [1, 2], g: {} };
test('flatten and unflatten', () => {
  expect(flattenObject(nested)).toEqual({ a: 1, 'b.c': 2, 'b.d.e': 3, f: [1, 2], g: {} });
  expect(unflattenObject(flattenObject(nested))).toEqual(nested);
});
```

### Implement `classnames` (the `clsx` utility)

```js
function classNames(...args) {
  const out = [];
  for (const a of args) {
    if (!a) continue;
    if (typeof a === 'string' || typeof a === 'number') out.push(a);
    else if (Array.isArray(a)) {
      const inner = classNames(...a);
      if (inner) out.push(inner);
    } else if (typeof a === 'object') {
      for (const [k, v] of Object.entries(a)) if (v) out.push(k);
    }
  }
  return out.join(' ');
}

test('classNames', () => {
  expect(classNames('btn', { active: true, disabled: false }, ['lg', null, ['x']], 0, undefined)).toBe('btn active lg x');
  expect(classNames()).toBe('');
});
```

### Implement `chunk`, `groupBy` and `uniqBy`

```js
const chunk = (arr, size) => {
  if (size < 1) throw new RangeError('size must be >= 1');
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
};
const groupBy = (arr, fn) =>
  arr.reduce((acc, x) => {
    const k = typeof fn === 'function' ? fn(x) : x[fn];
    (acc[k] ??= []).push(x);
    return acc;
  }, {});
const uniqBy = (arr, fn) => {
  const seen = new Set();
  return arr.filter((x) => {
    const k = fn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

test('collection helpers', () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(groupBy([1.2, 1.8, 2.1], Math.floor)).toEqual({ 1: [1.2, 1.8], 2: [2.1] });
  expect(groupBy([{ t: 'a' }, { t: 'b' }, { t: 'a' }], 't').a).toHaveLength(2);
  expect(uniqBy([{ id: 1 }, { id: 2 }, { id: 1 }], (x) => x.id)).toEqual([{ id: 1 }, { id: 2 }]);
});
```

### Implement `JSON.stringify` (simplified)

```js
function stringify(value, stack = []) {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return quote(value);
  if (t === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (t === 'boolean') return String(value);
  if (t === 'bigint') throw new TypeError('Do not know how to serialize a BigInt');
  if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
  if (typeof value.toJSON === 'function') return stringify(value.toJSON(), stack);
  if (stack.includes(value)) throw new TypeError('Converting circular structure to JSON');
  stack.push(value);
  let out;
  if (Array.isArray(value)) {
    out = `[${value.map((v) => stringify(v, stack) ?? 'null').join(',')}]`;
  } else {
    const parts = [];
    for (const k of Object.keys(value)) {
      const s = stringify(value[k], stack);
      if (s !== undefined) parts.push(`${quote(k)}:${s}`);
    }
    out = `{${parts.join(',')}}`;
  }
  stack.pop();
  return out;
}
const ESC = { '"': '\\"', '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
const quote = (s) => `"${s.replace(/["\\\u0000-\u001f]/g, (c) => ESC[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;

const samples = [
  { a: 1, b: 'x"y', c: [1, undefined, () => 1], d: undefined, e: null, f: NaN, g: { h: true } },
  [new Date(0), 'line\nbreak', '\u0001'],
  'plain',
  42,
];
test('matches native JSON.stringify', () => {
  for (const s of samples) expect(stringify(s)).toBe(JSON.stringify(s));
  const cyc = {}; cyc.self = cyc;
  expect(() => stringify(cyc)).toThrow('circular');
});
```

## Patterns & mini-libraries

### Implement an EventEmitter (on, off, once, emit) 🔥

This comes up a lot for real-time roles. lib-jitsi-meet, Node and many SDKs expose event emitters.

```js
class EventEmitter {
  #events = new Map();

  on(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    if (!this.#events.has(event)) this.#events.set(event, []);
    this.#events.get(event).push(listener);
    return () => this.off(event, listener);        // unsubscribe handle
  }

  off(event, listener) {
    const list = this.#events.get(event);
    if (!list) return this;
    const i = list.findIndex((l) => l === listener || l.original === listener);
    if (i !== -1) list.splice(i, 1);
    if (!list.length) this.#events.delete(event);
    return this;
  }

  once(event, listener) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      listener.apply(this, args);
    };
    wrapper.original = listener;                    // so off(event, listener) works before it fires
    return this.on(event, wrapper);
  }

  emit(event, ...args) {
    const list = this.#events.get(event);
    if (!list) return false;
    [...list].forEach((l) => l.apply(this, args));  // copy: listeners may unsubscribe during emit
    return true;
  }

  listenerCount(event) {
    return this.#events.get(event)?.length ?? 0;
  }
}

test('on / emit / off', () => {
  const e = new EventEmitter();
  const spy = jest.fn();
  const unsubscribe = e.on('join', spy);
  e.emit('join', { id: 1 });
  unsubscribe();
  e.emit('join', { id: 2 });
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith({ id: 1 });
  expect(e.emit('nobody-listens')).toBe(false);
});
test('once fires a single time and can be removed early', () => {
  const e = new EventEmitter();
  const spy = jest.fn();
  e.once('ready', spy);
  e.emit('ready'); e.emit('ready');
  expect(spy).toHaveBeenCalledTimes(1);
  const early = jest.fn();
  e.once('x', early);
  e.off('x', early);
  e.emit('x');
  expect(early).not.toHaveBeenCalled();
});
test('listener removing itself during emit does not skip others', () => {
  const e = new EventEmitter();
  const calls = [];
  const a = () => { calls.push('a'); e.off('evt', a); };
  e.on('evt', a);
  e.on('evt', () => calls.push('b'));
  e.emit('evt');
  expect(calls).toEqual(['a', 'b']);
  expect(e.listenerCount('evt')).toBe(1);
});
```

### Implement an LRU cache (O(1) get and put) 🔥

A JS `Map` preserves **insertion order**. Deleting and re-inserting a key moves it to the end (most recently used), and `map.keys().next().value` is the **least** recently used key. Both operations are O(1). (A doubly-linked list plus hash map version is in the DSA linked-list doc. Know both.)

```js
class LRUCache {
  #map = new Map();
  constructor(capacity) {
    if (capacity < 1) throw new RangeError('capacity must be positive');
    this.capacity = capacity;
  }
  get(key) {
    if (!this.#map.has(key)) return -1;
    const value = this.#map.get(key);
    this.#map.delete(key);
    this.#map.set(key, value);          // mark as most recently used
    return value;
  }
  put(key, value) {
    if (this.#map.has(key)) this.#map.delete(key);
    else if (this.#map.size >= this.capacity) this.#map.delete(this.#map.keys().next().value); // evict LRU
    this.#map.set(key, value);
  }
  keys() {
    return [...this.#map.keys()];
  }
}

test('LRU eviction order', () => {
  const c = new LRUCache(2);
  c.put(1, 'one');
  c.put(2, 'two');
  expect(c.get(1)).toBe('one');   // 1 is now most recent
  c.put(3, 'three');              // evicts 2
  expect(c.get(2)).toBe(-1);
  expect(c.keys()).toEqual([1, 3]);
  c.put(1, 'uno');                // update moves to most recent
  c.put(4, 'four');               // evicts 3
  expect(c.keys()).toEqual([1, 4]);
  expect(c.get(1)).toBe('uno');
});
```

### Implement a mini Redux: `createStore`, `combineReducers`, `applyMiddleware` and thunk 🔥

Building it shows you understand Redux's contract: pure reducers, subscriptions, and middleware as **function composition around `dispatch`**.

```js
function createStore(reducer, preloadedState, enhancer) {
  if (typeof enhancer === 'function') return enhancer(createStore)(reducer, preloadedState);
  let state = preloadedState;
  let listeners = [];
  let dispatching = false;

  const getState = () => state;
  const subscribe = (listener) => {
    listeners.push(listener);
    return () => { listeners = listeners.filter((l) => l !== listener); };
  };
  const dispatch = (action) => {
    if (!action || typeof action.type !== 'string') throw new Error('Actions must be plain objects with a string "type"');
    if (dispatching) throw new Error('Reducers may not dispatch actions');
    try {
      dispatching = true;
      state = reducer(state, action);
    } finally {
      dispatching = false;
    }
    listeners.slice().forEach((l) => l());
    return action;
  };
  dispatch({ type: '@@redux/INIT' });
  return { getState, dispatch, subscribe };
}

function combineReducers(reducers) {
  return (state = {}, action) => {
    let changed = false;
    const next = {};
    for (const key of Object.keys(reducers)) {
      next[key] = reducers[key](state[key], action);
      changed ||= next[key] !== state[key];
    }
    return changed ? next : state;                 // keep the reference when nothing changed
  };
}

function applyMiddleware(...middlewares) {
  return (createStoreFn) => (reducer, preloaded) => {
    const store = createStoreFn(reducer, preloaded);
    let dispatch = () => { throw new Error('Cannot dispatch while constructing middleware'); };
    const api = { getState: store.getState, dispatch: (a) => dispatch(a) };
    dispatch = middlewares.map((m) => m(api)).reduceRight((next, mw) => mw(next), store.dispatch);
    return { ...store, dispatch };
  };
}

const thunk = ({ dispatch, getState }) => (next) => (action) =>
  typeof action === 'function' ? action(dispatch, getState) : next(action);

const logged = [];
const logger = ({ getState }) => (next) => (action) => {
  const result = next(action);
  logged.push(`${action.type} -> ${JSON.stringify(getState().participants)}`);
  return result;
};

const participants = (state = [], action) => {
  switch (action.type) {
    case 'participant/joined': return [...state, action.payload];
    case 'participant/left': return state.filter((p) => p.id !== action.payload);
    default: return state;
  }
};
const recording = (state = { on: false }, action) => (action.type === 'recording/started' ? { on: true } : state);

const store = createStore(combineReducers({ participants, recording }), undefined, applyMiddleware(thunk, logger));

test('reducers, subscriptions and middleware', async () => {
  const listener = jest.fn();
  const unsub = store.subscribe(listener);
  store.dispatch({ type: 'participant/joined', payload: { id: 'a' } });
  await store.dispatch(async (dispatch) => {
    await new Promise((r) => setTimeout(r, 5));
    dispatch({ type: 'participant/joined', payload: { id: 'b' } });
  });
  unsub();
  store.dispatch({ type: 'participant/left', payload: 'a' });
  expect(store.getState().participants).toEqual([{ id: 'b' }]);
  expect(listener).toHaveBeenCalledTimes(2);
  expect(logged).toHaveLength(3);
  const before = store.getState();
  store.dispatch({ type: 'unknown' });
  expect(store.getState()).toBe(before);           // unchanged state keeps its identity
});
```

### Implement signals: reactive `signal`, `computed` and `effect`

Fine-grained reactivity (Solid, Preact Signals, Angular signals, Vue refs) is a hot interview topic. The core idea is that **reading a signal inside an effect subscribes the effect**.

```js
let activeEffect = null;

function signal(initial) {
  let value = initial;
  const subscribers = new Set();
  return {
    get value() {
      if (activeEffect) subscribers.add(activeEffect);   // dependency tracking
      return value;
    },
    set value(next) {
      if (Object.is(next, value)) return;
      value = next;
      [...subscribers].forEach((run) => run());          // notify
    },
  };
}

function effect(fn) {
  const run = () => {
    const prev = activeEffect;
    activeEffect = run;
    try { fn(); } finally { activeEffect = prev; }
  };
  run();
  return run;
}

function computed(fn) {
  const s = signal(undefined);
  effect(() => { s.value = fn(); });
  return { get value() { return s.value; } };
}

const participants = signal(2);
const max = signal(10);
const label = computed(() => `${participants.value}/${max.value} seats`);
const renders = [];
effect(() => renders.push(label.value));

participants.value = 3;
max.value = 12;
participants.value = 3;  // same value: no update
console.log(renders);

test('effects re-run only when dependencies change', () => {
  expect(renders).toEqual(['2/10 seats', '3/10 seats', '3/12 seats']);
});
```

Real implementations add batching, glitch-free ordering (topological updates), dependency cleanup on each run, and lazy computed values. Mention these as improvements.

### Implement a tiny virtual DOM: `h()` and `renderToString()`

```js
function h(type, props, ...children) {
  return { type, props: props ?? {}, children: children.flat(Infinity).filter((c) => c !== null && c !== false && c !== undefined) };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link']);

function renderToString(node) {
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
  if (typeof node.type === 'function') return renderToString(node.type({ ...node.props, children: node.children }));
  const attrs = Object.entries(node.props)
    .filter(([k, v]) => !k.startsWith('on') && v !== false && v != null)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k === 'className' ? 'class' : k}="${escapeHtml(v)}"`))
    .join('');
  if (VOID.has(node.type)) return `<${node.type}${attrs}>`;
  return `<${node.type}${attrs}>${node.children.map(renderToString).join('')}</${node.type}>`;
}

const Tile = ({ name, muted }) => h('div', { className: 'tile' }, h('span', null, name), muted && h('i', { 'aria-label': 'muted' }, '🔇'));
const app = h('main', { id: 'grid' }, ['Asha', 'Ravi <b>'].map((n, i) => h(Tile, { name: n, muted: i === 1 })), h('br'));

test('renders components, escapes text, drops falsy children', () => {
  expect(renderToString(app)).toBe(
    '<main id="grid"><div class="tile"><span>Asha</span></div><div class="tile"><span>Ravi &lt;b&gt;</span><i aria-label="muted">🔇</i></div><br></main>',
  );
});
```

Follow-up: "How would you **diff** two trees?" Compare node types: a different type means replace the node. For the same type, patch the changed props, then diff children by **key**. This is the core of React's reconciliation heuristics (see React Internals).

### Implement a string template renderer: `render('Hi {{user.name}}', data)`

```js
function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const value = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), data);
    return value == null ? '' : String(value);
  });
}

test('template rendering', () => {
  expect(renderTemplate('Hi {{ user.name }}, you have {{count}} new {{missing}}messages', { user: { name: 'Zaki' }, count: 3 }))
    .toBe('Hi Zaki, you have 3 new messages');
});
```

### Implement a rate limiter (token bucket)

Useful for client-side limits, for example on chat messages, reactions or signalling messages per second.

```js
class TokenBucket {
  constructor({ capacity, refillPerSecond, now = () => Date.now() }) {
    Object.assign(this, { capacity, refillPerSecond, now, tokens: capacity, last: now() });
  }
  #refill() {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSecond);
    this.last = t;
  }
  tryRemove(n = 1) {
    this.#refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

test('allows bursts up to capacity, then refills over time', () => {
  let fakeNow = 0;
  const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 2, now: () => fakeNow });
  expect([1, 2, 3, 4].map(() => bucket.tryRemove())).toEqual([true, true, true, false]);
  fakeNow += 500;                         // +1 token
  expect(bucket.tryRemove()).toBe(true);
  expect(bucket.tryRemove()).toBe(false);
});
```

**Testing tip:** injecting `now` (a clock) makes time-based code deterministic. Interviewers love this kind of design-for-testability.
