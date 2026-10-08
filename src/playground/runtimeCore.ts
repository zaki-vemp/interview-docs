/*
 * Shared JavaScript runtime used by BOTH the playground Web Worker (browser)
 * and the docs validator script (Node, via type stripping).
 *
 * Rules for this file:
 *  - no imports (it is loaded directly by Node and by Vite)
 *  - only erasable TypeScript syntax (no enums, namespaces, parameter properties)
 *  - never rely on `instanceof` for built-ins: the validator runs code in a
 *    separate vm realm, so we detect types with Object.prototype.toString.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export type ConsoleEntry =
  | { kind: 'log'; level: LogLevel; text: string; group: number }
  | { kind: 'table'; head: string[]; rows: string[][]; group: number }
  | { kind: 'clear' };

export interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
  line?: number;
  ms: number;
}

/* ------------------------------------------------------------------ */
/* inspect: a compact, Node-like value formatter                       */
/* ------------------------------------------------------------------ */

const MAX_DEPTH = 4;
const MAX_ITEMS = 100;
const LINE_WIDTH = 76;
const IDENT = /^[A-Za-z_$][\w$]*$/;

const tagOf = (v: unknown): string => Object.prototype.toString.call(v).slice(8, -1);

function quote(s: string): string {
  const esc = s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (!esc.includes("'")) return `'${esc}'`;
  if (!esc.includes('"')) return `"${esc}"`;
  if (!esc.includes('`')) return `\`${esc}\``;
  return `'${esc.replace(/'/g, "\\'")}'`;
}

function fmtKey(k: string | symbol): string {
  if (typeof k === 'symbol') return `[${k.toString()}]`;
  return IDENT.test(k) ? k : quote(k);
}

function fnLabel(fn: Any): string {
  let src = '';
  try {
    src = Function.prototype.toString.call(fn);
  } catch {
    /* ignore */
  }
  const name: string = fn.name;
  if (/^class[\s{]/.test(src)) {
    const parent = Object.getPrototypeOf(fn);
    const ext = parent && parent.name && parent !== Function.prototype ? ` extends ${parent.name}` : '';
    return `[class ${name || '(anonymous)'}${ext}]`;
  }
  const ctor = fn.constructor && fn.constructor.name;
  const kind =
    ctor === 'AsyncFunction' || ctor === 'GeneratorFunction' || ctor === 'AsyncGeneratorFunction'
      ? ctor
      : 'Function';
  return name ? `[${kind}: ${name}]` : `[${kind} (anonymous)]`;
}

function wrap(prefix: string, open: string, close: string, items: string[], indent: number): string {
  if (!items.length) return `${prefix}${open}${close}`;
  const single = `${prefix}${open} ${items.join(', ')} ${close}`;
  if (single.length + indent <= LINE_WIDTH && !single.includes('\n')) return single;
  const pad = ' '.repeat(indent + 2);
  return `${prefix}${open}\n${items.map((i) => pad + i).join(',\n')}\n${' '.repeat(indent)}${close}`;
}

function errorText(e: Any): string {
  const name = (e && e.name) || 'Error';
  const msg = e && e.message !== undefined ? String(e.message) : '';
  return msg ? `${name}: ${msg}` : name;
}

function ownEntries(v: Any, depth: number, seen: unknown[], indent: number, skipIndices: boolean): string[] {
  const out: string[] = [];
  for (const k of Reflect.ownKeys(v)) {
    if (skipIndices && typeof k === 'string' && /^\d+$/.test(k)) continue;
    if (skipIndices && k === 'length') continue;
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !d.enumerable) continue;
    let val: string;
    if (d.get || d.set) val = d.get && d.set ? '[Getter/Setter]' : d.get ? '[Getter]' : '[Setter]';
    else val = fmt(d.value, depth - 1, seen, indent + 2);
    out.push(`${fmtKey(k)}: ${val}`);
  }
  return out;
}

