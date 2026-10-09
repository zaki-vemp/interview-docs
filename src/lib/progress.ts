import { createStore, useStore } from './store';

export type QStatus = 'mastered' | 'review';

export interface ProgressState {
  status: Record<string, QStatus>;
  bookmarks: Record<string, number>;
  notes: Record<string, string>;
  visited: Record<string, number>;
}

export const progressStore = createStore<ProgressState>(
  { status: {}, bookmarks: {}, notes: {}, visited: {} },
  { key: 'ipd:progress:v1' },
);

export const progress = {
  setStatus(key: string, s: QStatus | null, toggle = true) {
    progressStore.set((st) => {
      const status = { ...st.status };
      if (s === null || (toggle && status[key] === s)) delete status[key];
      else status[key] = s;
      return { status };
    });
  },
  toggleBookmark(key: string) {
    progressStore.set((st) => {
      const bookmarks = { ...st.bookmarks };
      if (bookmarks[key]) delete bookmarks[key];
      else bookmarks[key] = Date.now();
      return { bookmarks };
    });
  },
  setNote(key: string, text: string) {
    progressStore.set((st) => {
      const notes = { ...st.notes };
      if (text.trim()) notes[key] = text;
      else delete notes[key];
      return { notes };
    });
  },
  visit(slug: string) {
    progressStore.set((st) => ({ visited: { ...st.visited, [slug]: Date.now() } }));
  },
  exportJson(): string {
    return JSON.stringify(progressStore.get(), null, 2);
  },
  importJson(json: string) {
    const data: unknown = JSON.parse(json);
    const isMap = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    if (!isMap(data) || !['status', 'bookmarks', 'notes', 'visited'].some((key) => key in data))
      throw new Error('Invalid progress backup');
    const validators: Record<keyof ProgressState, (value: unknown) => boolean> = {
      status: (value) => value === 'mastered' || value === 'review',
      bookmarks: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
      notes: (value) => typeof value === 'string',
      visited: (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    };
    for (const key of Object.keys(validators) as (keyof ProgressState)[]) {
      const map = data[key];
      if (map !== undefined && (!isMap(map) || !Object.values(map).every(validators[key])))
        throw new Error('Invalid progress backup');
    }
    const imported = data as Partial<ProgressState>;
    progressStore.set({
      status: imported.status ?? {},
      bookmarks: imported.bookmarks ?? {},
      notes: imported.notes ?? {},
      visited: imported.visited ?? {},
    });
  },
  reset() {
    progressStore.set({ status: {}, bookmarks: {}, notes: {}, visited: {} });
  },
};

export const useProgress = <S>(selector: (s: ProgressState) => S) => useStore(progressStore, selector);

export const useStatusMap = () => useProgress((s) => s.status);
