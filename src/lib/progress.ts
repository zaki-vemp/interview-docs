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
  setStatus(key: string, s: QStatus | null) {
    progressStore.set((st) => {
      const status = { ...st.status };
      if (s === null || status[key] === s) delete status[key];
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
    const data = JSON.parse(json) as Partial<ProgressState>;
    progressStore.set({
      status: data.status ?? {},
      bookmarks: data.bookmarks ?? {},
      notes: data.notes ?? {},
      visited: data.visited ?? {},
    });
  },
  reset() {
    progressStore.set({ status: {}, bookmarks: {}, notes: {}, visited: {} });
  },
};

export const useProgress = <S,>(selector: (s: ProgressState) => S) => useStore(progressStore, selector);

export const useStatusMap = () => useProgress((s) => s.status);
