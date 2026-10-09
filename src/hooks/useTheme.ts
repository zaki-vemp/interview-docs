import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type ThemeMode = Theme | 'system';
export type Palette = 'sage' | 'ocean' | 'mint';
export type Density = 'comfortable' | 'compact';
interface Appearance {
  mode: ThemeMode;
  palette: Palette;
  density: Density;
}
const KEY = 'ipd:appearance:v1';
const defaults: Appearance = { mode: 'system', palette: 'sage', density: 'comfortable' };
const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function readAppearance(): Appearance {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    const legacy = localStorage.getItem('ipd:theme');
    return {
      mode: ['light', 'dark', 'system'].includes(data?.mode)
        ? data.mode
        : legacy === 'light' || legacy === 'dark'
          ? legacy
          : 'system',
      palette: ['sage', 'ocean', 'mint'].includes(data?.palette) ? data.palette : 'sage',
      density: ['comfortable', 'compact'].includes(data?.density) ? data.density : 'comfortable',
    };
  } catch {
    return defaults;
  }
}

export function useTheme() {
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme =
        appearance.mode === 'system' ? (media.matches ? 'dark' : 'light') : appearance.mode;
      root.dataset.palette = appearance.palette;
      root.dataset.density = appearance.density;
    };
    apply();
    media.addEventListener('change', apply);
    try {
      localStorage.setItem(KEY, JSON.stringify(appearance));
    } catch {
      /* Storage is optional. */
    }
    return () => media.removeEventListener('change', apply);
  }, [appearance]);
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === KEY) setAppearance(readAppearance());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const setMode = useCallback((mode: ThemeMode) => setAppearance((s) => ({ ...s, mode })), []);
  const setPalette = useCallback((palette: Palette) => setAppearance((s) => ({ ...s, palette })), []);
  const setDensity = useCallback((density: Density) => setAppearance((s) => ({ ...s, density })), []);
  const reset = useCallback(() => setAppearance(defaults), []);
  return { ...appearance, setMode, setPalette, setDensity, reset };
}

export function useThemeValue(): Theme {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : document.documentElement.dataset.theme === 'light'
        ? 'light'
        : systemTheme(),
  );
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'),
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  return theme;
}
