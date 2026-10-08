import { lazy, Suspense, useEffect, useState } from 'react';
import { playground, usePlayground } from '../lib/playgroundStore';
import { useHotkey } from '../hooks/useHotkeys';

// CodeMirror + the runner are only downloaded the first time the playground opens
const PlaygroundWindow = lazy(() => import('./PlaygroundWindow'));

export function PlaygroundHost() {
  const open = usePlayground((s) => s.open);
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  useHotkey('mod+`', (e) => {
    e.preventDefault();
    playground.toggle();
  });
  return (
    <>
      {!open && (
        <button type="button" className="pg-fab" onClick={playground.open} title="Open the JavaScript playground (Ctrl + `)">
          <span aria-hidden>{'{ }'}</span> Playground
        </button>
      )}
      {mounted && (
        <Suspense fallback={open ? <div className="pg-loading">Loading playground…</div> : null}>
          <PlaygroundWindow hidden={!open} />
        </Suspense>
      )}
    </>
  );
}
