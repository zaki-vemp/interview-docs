import { useEffect } from 'react';

/** Global keyboard shortcuts. `combo` like "mod+k", "mod+`", "/" */
export function useHotkey(combo: string, handler: (e: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts.pop()!;
    const needMod = parts.includes('mod');
    const needShift = parts.includes('shift');
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (needMod !== mod || needShift !== e.shiftKey) return;
      if (e.key.toLowerCase() !== key && e.code.toLowerCase() !== `key${key}` && !(key === '`' && e.code === 'Backquote')) return;
      if (!needMod) {
        const t = e.target as HTMLElement | null;
        if (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return;
      }
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, handler, enabled]);
}