function fmt(v: Any, depth: number, seen: unknown[], indent: number): string {
  switch (typeof v) {
    case 'string':
      return quote(v);
    case 'number':
      return Object.is(v, -0) ? '-0' : String(v);
    case 'bigint':
      return `${v}n`;
    case 'boolean':
    case 'undefined':
      return String(v);
    case 'symbol':
      return v.toString();
    case 'function': {
      const label = fnLabel(v);
      if (depth < 0) return label;
      const props = ownEntries(v, depth, seen, indent, false).filter((p) => !p.startsWith('prototype:'));
      return props.length ? wrap(`${label} `, '{', '}', props, indent) : label;
    }
  }
  if (v === null) return 'null';
  if (seen.includes(v)) return '[Circular *]';

  const tag = tagOf(v);
  switch (tag) {
    case 'Date':
      return isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
    case 'RegExp':
      return RegExp.prototype.toString.call(v);
    case 'Error':
      return indent === 0 && seen.length === 0 ? errorText(v) : `[${errorText(v)}]`;
    case 'Promise':
      return 'Promise { <state not inspectable> }';
    case 'WeakMap':
    case 'WeakSet':
    case 'WeakRef':
      return `${tag} { <items unknown> }`;
    case 'Number':
    case 'String':
    case 'Boolean':
    case 'BigInt':
    case 'Symbol':
      return `[${tag}: ${fmt(v.valueOf(), depth, seen, indent)}]`;
  }

  if (depth < 0) {
    if (Array.isArray(v)) return '[Array]';
    const ctorName = Object.getPrototypeOf(v)?.constructor?.name;
    return `[${ctorName || 'Object'}]`;
  }

  seen.push(v);
  try {
    if (Array.isArray(v) || tag === 'Arguments') {
      const items: string[] = [];
      const len: number = v.length;
      const max = Math.min(len, MAX_ITEMS);
      let holes = 0;
      const flush = () => {
        if (holes) items.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`);
        holes = 0;
      };
      for (let i = 0; i < max; i++) {
        if (!Object.prototype.hasOwnProperty.call(v, i)) {
          holes++;
          continue;
        }
        flush();
        items.push(fmt(v[i], depth - 1, seen, indent + 2));
      }
      flush();
      if (len > MAX_ITEMS) items.push(`... ${len - MAX_ITEMS} more item${len - MAX_ITEMS > 1 ? 's' : ''}`);
      items.push(...ownEntries(v, depth, seen, indent, true));
      const ctor = Object.getPrototypeOf(v)?.constructor?.name;
      const prefix = tag === 'Arguments' ? '[Arguments] ' : ctor && ctor !== 'Array' ? `${ctor}(${len}) ` : '';
      return wrap(prefix, '[', ']', items, indent);
    }

    if (ArrayBuffer.isView(v) && tag !== 'DataView') {
      const arr = v as Any;
      const items: string[] = [];
      const max = Math.min(arr.length, MAX_ITEMS);
      for (let i = 0; i < max; i++) items.push(fmt(arr[i], depth - 1, seen, indent + 2));
      if (arr.length > MAX_ITEMS) items.push(`... ${arr.length - MAX_ITEMS} more items`);
      return wrap(`${tag}(${arr.length}) `, '[', ']', items, indent);
    }

    if (tag === 'Map') {
      const items: string[] = [];
      let i = 0;
      for (const [k, val] of v as Map<unknown, unknown>) {
        if (i++ >= MAX_ITEMS) {
          items.push(`... ${v.size - MAX_ITEMS} more items`);
          break;
        }
        items.push(`${fmt(k, depth - 1, seen, indent + 2)} => ${fmt(val, depth - 1, seen, indent + 2)}`);
      }
      return wrap(`Map(${v.size}) `, '{', '}', items, indent);
    }

    if (tag === 'Set') {
      const items: string[] = [];
      let i = 0;
      for (const val of v as Set<unknown>) {
        if (i++ >= MAX_ITEMS) {
          items.push(`... ${v.size - MAX_ITEMS} more items`);
          break;
        }
        items.push(fmt(val, depth - 1, seen, indent + 2));
      }
      return wrap(`Set(${v.size}) `, '{', '}', items, indent);
    }

    const proto = Object.getPrototypeOf(v);
    let prefix = '';
    if (proto === null) prefix = '[Object: null prototype] ';
    else {
      const cname = proto.constructor && proto.constructor.name;
      if (cname && cname !== 'Object') prefix = `${cname} `;
      else if (typeof v[Symbol.toStringTag] === 'string') prefix = `Object [${v[Symbol.toStringTag]}] `;
    }
    if (tag === 'Error' || (v && typeof v.stack === 'string' && typeof v.message === 'string')) {
      return errorText(v);
    }
    return wrap(prefix, '{', '}', ownEntries(v, depth, seen, indent, false), indent);
  } finally {
    seen.pop();
  }
}

export function inspect(value: unknown, depth: number = MAX_DEPTH): string {
  return fmt(value, depth, [], 0);
}

/** Format console arguments the way Node/Chrome do (strings raw, everything else inspected). */
export function formatArgs(args: unknown[]): string {
  if (!args.length) return '';
  const parts: string[] = [];
  let rest = args;
  const first = args[0];
  if (typeof first === 'string' && /%[sdifoOjc%]/.test(first)) {
    let idx = 1;
    const out = first.replace(/%([sdifoOjc%])/g, (m, f: string) => {
      if (f === '%') return '%';
      if (idx >= args.length) return m;
      const a: Any = args[idx++];
      switch (f) {
        case 's':
          return typeof a === 'string' ? a : typeof a === 'object' && a !== null ? inspect(a, 1) : String(a);
        case 'd':
        case 'i': {
          if (typeof a === 'bigint') return `${a}n`;
          const n = Number(a);
          return String(f === 'i' ? Math.trunc(n) : n);
        }
        case 'f':
          return String(Number(a));
        case 'j':
          try {
            return JSON.stringify(a);
          } catch {
            return '[Circular]';
          }
        case 'c':
          return '';
        default:
          return inspect(a);
      }
    });
    parts.push(out);
    rest = args.slice(idx);
  } else {
    parts.push(typeof first === 'string' ? first : inspect(first));
    rest = args.slice(1);
  }
  for (const a of rest) parts.push(typeof a === 'string' ? a : inspect(a));
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* console                                                             */
/* ------------------------------------------------------------------ */

export function createConsole(emit: (e: ConsoleEntry) => void, now: () => number): Any {
  let group = 0;
  const counts = new Map<string, number>();
  const timers = new Map<string, number>();
  const write = (level: LogLevel) => (...args: unknown[]) =>
    emit({ kind: 'log', level, text: formatArgs(args), group });

  const table = (data: Any, columns?: string[]) => {
    if (data === null || typeof data !== 'object') {
      write('log')(data);
      return;
    }
    const isMap = tagOf(data) === 'Map';
    const entries: [string, Any][] = isMap
      ? [...(data as Map<unknown, unknown>).entries()].map(([k, v], i) => [String(i), { Key: k, Values: v }] as [string, Any])
      : Array.isArray(data)
        ? data.map((v: Any, i: number) => [String(i), v] as [string, Any])
        : Object.keys(data).map((k) => [k, data[k]] as [string, Any]);
    const cols: string[] = [];
    let hasValues = false;
    for (const [, v] of entries) {
      if (v !== null && typeof v === 'object') {
        for (const k of Object.keys(v)) if (!cols.includes(k)) cols.push(k);
      } else hasValues = true;
    }
    const useCols = columns && columns.length ? columns : cols;
    const head = ['(index)', ...useCols, ...(hasValues && !columns ? ['Values'] : [])];
    const rows = entries.map(([k, v]) => {
      const row = [k];
      for (const c of useCols) row.push(v !== null && typeof v === 'object' && c in v ? inspect(v[c], 0) : '');
      if (hasValues && !columns) row.push(v !== null && typeof v === 'object' ? '' : inspect(v, 0));
      return row;
    });
    emit({ kind: 'table', head, rows, group });
  };

  return {
    log: write('log'),
    info: write('info'),
    debug: write('debug'),
    warn: write('warn'),
    error: write('error'),
    trace: (...args: unknown[]) => emit({ kind: 'log', level: 'log', text: `Trace: ${formatArgs(args)}`, group }),
    dir: (v: unknown) => emit({ kind: 'log', level: 'log', text: inspect(v), group }),
    dirxml: write('log'),
    table,
    group: (...label: unknown[]) => {
      if (label.length) write('log')(...label);
      group++;
    },
    groupCollapsed: (...label: unknown[]) => {
      if (label.length) write('log')(...label);
      group++;
    },
    groupEnd: () => {
      group = Math.max(0, group - 1);
    },
    count: (label = 'default') => {
      const n = (counts.get(label) || 0) + 1;
      counts.set(label, n);
      emit({ kind: 'log', level: 'log', text: `${label}: ${n}`, group });
    },
    countReset: (label = 'default') => {
      counts.set(label, 0);
    },
    time: (label = 'default') => {
      timers.set(label, now());
    },
    timeLog: (label = 'default', ...rest: unknown[]) => {
      const t = timers.get(label);
      if (t === undefined) return write('warn')(`Timer '${label}' does not exist`);
      emit({ kind: 'log', level: 'log', text: `${label}: ${(now() - t).toFixed(3)}ms ${formatArgs(rest)}`.trim(), group });
    },
    timeEnd: (label = 'default') => {
      const t = timers.get(label);
      if (t === undefined) return write('warn')(`Timer '${label}' does not exist`);
      timers.delete(label);
      emit({ kind: 'log', level: 'log', text: `${label}: ${(now() - t).toFixed(3)}ms`, group });
    },
    assert: (cond: unknown, ...args: unknown[]) => {
      if (!cond) emit({ kind: 'log', level: 'error', text: `Assertion failed${args.length ? ': ' + formatArgs(args) : ''}`, group });
    },
    clear: () => emit({ kind: 'clear' }),
  };
}

/* ------------------------------------------------------------------ */
/* deep equality (Jest-like)                                           */
/* ------------------------------------------------------------------ */

export function deepEqual(a: Any, b: Any, strict = false, seen: Map<unknown, unknown> = new Map()): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ta = tagOf(a);
  if (ta !== tagOf(b)) return false;
  if (strict && Object.getPrototypeOf(a)?.constructor?.name !== Object.getPrototypeOf(b)?.constructor?.name) return false;
  if (ta === 'Date') return Object.is(a.getTime(), b.getTime());
  if (ta === 'RegExp') return String(a) === String(b);
  if (ta === 'Number' || ta === 'String' || ta === 'Boolean') return Object.is(a.valueOf(), b.valueOf());
  if (ta === 'Error') return a.name === b.name && a.message === b.message;
  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (strict && (i in a) !== (i in b)) return false;
      if (!deepEqual(a[i], b[i], strict, seen)) return false;
    }
    return true;
  }
  if (ArrayBuffer.isView(a)) {
    const x = a as Any;
    const y = b as Any;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  }
  if (ta === 'Map') {
    if (a.size !== b.size) return false;
    outer: for (const [k, v] of a as Map<unknown, unknown>) {
      if ((b as Map<unknown, unknown>).has(k)) {
        if (!deepEqual(v, b.get(k), strict, seen)) return false;
        continue;
      }
      for (const [k2, v2] of b as Map<unknown, unknown>) {
        if (deepEqual(k, k2, strict, seen) && deepEqual(v, v2, strict, seen)) continue outer;
      }
      return false;
    }
    return true;
  }
  if (ta === 'Set') {
    if (a.size !== b.size) return false;
    outer: for (const v of a as Set<unknown>) {
      if ((b as Set<unknown>).has(v)) continue;
      for (const v2 of b as Set<unknown>) if (deepEqual(v, v2, strict, seen)) continue outer;
      return false;
    }
    return true;
  }
  const keys = (o: Any) =>
    Object.keys(o).filter((k) => strict || o[k] !== undefined);
  const ka = keys(a);
  const kb = keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k], strict, seen)) return false;
  }
  return true;
}

/** Recursive "subset" check used by toMatchObject. */
function matchesObject(actual: Any, expected: Any): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected) || deepEqual(actual, expected);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((e, i) => matchesObject(actual[i], e));
  }
  return Object.keys(expected).every((k) => k in actual && matchesObject(actual[k], expected[k]));
}

/* ------------------------------------------------------------------ */
/* mock functions (jest.fn / vi.fn)                                    */
/* ------------------------------------------------------------------ */

export function createMockFn(impl?: (...args: Any[]) => Any): Any {
  let implementation = impl;
  const onceQueue: ((...args: Any[]) => Any)[] = [];
  const mock: Any = { calls: [] as Any[][], results: [] as Any[], instances: [] as Any[], lastCall: undefined };
  const mockFn: Any = function (this: Any, ...args: Any[]) {
    mock.calls.push(args);
    mock.lastCall = args;
    mock.instances.push(this);
    const f = onceQueue.length ? onceQueue.shift() : implementation;
    try {
      const value = f ? f.apply(this, args) : undefined;
      mock.results.push({ type: 'return', value });
      return value;
    } catch (e) {
      mock.results.push({ type: 'throw', value: e });
      throw e;
    }
  };
  mockFn.mock = mock;
  mockFn._isMockFunction = true;
  mockFn.mockImplementation = (f: Any) => ((implementation = f), mockFn);
  mockFn.mockImplementationOnce = (f: Any) => (onceQueue.push(f), mockFn);
  mockFn.mockReturnValue = (v: Any) => mockFn.mockImplementation(() => v);
  mockFn.mockReturnValueOnce = (v: Any) => mockFn.mockImplementationOnce(() => v);
  mockFn.mockResolvedValue = (v: Any) => mockFn.mockImplementation(() => Promise.resolve(v));
  mockFn.mockRejectedValue = (e: Any) => mockFn.mockImplementation(() => Promise.reject(e));
  mockFn.mockClear = () => {
    mock.calls.length = 0;
    mock.results.length = 0;
    mock.instances.length = 0;
    mock.lastCall = undefined;
    return mockFn;
  };
  mockFn.mockReset = () => {
    mockFn.mockClear();
    implementation = undefined;
    onceQueue.length = 0;
    return mockFn;
  };
  return mockFn;
}

/* ------------------------------------------------------------------ */
/* test / expect / assert                                              */
/* ------------------------------------------------------------------ */

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

interface TestCase {
  name: string;
  path: string[];
  fn?: (...args: Any[]) => Any;
  skip: boolean;
  only: boolean;
  done: boolean;
}

interface Hook {
  path: string[];
  fn: () => Any;
}

const isPrefix = (prefix: string[], path: string[]) => prefix.every((p, i) => path[i] === p);

export function createTestApi(): Any {
  const cases: TestCase[] = [];
  const beforeHooks: Hook[] = [];
  const afterHooks: Hook[] = [];
  const stack: string[] = [];
  let skipDepth = 0;

  const add = (name: string, fn: Any, skip: boolean, only: boolean) => {
    cases.push({ name: [...stack, name].join(' › '), path: [...stack], fn, skip: skip || skipDepth > 0, only, done: false });
  };

  const test: Any = (name: string, fn: Any) => add(name, fn, false, false);
  test.skip = (name: string, fn?: Any) => add(name, fn, true, false);
  test.only = (name: string, fn: Any) => add(name, fn, false, true);
  test.todo = (name: string) => add(`${name} (todo)`, undefined, true, false);
  test.each = (table: Any[]) => (name: string, fn: Any) => {
    table.forEach((row, i) => {
      const args = Array.isArray(row) ? row : [row];
      let title = name.replace(/%[sdipj#]/g, (m) => (m === '%#' ? String(i) : inspect(args.shift?.() ?? row, 0)));
      if (title === name) title = `${name} [${i}]`;
      add(title, () => fn(...(Array.isArray(row) ? row : [row])), false, false);
    });
  };

  const describe: Any = (name: string, fn: () => void) => {
    stack.push(name);
    try {
      fn();
    } finally {
      stack.pop();
    }
  };
  describe.skip = (name: string, fn: () => void) => {
    skipDepth++;
    try {
      describe(name, fn);
    } finally {
      skipDepth--;
    }
  };
  describe.only = describe;

  const beforeEach = (fn: () => Any) => beforeHooks.push({ path: [...stack], fn });
  const afterEach = (fn: () => Any) => afterHooks.push({ path: [...stack], fn });

  function makeMatchers(actual: Any, negate: boolean, fromRejects = false): Any {
    const not = negate ? 'not.' : '';
    const check = (pass: boolean, msg: () => string) => {
      if (pass === negate) throw new AssertionError(msg());
    };
    const show = (v: unknown) => inspect(v, 3);
    const basic = (name: string, pass: boolean, expected?: unknown, hasExpected = true) =>
      check(pass, () =>
        `expect(received).${not}${name}(${hasExpected ? 'expected' : ''})\n\n` +
        (hasExpected ? `Expected: ${negate ? 'not ' : ''}${show(expected)}\n` : '') +
        `Received: ${show(actual)}`,
      );
    const isMock = actual && actual._isMockFunction;
    const requireMock = (name: string) => {
      if (!isMock) throw new AssertionError(`expect(received).${name}() — received value must be a mock function created with jest.fn() / vi.fn()`);
    };

    return {
      toBe: (expected: unknown) => {
        check(Object.is(actual, expected), () => {
          let m = `expect(received).${not}toBe(expected) // Object.is equality\n\nExpected: ${negate ? 'not ' : ''}${show(expected)}\nReceived: ${show(actual)}`;
          if (!negate && deepEqual(actual, expected)) m += '\n\nIf it should pass with deep equality, replace "toBe" with "toEqual"';
          return m;
        });
      },
      toEqual: (expected: unknown) => basic('toEqual', deepEqual(actual, expected), expected),
      toStrictEqual: (expected: unknown) => basic('toStrictEqual', deepEqual(actual, expected, true), expected),
      toMatchObject: (expected: unknown) => basic('toMatchObject', matchesObject(actual, expected), expected),
      toBeTruthy: () => basic('toBeTruthy', !!actual, undefined, false),
      toBeFalsy: () => basic('toBeFalsy', !actual, undefined, false),
      toBeNull: () => basic('toBeNull', actual === null, undefined, false),
      toBeUndefined: () => basic('toBeUndefined', actual === undefined, undefined, false),
      toBeDefined: () => basic('toBeDefined', actual !== undefined, undefined, false),
      toBeNaN: () => basic('toBeNaN', Number.isNaN(actual), undefined, false),
      toBeGreaterThan: (n: Any) => basic('toBeGreaterThan', actual > n, n),
      toBeGreaterThanOrEqual: (n: Any) => basic('toBeGreaterThanOrEqual', actual >= n, n),
      toBeLessThan: (n: Any) => basic('toBeLessThan', actual < n, n),
      toBeLessThanOrEqual: (n: Any) => basic('toBeLessThanOrEqual', actual <= n, n),
      toBeCloseTo: (n: number, digits = 2) => basic('toBeCloseTo', Math.abs(n - actual) < Math.pow(10, -digits) / 2, n),
      toBeInstanceOf: (C: Any) =>
        check(actual instanceof C, () => `expect(value).${not}toBeInstanceOf(${C && C.name})\n\nReceived constructor: ${actual?.constructor?.name}`),
      toContain: (item: unknown) => {
        const pass =
          typeof actual === 'string'
            ? actual.includes(String(item))
            : actual != null && typeof actual[Symbol.iterator] === 'function'
              ? [...actual].some((x) => Object.is(x, item))
              : false;
        basic('toContain', pass, item);
      },
      toContainEqual: (item: unknown) =>
        basic('toContainEqual', actual != null && [...actual].some((x: unknown) => deepEqual(x, item)), item),
      toHaveLength: (n: number) =>
        check(actual != null && actual.length === n, () => `expect(received).${not}toHaveLength(${n})\n\nReceived length: ${actual?.length}\nReceived: ${show(actual)}`),
      toHaveProperty: (path: string | string[], ...value: unknown[]) => {
        const parts = Array.isArray(path) ? path : String(path).split('.');
        let cur = actual;
        let found = true;
        for (const p of parts) {
          if (cur != null && Object.prototype.hasOwnProperty.call(Object(cur), p)) cur = cur[p];
          else {
            found = false;
            break;
          }
        }
        const pass = found && (value.length === 0 || deepEqual(cur, value[0]));
        check(pass, () => `expect(received).${not}toHaveProperty('${parts.join('.')}'${value.length ? ', value' : ''})\n\nReceived: ${show(actual)}`);
      },
      toMatch: (re: RegExp | string) =>
        basic('toMatch', typeof actual === 'string' && (typeof re === 'string' ? actual.includes(re) : re.test(actual)), re),
      toThrow: (expected?: Any) => {
        let thrown: Any;
        let didThrow = false;
        if (fromRejects) {
          didThrow = true;
          thrown = actual;
        } else {
          if (typeof actual !== 'function') throw new AssertionError('expect(received).toThrow() — received value must be a function');
          try {
            actual();
          } catch (e) {
            didThrow = true;
            thrown = e;
          }
        }
        let pass = didThrow;
        if (didThrow && expected !== undefined) {
          const msg = thrown && thrown.message !== undefined ? String(thrown.message) : String(thrown);
          if (typeof expected === 'string') pass = msg.includes(expected);
          else if (tagOf(expected) === 'RegExp') pass = expected.test(msg);
          else if (typeof expected === 'function') pass = thrown instanceof expected;
          else if (expected && typeof expected === 'object') pass = msg === expected.message;
        }
        check(pass, () =>
          didThrow
            ? `expect(received).${not}toThrow(${expected === undefined ? '' : show(expected)})\n\nThrown: ${show(thrown)}`
            : `expect(received).${not}toThrow()\n\nReceived function did not throw`,
        );
      },
      toThrowError: (expected?: Any) => makeMatchers(actual, negate, fromRejects).toThrow(expected),
      toHaveBeenCalled: () => {
        requireMock('toHaveBeenCalled');
        check(actual.mock.calls.length > 0, () => `expect(mock).${not}toHaveBeenCalled()\n\nNumber of calls: ${actual.mock.calls.length}`);
      },
      toHaveBeenCalledTimes: (n: number) => {
        requireMock('toHaveBeenCalledTimes');
        check(actual.mock.calls.length === n, () => `expect(mock).${not}toHaveBeenCalledTimes(${n})\n\nReceived number of calls: ${actual.mock.calls.length}`);
      },
      toHaveBeenCalledWith: (...args: unknown[]) => {
        requireMock('toHaveBeenCalledWith');
        check(actual.mock.calls.some((c: unknown[]) => deepEqual(c, args)), () =>
          `expect(mock).${not}toHaveBeenCalledWith(...expected)\n\nExpected: ${show(args)}\nReceived calls: ${show(actual.mock.calls)}`);
      },
      toHaveBeenLastCalledWith: (...args: unknown[]) => {
        requireMock('toHaveBeenLastCalledWith');
        check(deepEqual(actual.mock.lastCall, args), () =>
          `expect(mock).${not}toHaveBeenLastCalledWith(...expected)\n\nExpected: ${show(args)}\nLast call: ${show(actual.mock.lastCall)}`);
      },
      toHaveReturnedWith: (v: unknown) => {
        requireMock('toHaveReturnedWith');
        check(actual.mock.results.some((r: Any) => r.type === 'return' && deepEqual(r.value, v)), () =>
          `expect(mock).${not}toHaveReturnedWith(expected)\n\nExpected: ${show(v)}`);
      },
    };
  }

  const asyncMatchers = (getValue: () => Promise<Any>, rejects: boolean) => {
    const build = (negate: boolean): Any =>
      new Proxy(
        {},
        {
          get: (_t, name: string) => {
            if (name === 'not') return build(!negate);
            if (name === 'then') return undefined;
            return async (...args: Any[]) => {
              const v = await getValue();
              return makeMatchers(v, negate, rejects)[name](...args);
            };
          },
        },
      );
    return build(false);
  };

  const expect: Any = (actual: Any) => {
    const m = makeMatchers(actual, false);
    m.not = makeMatchers(actual, true);
    m.resolves = asyncMatchers(async () => {
      try {
        return await actual;
      } catch (e) {
        throw new AssertionError(`Received promise rejected instead of resolved\nRejected to value: ${inspect(e)}`);
      }
    }, false);
    m.rejects = asyncMatchers(async () => {
      try {
        await (typeof actual === 'function' ? actual() : actual);
      } catch (e) {
        return e;
      }
      throw new AssertionError('Received promise resolved instead of rejected');
    }, true);
    return m;
  };
  expect.assertions = () => {};
  expect.hasAssertions = () => {};

  const assert: Any = (value: unknown, message?: string) => {
    if (!value) throw new AssertionError(message ?? `The expression evaluated to a falsy value: assert(${inspect(value)})`);
  };
  assert.ok = assert;
  assert.equal = (a: Any, b: Any, m?: string) => {
    // eslint-disable-next-line eqeqeq
    if (!(a == b)) throw new AssertionError(m ?? `${inspect(a)} == ${inspect(b)}`);
  };
  assert.notEqual = (a: Any, b: Any, m?: string) => {
    // eslint-disable-next-line eqeqeq
    if (a == b) throw new AssertionError(m ?? `${inspect(a)} != ${inspect(b)}`);
  };
  assert.strictEqual = (a: Any, b: Any, m?: string) => {
    if (!Object.is(a, b)) throw new AssertionError(m ?? `Expected values to be strictly equal:\n\n${inspect(a)} !== ${inspect(b)}`);
  };
  assert.notStrictEqual = (a: Any, b: Any, m?: string) => {
    if (Object.is(a, b)) throw new AssertionError(m ?? `Expected "actual" to be strictly unequal to: ${inspect(b)}`);
  };
  assert.deepEqual = (a: Any, b: Any, m?: string) => {
    if (!deepEqual(a, b)) throw new AssertionError(m ?? `Expected values to be loosely deep-equal:\n\n${inspect(a)}\n\nshould loosely deep-equal\n\n${inspect(b)}`);
  };
  assert.deepStrictEqual = (a: Any, b: Any, m?: string) => {
    if (!deepEqual(a, b, true)) throw new AssertionError(m ?? `Expected values to be strictly deep-equal:\n\n${inspect(a)}\n\nshould equal\n\n${inspect(b)}`);
  };
  assert.notDeepStrictEqual = (a: Any, b: Any, m?: string) => {
    if (deepEqual(a, b, true)) throw new AssertionError(m ?? 'Expected "actual" not to be strictly deep-equal to "expected"');
  };
  assert.throws = (fn: () => void, expected?: Any, m?: string) => {
    try {
      fn();
    } catch (e: Any) {
      if (expected && tagOf(expected) === 'RegExp' && !expected.test(String(e?.message ?? e))) throw new AssertionError(m ?? `Error message did not match ${expected}`);
      if (typeof expected === 'function' && !(e instanceof expected)) throw new AssertionError(m ?? `Error is not an instance of ${expected.name}`);
      return;
    }
    throw new AssertionError(m ?? 'Missing expected exception.');
  };
  assert.rejects = async (p: Any, expected?: Any, m?: string) => {
    try {
      await (typeof p === 'function' ? p() : p);
    } catch (e: Any) {
      if (expected && tagOf(expected) === 'RegExp' && !expected.test(String(e?.message ?? e))) throw new AssertionError(m ?? `Rejection message did not match ${expected}`);
      return;
    }
    throw new AssertionError(m ?? 'Missing expected rejection.');
  };
  assert.match = (s: string, re: RegExp, m?: string) => {
    if (!re.test(s)) throw new AssertionError(m ?? `The input did not match the regular expression ${re}. Input: ${inspect(s)}`);
  };
  assert.fail = (m = 'Failed') => {
    throw new AssertionError(m);
  };

  async function runPending(onResult: (r: TestResult) => void, lineOf: (e: Any) => number | undefined) {
    const pending = cases.filter((c) => !c.done);
    const hasOnly = cases.some((c) => c.only);
    for (const c of pending) {
      c.done = true;
      if (c.skip || !c.fn || (hasOnly && !c.only)) {
        onResult({ name: c.name, status: 'skip', ms: 0 });
        continue;
      }
      const t0 = Date.now();
      try {
        for (const h of beforeHooks) if (isPrefix(h.path, c.path)) await h.fn();
        const fn = c.fn;
        if (fn.length >= 1) {
          await new Promise<void>((resolve, reject) => {
            fn((err?: unknown) => (err ? reject(err) : resolve()));
          });
        } else {
          await fn();
        }
        for (const h of afterHooks) if (isPrefix(h.path, c.path)) await h.fn();
        onResult({ name: c.name, status: 'pass', ms: Date.now() - t0 });
      } catch (e: Any) {
        const error = e && typeof e === 'object' && 'message' in e ? (e.name === 'AssertionError' ? e.message : errorText(e)) : `Thrown: ${inspect(e)}`;
        onResult({ name: c.name, status: 'fail', error, line: lineOf(e), ms: Date.now() - t0 });
      }
    }
    return pending.length;
  }

  return {
    test,
    it: test,
    describe,
    beforeEach,
    afterEach,
    expect,
    assert,
    fn: createMockFn,
    runPending,
    count: () => cases.length,
  };
}

