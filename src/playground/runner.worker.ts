/// <reference lib="webworker" />
/*
 * Executes one snippet of user code in an isolated Web Worker.
 * A fresh worker is created for every run and terminated afterwards, so
 * infinite loops can always be killed and globals never leak between runs.
 */
import {
  createConsole,
  createTestApi,
  createTimerTracker,
  describeError,
  dsaHelpers,
  inspect,
  userLine,
  type ConsoleEntry,
  type TestResult,
} from './runtimeCore';

export type WorkerOut =
  | { type: 'console'; entry: ConsoleEntry }
  | { type: 'error'; text: string; line?: number }
  | { type: 'main-done' }
  | { type: 'test'; result: TestResult }
  | { type: 'done'; ms: number; tests: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = self as any;
const post = (m: WorkerOut) => g.postMessage(m);

const MAX_MESSAGES = 3000;
let sent = 0;
const emit = (entry: ConsoleEntry) => {
  sent++;
  if (sent <= MAX_MESSAGES) post({ type: 'console', entry });
  else if (sent === MAX_MESSAGES + 1)
    post({ type: 'console', entry: { kind: 'log', level: 'warn', text: `… output truncated after ${MAX_MESSAGES} messages`, group: 0 } });
};

let lineOffset = 0;

g.addEventListener('error', (ev: ErrorEvent) => {
  ev.preventDefault();
  const err = ev.error ?? ev.message;
  post({ type: 'error', text: `Uncaught ${describeError(err)}`, line: userLine(err, lineOffset) });
});

g.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
  ev.preventDefault();
  post({ type: 'error', text: `Uncaught (in promise) ${describeError(ev.reason)}`, line: userLine(ev.reason, lineOffset) });
});

g.onmessage = async (e: MessageEvent<{ type: 'run'; code: string }>) => {
  if (e.data?.type !== 'run') return;
  const code = e.data.code;

  const realSetTimeout = g.setTimeout.bind(g);
  const timers = createTimerTracker({
    setTimeout: g.setTimeout.bind(g),
    clearTimeout: g.clearTimeout.bind(g),
    setInterval: g.setInterval.bind(g),
    clearInterval: g.clearInterval.bind(g),
  });
  const api = createTestApi();

  let pendingFetches = 0;
  const realFetch = typeof g.fetch === 'function' ? g.fetch.bind(g) : null;

  Object.assign(g, timers.wrapped, dsaHelpers, {
    console: createConsole(emit, () => performance.now()),
    test: api.test,
    it: api.it,
    describe: api.describe,
    beforeEach: api.beforeEach,
    afterEach: api.afterEach,
    expect: api.expect,
    assert: api.assert,
    jest: { fn: api.fn },
    vi: { fn: api.fn },
    window: g,
    global: g,
    alert: (m: unknown) => emit({ kind: 'log', level: 'info', text: `[alert] ${typeof m === 'string' ? m : inspect(m)}`, group: 0 }),
  });
  if (realFetch) {
    g.fetch = (...args: unknown[]) => {
      pendingFetches++;
      return realFetch(...args).finally(() => pendingFetches--);
    };
  }

  const waitIdle = () =>
    new Promise<void>((resolve) => {
      const check = () => (timers.pendingCount() === 0 && pendingFetches === 0 ? resolve() : realSetTimeout(check, 20));
      realSetTimeout(check, 0);
    });

  const t0 = performance.now();
  let testCount = 0;
  let mainOk = false;
  try {
    // 1) Prefer classic-script semantics (top-level `var` becomes a global, sloppy `this`),
    //    which matches how most "predict the output" questions are written.
    // 2) Fall back to an async function body when the code uses top-level await.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    let mode: 'script' | 'async' = 'script';
    try {
      // parse only, never executed
      new Function(code);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      try {
        new AsyncFunction(code);
        mode = 'async';
      } catch {
        throw err;
      }
    }
    if (mode === 'script') {
      lineOffset = 0;
      const indirectEval = g.eval;
      indirectEval(code);
    } else {
      lineOffset = 2;
      await new AsyncFunction(code)();
    }
    mainOk = true;
  } catch (err) {
    post({ type: 'error', text: `Uncaught ${describeError(err)}`, line: userLine(err, lineOffset) });
  }
  post({ type: 'main-done' });

  if (mainOk) {
    // run tests registered by the program, then wait for timers/fetches, repeat
    for (let round = 0; round < 20; round++) {
      testCount += await api.runPending((result: TestResult) => post({ type: 'test', result }), (err: unknown) => userLine(err, lineOffset));
      await waitIdle();
      if (api.count() === testCount) break;
    }
  } else {
    // like a browser: an uncaught error stops the script, but already-scheduled timers still fire
    await waitIdle();
  }
  // give pending unhandled-rejection notifications a chance to be dispatched
  await new Promise((r) => realSetTimeout(r, 0));
  await new Promise((r) => realSetTimeout(r, 0));
  post({ type: 'done', ms: performance.now() - t0, tests: testCount });
};
