import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap, EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { ensureSyntaxTree } from '@codemirror/language';
import { playground, playgroundStore, usePlayground, type PgLang, type Rect } from '../lib/playgroundStore';
import { useThemeValue } from '../hooks/useTheme';
import { useRunner, type OutputLine } from './useRunner';
import { TEMPLATES } from './templates';

const MIN_W = 340;
const MIN_H = 300;
const TIMEOUTS = [3000, 10000, 30000, 60000];

type Dir = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const clampRect = (r: Rect): Rect => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(r.w, MIN_W), vw - 8);
  const h = Math.min(Math.max(r.h, MIN_H), vh - 8);
  return { w, h, x: Math.min(Math.max(r.x, 4 - w + 120), vw - 120), y: Math.min(Math.max(r.y, 4), vh - 44) };
};

export default function PlaygroundWindow({ hidden }: { hidden: boolean }) {
  const code = usePlayground((s) => s.code);
  const lang = usePlayground((s) => s.lang);
  const storedRect = usePlayground((s) => s.rect);
  const maximized = usePlayground((s) => s.maximized);
  const timeoutMs = usePlayground((s) => s.timeoutMs);
  const split = usePlayground((s) => s.split);
  const runRequest = usePlayground((s) => s.runRequest);
  const snippets = usePlayground((s) => s.snippets);
  const theme = useThemeValue();

  const { lines, tests, status, ms, run, stop, clear } = useRunner();
  const [tab, setTab] = useState<'console' | 'tests'>('console');
  const [rect, setRect] = useState<Rect>(() => clampRect(storedRect));
  const [saving, setSaving] = useState(false);
  const [snippetName, setSnippetName] = useState('');
  const [syntaxHint, setSyntaxHint] = useState<number | null>(null);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 700);
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const outRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const doRun = useCallback(() => {
    const s = playgroundStore.get();
    setSyntaxHint(null);
    setTab('console');
    void run(s.code, s.lang, s.timeoutMs);
  }, [run]);

  // Run requests coming from "▶ Run" buttons in the docs.
  // The cleanup forgets the handled request so that StrictMode's dev-only
  // unmount/remount (whose cleanup terminates the worker) starts the run again.
  const handledRequest = useRef(0);
  useEffect(() => {
    if (runRequest > 0 && runRequest !== handledRequest.current) {
      handledRequest.current = runRequest;
      doRun();
      return () => {
        handledRequest.current = 0;
      };
    }
  }, [runRequest, doRun]);

  useEffect(() => {
    const onResize = () => {
      setIsNarrow(window.innerWidth < 700);
      setRect((r) => clampRect(r));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Switch to the tests tab automatically (once per run) when the run produced test results
  const switchedForRun = useRef(false);
  useEffect(() => {
    if (status === 'running' || status === 'compiling') switchedForRun.current = false;
    else if (tests.length && !switchedForRun.current && (status === 'done' || status === 'error' || status === 'timeout')) {
      switchedForRun.current = true;
      setTab('tests');
    }
  }, [status, tests.length]);

  // Point at the most likely line of a SyntaxError (the engine message has no position)
  useEffect(() => {
    if (status === 'done' || status === 'error' || status === 'timeout') {
      if (lines.some((l) => l.kind === 'error' && /SyntaxError/.test(l.text) && !l.line)) {
        const view = cmRef.current?.view;
        if (view) {
          const tree = ensureSyntaxTree(view.state, view.state.doc.length, 300);
          let pos: number | null = null;
          tree?.iterate({
            enter: (n) => {
              if (pos === null && n.type.isError) pos = n.from;
              return pos === null;
            },
          });
          setSyntaxHint(pos === null ? null : view.state.doc.lineAt(pos).number);
        }
      }
    }
  }, [status, lines]);

  useEffect(() => {
    const el = outRef.current;
    if (el && tab === 'console') el.scrollTop = el.scrollHeight;
  }, [lines, tab]);

  const gotoLine = (n: number) => {
    const view = cmRef.current?.view;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(1, n), view.state.doc.lines));
    view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true });
    view.focus();
  };

  /* ---------------- drag / resize ---------------- */
  const startDrag = (dir: Dir) => (e: RPointerEvent) => {
    if (maximized || isNarrow) return;
    if (dir === 'move' && (e.target as HTMLElement).closest('button,select,input')) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, r: rect };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let latest = rect;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      const r = { ...start.r };
      if (dir === 'move') {
        r.x += dx;
        r.y += dy;
      } else {
        if (dir.includes('e')) r.w = Math.max(MIN_W, start.r.w + dx);
        if (dir.includes('s')) r.h = Math.max(MIN_H, start.r.h + dy);
        if (dir.includes('w')) {
          const w = Math.max(MIN_W, start.r.w - dx);
          r.x = start.r.x + (start.r.w - w);
          r.w = w;
        }
        if (dir.includes('n')) {
          const h = Math.max(MIN_H, start.r.h - dy);
          r.y = start.r.y + (start.r.h - h);
          r.h = h;
        }
      }
      latest = clampRect(r);
      setRect(latest);
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      playgroundStore.set({ rect: latest });
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const startSplit = (e: RPointerEvent) => {
    e.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const box = body.getBoundingClientRect();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const ratio = Math.min(0.85, Math.max(0.15, (ev.clientY - box.top) / box.height));
      playgroundStore.set({ split: ratio });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  };

  /* ---------------- editor ---------------- */
  const runRef = useRef(doRun);
  runRef.current = doRun;
  const extensions = useMemo(
    () => [
      javascript({ typescript: lang === 'ts' }),
      EditorView.lineWrapping,
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
    ],
    [lang],
  );

  const setLang = (l: PgLang) => playgroundStore.set({ lang: l });
  const onTemplate = (idx: string) => {
    const t = TEMPLATES[Number(idx)];
    if (!t) return;
    playgroundStore.set({ code: t.code, lang: t.lang });
  };
  const onSnippet = (idx: string) => {
    const s = snippets[Number(idx)];
    if (s) playgroundStore.set({ code: s.code, lang: s.lang });
  };
  const saveSnippet = () => {
    const name = snippetName.trim();
    if (!name) return;
    const s = playgroundStore.get();
    const rest = s.snippets.filter((x) => x.name !== name);
    playgroundStore.set({ snippets: [{ name, code: s.code, lang: s.lang, at: Date.now() }, ...rest].slice(0, 50) });
    setSaving(false);
    setSnippetName('');
  };
  const deleteSnippet = (name: string) => playgroundStore.set((s) => ({ snippets: s.snippets.filter((x) => x.name !== name) }));

  const passed = tests.filter((t) => t.status === 'pass').length;
  const failed = tests.filter((t) => t.status === 'fail').length;
  const skipped = tests.filter((t) => t.status === 'skip').length;
  const busy = status === 'running' || status === 'compiling';

  const style =
    maximized || isNarrow
      ? undefined
      : { left: rect.x, top: rect.y, width: rect.w, height: rect.h };

  return (
    <section
      className={`pg-window${maximized || isNarrow ? ' is-max' : ''}`}
      style={style}
      hidden={hidden}
      aria-label="Code playground"
    >
      <header className="pg-header" onPointerDown={startDrag('move')} onDoubleClick={() => playgroundStore.set({ maximized: !maximized })}>
        <span className="pg-title">
          <span className="pg-logo" aria-hidden>
            {'{ }'}
          </span>
          Playground
          <span className={`pg-status st-${status}`}>{statusLabel(status, ms)}</span>
        </span>
        <span className="pg-header-actions">
          <button type="button" className="icon-btn" aria-label={maximized ? 'Restore playground size' : 'Maximize playground'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => playgroundStore.set({ maximized: !maximized })}>
            {maximized ? '❐' : '□'}
          </button>
          <button type="button" className="icon-btn" aria-label="Hide playground" title="Hide (Ctrl + `). Your code is kept." onClick={playground.close}>
            ✕
          </button>
        </span>
      </header>

      <div className="pg-toolbar">
        <div className="seg" role="group" aria-label="Language">
          <button type="button" className={lang === 'js' ? 'on' : ''} aria-pressed={lang === 'js'} onClick={() => setLang('js')}>
            JS
          </button>
          <button type="button" className={lang === 'ts' ? 'on' : ''} aria-pressed={lang === 'ts'} onClick={() => setLang('ts')}>
            TS
          </button>
        </div>
        <select className="pg-select" value="" onChange={(e) => onTemplate(e.target.value)} aria-label="Load a template">
          <option value="" disabled>
            Templates
          </option>
          {TEMPLATES.map((t, i) => (
            <option key={t.name} value={i}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="pg-select" value="" onChange={(e) => onSnippet(e.target.value)} aria-label="Load a saved snippet" disabled={!snippets.length}>
          <option value="" disabled>
            {snippets.length ? `Snippets (${snippets.length})` : 'No snippets'}
          </option>
          {snippets.map((s, i) => (
            <option key={s.name} value={i}>
              {s.name} · {s.lang.toUpperCase()}
            </option>
          ))}
        </select>
        {saving ? (
          <form
            className="pg-save"
            onSubmit={(e) => {
              e.preventDefault();
              saveSnippet();
            }}
          >
            <input autoFocus value={snippetName} onChange={(e) => setSnippetName(e.target.value)} placeholder="Snippet name" maxLength={60} />
            <button type="submit" className="btn-ghost btn-xs">
              Save
            </button>
            <button type="button" className="btn-ghost btn-xs" onClick={() => setSaving(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <button type="button" className="btn-ghost btn-xs" onClick={() => setSaving(true)} title="Save the current code as a named snippet">
            Save
          </button>
        )}
        <select
          className="pg-select"
          value={timeoutMs}
          onChange={(e) => playgroundStore.set({ timeoutMs: Number(e.target.value) })}
          title="Kill the program after this long (protects against infinite loops)"
          aria-label="Timeout"
        >
          {TIMEOUTS.map((t) => (
            <option key={t} value={t}>
              {t / 1000}s limit
            </option>
          ))}
        </select>
        <span className="pg-spacer" />
        {busy ? (
          <button type="button" className="btn-stop" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button type="button" className="btn-run" onClick={doRun} title="Run (Ctrl/Cmd + Enter)">
            ▶ Run
          </button>
        )}
      </div>

      <div className="pg-body" ref={bodyRef}>
        <div className="pg-editor" style={{ flexBasis: `${split * 100}%` }}>
          <CodeMirror
            ref={cmRef}
            value={code}
            height="100%"
            theme={theme === 'dark' ? oneDark : 'light'}
            extensions={extensions}
            onChange={(v) => playgroundStore.set({ code: v })}
            basicSetup={{ foldGutter: false, highlightActiveLineGutter: true, tabSize: 2 }}
          />
        </div>
        <div className="pg-divider" onPointerDown={startSplit} role="separator" aria-orientation="horizontal" title="Drag to resize" />
        <div className="pg-output">
          <div className="pg-tabs">
            <button type="button" className={tab === 'console' ? 'on' : ''} onClick={() => setTab('console')}>
              Console {lines.length > 0 && <span className="count">{lines.length}</span>}
            </button>
            <button type="button" className={tab === 'tests' ? 'on' : ''} onClick={() => setTab('tests')}>
              Tests
              {tests.length > 0 && (
                <span className={`count ${failed ? 'bad' : 'good'}`}>
                  {passed}✓{failed ? ` ${failed}✗` : ''}
                </span>
              )}
            </button>
            <span className="pg-spacer" />
            <button type="button" className="btn-ghost btn-xs" onClick={clear}>
              Clear
            </button>
          </div>
          <div className="pg-out-scroll" ref={outRef}>
            {tab === 'console' ? (
              <ConsoleView lines={lines} status={status} onLine={gotoLine} syntaxHint={syntaxHint} />
            ) : (
              <TestsView tests={tests} passed={passed} failed={failed} skipped={skipped} onLine={gotoLine} />
            )}
          </div>
        </div>
      </div>

      {snippets.length > 0 && saving && (
        <div className="pg-snippet-list">
          {snippets.map((s) => (
            <span key={s.name} className="chip">
              {s.name}
              <button type="button" onClick={() => deleteSnippet(s.name)} aria-label={`Delete ${s.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {!maximized && !isNarrow &&
        (['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as Dir[]).map((d) => (
          <div key={d} className={`pg-resize rz-${d}`} onPointerDown={startDrag(d)} aria-hidden />
        ))}
    </section>
  );
}

function statusLabel(status: string, ms: number | null): string {
  switch (status) {
    case 'compiling':
      return 'compiling…';
    case 'running':
      return 'running…';
    case 'done':
      return ms !== null ? `done · ${fmtMs(ms)}` : 'done';
    case 'error':
      return ms !== null ? `error · ${fmtMs(ms)}` : 'error';
    case 'timeout':
      return 'timed out';
    case 'stopped':
      return 'stopped';
    default:
      return 'ready';
  }
}

const fmtMs = (ms: number) => (ms < 1 ? '<1 ms' : ms < 1000 ? `${ms.toFixed(1)} ms` : `${(ms / 1000).toFixed(2)} s`);

function ConsoleView({ lines, status, onLine, syntaxHint }: { lines: OutputLine[]; status: string; onLine: (n: number) => void; syntaxHint: number | null }) {
  if (!lines.length) {
    return (
      <div className="pg-empty">
        {status === 'running' || status === 'compiling'
          ? 'Running…'
          : status === 'done'
            ? 'Program finished with no console output.'
            : 'Output from console.log / console.table / errors appears here. Code runs in an isolated Web Worker (no DOM).'}
      </div>
    );
  }
  return (
    <div className="pg-lines">
      {lines.map((l) => {
        if (l.kind === 'table') {
          return (
            <div key={l.id} className="out-line" style={{ paddingLeft: 8 + l.group * 16 }}>
              <table className="out-table">
                <thead>
                  <tr>
                    {l.head.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {l.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (l.kind === 'error') {
          return (
            <div key={l.id} className="out-line lvl-error">
              <span className="out-icon">✗</span>
              <span className="out-text">{l.text}</span>
              {(l.line ?? syntaxHint) && (
                <button type="button" className="line-link" onClick={() => onLine((l.line ?? syntaxHint)!)}>
                  {l.line ? `line ${l.line}` : `≈ line ${syntaxHint}`}
                </button>
              )}
            </div>
          );
        }
        if (l.kind === 'system') {
          return (
            <div key={l.id} className={`out-line sys-${l.tone}`}>
              <span className="out-icon">ℹ</span>
              <span className="out-text">{l.text}</span>
            </div>
          );
        }
        return (
          <div key={l.id} className={`out-line lvl-${l.level}`} style={{ paddingLeft: 8 + l.group * 16 }}>
            {l.level === 'warn' && <span className="out-icon">⚠</span>}
            {l.level === 'error' && <span className="out-icon">✗</span>}
            <span className="out-text">{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

function TestsView({
  tests,
  passed,
  failed,
  skipped,
  onLine,
}: {
  tests: { name: string; status: string; error?: string; line?: number; ms: number }[];
  passed: number;
  failed: number;
  skipped: number;
  onLine: (n: number) => void;
}) {
  if (!tests.length) {
    return (
      <div className="pg-empty">
        No tests ran. Register tests with <code>test('name', () =&gt; expect(x).toBe(y))</code> — they run after your script finishes.
      </div>
    );
  }
  return (
    <div className="pg-tests">
      <div className={`test-summary ${failed ? 'bad' : 'good'}`}>
        {failed ? '✗' : '✓'} {passed} passed{failed ? `, ${failed} failed` : ''}
        {skipped ? `, ${skipped} skipped` : ''} · {tests.length} total
      </div>
      {tests.map((t, i) => (
        <div key={i} className={`test-row t-${t.status}`}>
          <div className="test-head">
            <span className="test-icon">{t.status === 'pass' ? '✓' : t.status === 'fail' ? '✗' : '○'}</span>
            <span className="test-name">{t.name}</span>
            <span className="test-ms">{t.status === 'skip' ? 'skipped' : `${t.ms} ms`}</span>
          </div>
          {t.error && (
            <pre className="test-error">
              {t.error}
              {t.line && (
                <>
                  {'\n'}
                  <button type="button" className="line-link" onClick={() => onLine(t.line!)}>
                    at line {t.line}
                  </button>
                </>
              )}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}
