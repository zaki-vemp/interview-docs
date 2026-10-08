import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (patch: Partial<T> | ((s: T) => Partial<T>)) => void;
  subscribe: (listener: () => void) => () => void;
}

/**
 * A tiny external store (useSyncExternalStore-friendly) with optional
 * localStorage persistence. Storage failures (private mode, quota) are ignored.
 */
export function createStore<T extends object>(initial: T, opts?: { key?: string; pick?: (s: T) => Partial<T> }): Store<T> {
  let state = initial;
  if (opts?.key) {
    try {
      const raw = localStorage.getItem(opts.key);
      if (raw) state = { ...initial, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
  }
  const listeners = new Set<() => void>();
  let saveTimer: number | undefined;

  const persist = () => {
    if (!opts?.key) return;
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(opts.key!, JSON.stringify(opts.pick ? opts.pick(state) : state));
      } catch {
        /* ignore */
      }
    }, 120);
  };

  return {
    get: () => state,
    set: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
      persist();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** Subscribe to a slice. Selectors must return primitives or references owned by the state. */
export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
