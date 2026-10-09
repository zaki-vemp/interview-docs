import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import type { useTheme, ThemeMode, Palette, Density } from '../hooks/useTheme';

const modes: { id: ThemeMode; label: string; icon: IconName }[] = [
  { id: 'light', label: 'Light', icon: 'sun' },
  { id: 'dark', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'Auto', icon: 'monitor' },
];
const palettes: { id: Palette; label: string; description: string }[] = [
  { id: 'sage', label: 'Soft green', description: 'Quiet & grounded' },
  { id: 'ocean', label: 'Ocean blue', description: 'Clear & focused' },
  { id: 'mint', label: 'Blue + mint', description: 'A hint of green' },
];

export function AppearancePanel({
  appearance,
  onClose,
}: {
  appearance: ReturnType<typeof useTheme>;
  onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    if (window.matchMedia('(max-width: 860px)').matches) panel.current?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <aside
      ref={panel}
      className="appearance-panel"
      id="appearance-panel"
      aria-label="Appearance settings"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="appearance-heading">
        <h2>Appearance</h2>
        <button type="button" className="icon-btn" aria-label="Close appearance panel" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      <p className="muted small">Make this space feel like yours.</p>
      <fieldset className="appearance-group">
        <legend>Color mode</legend>
        <div className="mode-options">
          {modes.map((m) => (
            <button
              type="button"
              key={m.id}
              className="mode-option"
              aria-pressed={appearance.mode === m.id}
              onClick={() => appearance.setMode(m.id)}
            >
              <span className={`mode-preview mode-${m.id}`} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span>
                <Icon name={m.icon} />
                {m.label}
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="appearance-group">
        <legend>Accent palette</legend>
        <div className="palette-options">
          {palettes.map((p) => (
            <button
              type="button"
              key={p.id}
              className="palette-option"
              aria-pressed={appearance.palette === p.id}
              onClick={() => appearance.setPalette(p.id)}
            >
              <span className={`palette-swatch palette-${p.id}`} aria-hidden="true" />
              <span>
                <b>{p.label}</b>
                <small>{p.description}</small>
              </span>
              <Icon name="check" />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="appearance-group">
        <legend>Content spacing</legend>
        <div className="density-options">
          {(['comfortable', 'compact'] as Density[]).map((d) => (
            <button
              type="button"
              key={d}
              aria-pressed={appearance.density === d}
              onClick={() => appearance.setDensity(d)}
            >
              {d === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="appearance-sample">
        <p className="eyebrow">Your palette</p>
        <div aria-hidden="true" className="palette-bars">
          <span />
          <span />
          <span />
        </div>
        <p className="muted small" aria-live="polite">
          {palettes.find((p) => p.id === appearance.palette)?.label} ·{' '}
          {modes.find((m) => m.id === appearance.mode)?.label}
        </p>
      </div>
      <button type="button" className="link-btn appearance-reset" onClick={appearance.reset}>
        <Icon name="review" /> Reset appearance
      </button>
      <p className="muted small appearance-storage">Your preferences are saved on this device.</p>
      <Link to="/settings" className="settings-link">
        Progress & settings <Icon name="external" />
      </Link>
    </aside>
  );
}