/* ------------------------------------------------------------------ */
/* timers that know when the program is idle                           */
/* ------------------------------------------------------------------ */

export function createTimerTracker(host: Any): Any {
  const pending = new Set<unknown>();
  return {
    pendingCount: () => pending.size,
    wrapped: {
      setTimeout: (cb: Any, ms?: number, ...args: Any[]) => {
        const id: unknown = host.setTimeout(() => {
          pending.delete(id);
          if (typeof cb === 'function') cb(...args);
        }, ms);
        pending.add(id);
        return id;
      },
      clearTimeout: (id: unknown) => {
        pending.delete(id);
        host.clearTimeout(id);
      },
      setInterval: (cb: Any, ms?: number, ...args: Any[]) => {
        const id: unknown = host.setInterval(() => {
          if (typeof cb === 'function') cb(...args);
        }, ms);
        pending.add(id);
        return id;
      },
      clearInterval: (id: unknown) => {
        pending.delete(id);
        host.clearInterval(id);
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* error formatting                                                    */
/* ------------------------------------------------------------------ */

/** Line number (1-based, relative to the user's code) of the top user frame, if any. */
export function userLine(err: Any, offset: number): number | undefined {
  const stack = err && typeof err.stack === 'string' ? err.stack : '';
  const m = stack.match(/<anonymous>:(\d+):(\d+)/) || stack.match(/> (?:eval|Function):(\d+):(\d+)/) || stack.match(/evalmachine\.<anonymous>:(\d+)/) || stack.match(/user-code\.js:(\d+)/);
  if (!m) return undefined;
  const line = Number(m[1]) - offset;
  return line >= 1 ? line : undefined;
}

export function describeError(err: Any): string {
  if (err && typeof err === 'object' && 'message' in err) {
    let text = errorText(err);
    if (err.cause !== undefined) text += `\n  [cause]: ${inspect(err.cause, 2)}`;
    return text;
  }
  return inspect(err);
}

/* ------------------------------------------------------------------ */
/* DSA helpers exposed as globals                                      */
/* ------------------------------------------------------------------ */

export class ListNode {
  val: Any;
  next: ListNode | null;
  constructor(val: Any = 0, next: ListNode | null = null) {
    this.val = val;
    this.next = next;
  }
}

export class TreeNode {
  val: Any;
  left: TreeNode | null;
  right: TreeNode | null;
  constructor(val: Any = 0, left: TreeNode | null = null, right: TreeNode | null = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}

export const dsaHelpers = {
  ListNode,
  TreeNode,
  /** [1,2,3] -> 1 -> 2 -> 3 */
  arrayToList(arr: Any[]): ListNode | null {
    const dummy = new ListNode();
    let cur = dummy;
    for (const v of arr) cur = cur.next = new ListNode(v);
    return dummy.next;
  },
  listToArray(head: ListNode | null): Any[] {
    const out: Any[] = [];
    let guard = 0;
    for (let n = head; n && guard < 1e5; n = n.next, guard++) out.push(n.val);
    return out;
  },
  /** LeetCode level-order format: [3,9,20,null,null,15,7] */
  arrayToTree(arr: Any[]): TreeNode | null {
    if (!arr.length || arr[0] === null || arr[0] === undefined) return null;
    const root = new TreeNode(arr[0]);
    const queue: TreeNode[] = [root];
    let i = 1;
    while (queue.length && i < arr.length) {
      const node = queue.shift() as TreeNode;
      if (i < arr.length && arr[i] !== null && arr[i] !== undefined) queue.push((node.left = new TreeNode(arr[i])));
      i++;
      if (i < arr.length && arr[i] !== null && arr[i] !== undefined) queue.push((node.right = new TreeNode(arr[i])));
      i++;
    }
    return root;
  },
  treeToArray(root: TreeNode | null): Any[] {
    const out: Any[] = [];
    const queue: (TreeNode | null)[] = [root];
    while (queue.length) {
      const n = queue.shift();
      if (n) {
        out.push(n.val);
        queue.push(n.left, n.right);
      } else out.push(null);
    }
    while (out.length && out[out.length - 1] === null) out.pop();
    return out;
  },
};

/** Remove `export` keywords so pasted module code still runs as a script. */
export function stripModuleSyntax(code: string): { code: string; removedImports: number } {
  let removedImports = 0;
  const out = code
    .replace(/^([ \t]*)import\s+(?!\()[^;\n]*(?:from\s*)?['"][^'"]+['"];?[ \t]*$/gm, (m, ws: string) => {
      removedImports++;
      return `${ws}// [playground] skipped: ${m.trim()}`;
    })
    .replace(/^([ \t]*)export\s+default\s+(?=(?:async\s+)?(?:function|class)\b)/gm, '$1')
    .replace(/^([ \t]*)export\s+(?=(?:const|let|var|function|class|async|abstract|interface|type|enum)\b)/gm, '$1')
    .replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm, '');
  return { code: out, removedImports };
}
