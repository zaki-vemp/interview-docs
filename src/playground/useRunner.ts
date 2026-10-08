import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogLevel, TestResult } from './runtimeCore';
import { stripModuleSyntax } from './runtimeCore';
import type { WorkerOut } from './runner.worker';

export type RunStatus = 'idle' | 'compiling' | 'running' | 'done' | 'error' | 'timeout' | 'stopped';
export type Lang = 'js' | 'ts';

export type OutputLine =
  | { id: number; kind: 'log'; level: LogLevel; text: string; group: number }
  | { id: number; kind: 'table'; head: string[]; rows: string[][]; group: number }
  | { id: number; kind: 'error'; text: string; line?: number }
  | { id: number; kind: 'system'; text: string; tone: 'info' | 'warn' | 'success' | 'danger' };

type NewLine = OutputLine extends infer L ? (L extends { id: number } ? Omit<L, 'id'> : never) : never;

const MAX_LINES = 3000;

export interface RunnerState {
  lines: OutputLine[];
  tests: TestResult[];
  status: RunStatus;
  ms: number | null;
}

export function useRunner() {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [tests, setTests] = useState<TestResult[]>([]);
  const [status, setStatus] = useState<RunStatus>('idle');
  const [ms, setMs] = useState<number | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const timeoutRef = useRef<number | undefined>(undefined);
  const lineBuf = useRef<(NewLine | 'clear')[]>([]);
  const testBuf = useRef<TestResult[]>([]);
  const flushTimer = useRef<number | undefined>(undefined);
  const idRef = useRef(0);
  const runIdRef = useRef(0);

  const flush = useCallback(() => {
    window.clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    const buf = lineBuf.current;
    lineBuf.current = [];
    if (buf.length) {
      setLines((prev) => {
        let next = prev.slice();
        for (const item of buf) {
          if (item === 'clear') next = [];
          else next.push({ ...item, id: ++idRef.current } as OutputLine);
        }
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    }
    const tb = testBuf.current;
    testBuf.current = [];
    if (tb.length) setTests((prev) => [...prev, ...tb]);
  }, []);

  // Batch output into ~one React update per frame. A timer (not requestAnimationFrame)
  // keeps output flowing while the tab is hidden, where rAF callbacks are paused.
  const schedule = useCallback(() => {
    if (flushTimer.current === undefined) flushTimer.current = window.setTimeout(flush, 16);
  }, [flush]);

  const push = useCallback(
    (line: NewLine | 'clear') => {
      lineBuf.current.push(line);
      schedule();
    },
    [schedule],
  );

  const kill = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    window.clearTimeout(timeoutRef.current);
  }, []);

  const stop = useCallback(() => {
    if (!workerRef.current) return;
    kill();
    push({ kind: 'system', text: 'Execution stopped by you.', tone: 'warn' });
    setStatus('stopped');
  }, [kill, push]);

  const clear = useCallback(() => {
    lineBuf.current = [];
    testBuf.current = [];
    setLines([]);
    setTests([]);
    setMs(null);
    if (!workerRef.current) setStatus('idle');
  }, []);

  const run = useCallback(
    async (source: string, lang: Lang, timeoutMs: number) => {
      kill();
      const runId = ++runIdRef.current;
      lineBuf.current = [];
      testBuf.current = [];
      setLines([]);
      setTests([]);
      setMs(null);
      setStatus('compiling');

      let js = source;
      if (lang === 'ts') {
        try {
          const { transform } = await import('sucrase');
          js = transform(source, { transforms: ['typescript'], disableESTransforms: true }).code;
        } catch (err) {
          if (runId !== runIdRef.current) return;
          push({ kind: 'error', text: `TypeScript compile error: ${(err as Error).message}` });
          setStatus('error');
          return;
        }
      }
      if (runId !== runIdRef.current) return;

      const stripped = stripModuleSyntax(js);
      js = stripped.code;
      if (stripped.removedImports) {
        push({
          kind: 'system',
          tone: 'warn',
          text: `Skipped ${stripped.removedImports} import statement(s): the playground runs plain scripts without a module bundler.`,
        });
      }

      const worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      setStatus('running');
      let mainDone = false;
      let hadError = false;
      const started = performance.now();

      worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
        if (workerRef.current !== worker) return;
        const msg = ev.data;
        switch (msg.type) {
          case 'console':
            if (msg.entry.kind === 'clear') push('clear');
            else push(msg.entry as NewLine);
            break;
          case 'error':
            hadError = true;
            push({ kind: 'error', text: msg.text, line: msg.line });
            break;
          case 'main-done':
            mainDone = true;
            break;
          case 'test':
            testBuf.current.push(msg.result);
            schedule();
            break;
          case 'done':
            flush();
            kill();
            setMs(msg.ms);
            setStatus(hadError ? 'error' : 'done');
            break;
        }
      };
      worker.onerror = (ev) => {
        ev.preventDefault();
        hadError = true;
        push({ kind: 'error', text: ev.message || 'The worker failed to start.' });
        kill();
        setStatus('error');
      };

      timeoutRef.current = window.setTimeout(() => {
        if (workerRef.current !== worker) return;
        kill();
        setMs(performance.now() - started);
        push({
          kind: 'system',
          tone: 'danger',
          text: mainDone
            ? `Stopped after ${timeoutMs / 1000}s: timers, intervals or network requests were still pending (did you forget clearInterval?).`
            : `Timed out after ${timeoutMs / 1000}s: possible infinite loop, or an await that never settles. The worker was terminated.`,
        });
        setStatus('timeout');
      }, timeoutMs);

      worker.postMessage({ type: 'run', code: js });
    },
    [kill, push, schedule],
  );

  useEffect(
    () => () => {
      kill();
      window.clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
    },
    [kill],
  );

  return { lines, tests, status, ms, run, stop, clear };
}
