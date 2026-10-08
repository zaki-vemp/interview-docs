import { createStore, useStore } from './store';

export type PgLang = 'js' | 'ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlaygroundState {
  open: boolean;
  maximized: boolean;
  code: string;
  lang: PgLang;
  rect: Rect;
  timeoutMs: number;
  split: number; // editor height ratio 0.2 .. 0.8
  runRequest: number; // bump to ask the playground to run the current code
  snippets: { name: string; code: string; lang: PgLang; at: number }[];
}

const DEFAULT_CODE = `// Floating JavaScript / TypeScript playground — runs in an isolated Web Worker.
// Ctrl/Cmd + Enter to run.  test(), expect(), assert, jest.fn() are available.

function groupBy(list, keyFn) {
  return list.reduce((acc, item) => {
    const key = keyFn(item);
    (acc[key] ??= []).push(item);
    return acc;
  }, {});
}

const people = [
  { name: 'Asha', team: 'web' },
  { name: 'Ravi', team: 'rtc' },
  { name: 'Zara', team: 'web' },
];

console.log(groupBy(people, (p) => p.team));
console.table(people);

test('groups by key', () => {
  expect(Object.keys(groupBy(people, (p) => p.team))).toEqual(['web', 'rtc']);
});
`;

const initialRect = (): Rect => {
  const w = Math.min(720, Math.max(360, window.innerWidth - 32));
  const h = Math.min(620, Math.max(360, window.innerHeight - 120));
  return { w, h, x: Math.max(16, window.innerWidth - w - 24), y: Math.max(72, window.innerHeight - h - 24) };
};

export const playgroundStore = createStore<PlaygroundState>(
  {
    open: false,
    maximized: false,
    code: DEFAULT_CODE,
    lang: 'js',
    rect: initialRect(),
    timeoutMs: 10000,
    split: 0.58,
    runRequest: 0,
    snippets: [],
  },
  {
    key: 'ipd:playground:v1',
    pick: ({ code, lang, rect, timeoutMs, split, snippets, maximized }) => ({ code, lang, rect, timeoutMs, split, snippets, maximized }),
  },
);

export const playground = {
  open: () => playgroundStore.set({ open: true }),
  close: () => playgroundStore.set({ open: false }),
  toggle: () => playgroundStore.set((s) => ({ open: !s.open })),
  /** Load code into the playground (optionally running it immediately). */
  load(code: string, lang: PgLang, run = true) {
    playgroundStore.set((s) => ({ open: true, code, lang, runRequest: run ? s.runRequest + 1 : s.runRequest }));
  },
};

export const usePlayground = <S,>(selector: (s: PlaygroundState) => S) => useStore(playgroundStore, selector);
