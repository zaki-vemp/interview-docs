import { useRef, useState } from 'react';
import { progress } from '../lib/progress';
import { useProfile } from '../hooks/useResources';
import { Icon } from '../components/Icon';

export function SettingsPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const { data: profile } = useProfile();
  const exportProgress = () => {
    const blob = new Blob([progress.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interview-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMessage('Progress exported. Keep the file for your next browser or device.');
  };
  const importProgress = async (file: File) => {
    try {
      progress.importJson(await file.text());
      setMessage('Your progress has been imported.');
    } catch {
      setMessage('That file isn’t a valid progress export. Try the original JSON file.');
    }
  };
  return (
    <div className="page narrow">
      <p className="eyebrow">Your workspace</p>
      <h1>Progress & settings.</h1>
      <p className="lede">Keep your preparation with you, wherever you study.</p>
      <section className="settings-section">
        <h2>Your progress stays with you.</h2>
        <p className="muted">
          Notes, bookmarks, and question progress are saved in this browser. Export a backup to move them to
          another device. Importing a backup replaces the progress on this device.
        </p>
        <div className="row-gap">
          <button type="button" className="btn-primary" onClick={exportProgress}>
            Export progress <Icon name="external" />
          </button>
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            Import a backup
          </button>
          <input
            ref={fileRef}
            hidden
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importProgress(f);
              e.target.value = '';
            }}
          />
        </div>
        {message && (
          <p role="status" className="settings-feedback">
            {message}
          </p>
        )}
      </section>
      <section className="settings-section">
        <h2>Make the workspace yours.</h2>
        <p className="muted">
          Use Appearance in the header for light or dark mode, a green or blue palette, and comfortable or
          compact spacing.
        </p>
      </section>
      <section className="settings-section">
        <h2>A few useful shortcuts.</h2>
        <ul className="shortcuts">
          <li>
            <kbd>Ctrl K</kbd> or <kbd>/</kbd>
            <span>Find a question</span>
          </li>
          <li>
            <kbd>Ctrl `</kbd>
            <span>Open the playground</span>
          </li>
          <li>
            <kbd>Ctrl Enter</kbd>
            <span>Run code in the playground</span>
          </li>
          <li>
            <kbd>Space</kbd> / <kbd>M</kbd> / <kbd>R</kbd> / <kbd>N</kbd>
            <span>Reveal, master, review, or skip during practice</span>
          </li>
        </ul>
      </section>
      {profile && (
        <details className="settings-section">
          <summary>Skills on your resume</summary>
          {profile.skills.map((g) => (
            <div className="skill-group" key={g.group}>
              <p className="muted small">{g.group}</p>
              <div className="tags">
                {g.items.map((s) => (
                  <span className="tag" key={s}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </details>
      )}
      <section className="settings-section reset-section">
        <h2>A fresh start.</h2>
        <p className="muted">
          Reset clears your question progress, bookmarks, notes, and reading history on this device.
        </p>
        <button
          type="button"
          className="btn-ghost danger"
          onClick={() => {
            if (
              window.confirm(
                'Clear all progress, bookmarks, notes, and reading history? This cannot be undone.',
              )
            ) {
              progress.reset();
              setMessage('Your progress has been reset.');
            }
          }}
        >
          Reset progress
        </button>
      </section>
    </div>
  );
}
