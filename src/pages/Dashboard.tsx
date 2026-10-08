import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { prefetchDoc, useManifest, useProfile } from '../hooks/useResources';
import { progress, useProgress } from '../lib/progress';
import { playground } from '../lib/playgroundStore';

export function Dashboard() {
  const { data: manifest, error } = useManifest();
  const { data: profile } = useProfile();
  const status = useProgress((s) => s.status);
  const visited = useProgress((s) => s.visited);
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const masteredBySlug = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [k, s] of Object.entries(status)) if (s === 'mastered') m[k.split('/')[0]] = (m[k.split('/')[0]] ?? 0) + 1;
    return m;
  }, [status]);

  const allDocs = manifest?.categories.flatMap((c) => c.docs) ?? [];
  const totalQ = allDocs.reduce((n, d) => n + (d.questions ?? 0), 0);
  const totalHot = allDocs.reduce((n, d) => n + (d.hot ?? 0), 0);
  const mastered = Object.values(status).filter((s) => s === 'mastered').length;
  const review = Object.values(status).filter((s) => s === 'review').length;
  const recent = Object.entries(visited)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([slug]) => allDocs.find((d) => d.slug === slug))
    .filter(Boolean);

  const exportProgress = () => {
    const blob = new Blob([progress.exportJson()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interview-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importProgress = async (file: File) => {
    try {
      progress.importJson(await file.text());
      setMsg('Progress imported.');
    } catch {
      setMsg('That file is not a valid progress export.');
    }
  };

  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Interview preparation · {profile ? `${profile.years}+ years` : '…'}</p>
          <h1>{profile ? `${profile.name}` : 'Interview Prep Docs'}</h1>
          <p className="lede">
            {profile?.title ?? 'Senior Frontend / Full Stack Developer'} — every question an interviewer can reasonably ask about the
            resume, with detailed reference answers, runnable code and a floating JavaScript playground.
          </p>
          <div className="row-gap">
            <Link to="/docs/elevator-pitch" className="btn-primary">
              Start with “Tell me about yourself”
            </Link>
            <Link to="/practice" className="btn-ghost">
              🎯 Mock interview
            </Link>
            <button type="button" className="btn-ghost" onClick={playground.open}>
              {'{ }'} Open playground
            </button>
          </div>
        </div>
        <div className="hero-stats">
          <div className="stat">
            <b>{allDocs.length}</b>
            <span>documents</span>
          </div>
          <div className="stat">
            <b>{totalQ}</b>
            <span>questions</span>
          </div>
          <div className="stat">
            <b>{totalHot}</b>
            <span>🔥 frequently asked</span>
          </div>
          <div className="stat">
            <b>{mastered}</b>
            <span>mastered</span>
          </div>
          <div className="stat">
            <b>{review}</b>
            <span>to review</span>
          </div>
          <div className="progress-line big" title={`${mastered} / ${totalQ}`}>
            <div className="progress-fill" style={{ width: `${totalQ ? (mastered / totalQ) * 100 : 0}%` }} />
          </div>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="dash-section">
          <h2>Continue reading</h2>
          <div className="recent-row">
            {recent.map((d) => (
              <Link key={d!.slug} to={`/docs/${d!.slug}`} className="recent-card">
                {d!.title}
              </Link>
            ))}
          </div>
        </section>
      )}

      {error && <p className="empty-state">Could not load resources/manifest.json — is the dev server running?</p>}

      {manifest?.categories.map((c) => (
        <section key={c.id} className="dash-section">
          <h2>
            <span aria-hidden>{c.icon}</span> {c.title}
          </h2>
          <p className="muted">{c.description}</p>
          <div className="doc-grid">
            {c.docs.map((d) => {
              const done = masteredBySlug[d.slug] ?? 0;
              const total = d.questions ?? 0;
              return (
                <Link key={d.slug} to={`/docs/${d.slug}`} className="doc-card" onMouseEnter={() => prefetchDoc(d.slug)}>
                  <span className="doc-card-top">
                    <span className={`badge lvl-${d.level.toLowerCase()}`}>{d.level}</span>
                    <span className="muted small">{total} Q · {d.minutes} min</span>
                  </span>
                  <span className="doc-card-title">{d.title}</span>
                  <span className="doc-card-desc">{d.description}</span>
                  <span className="progress-line">
                    <span className="progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}

      {profile && (
        <section className="dash-section two-col">
          <div>
            <h2>📅 Suggested study plan</h2>
            <ol className="plan">
              {profile.studyPlan.map((p) => (
                <li key={p.day}>
                  <b>{p.day}</b> — {p.focus}
                  <div className="plan-links">
                    {p.docs.map((slug) => {
                      const d = allDocs.find((x) => x.slug === slug);
                      return d ? (
                        <Link key={slug} to={`/docs/${slug}`} className="tag">
                          {d.title}
                        </Link>
                      ) : null;
                    })}
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2>🧰 Skills on the resume</h2>
            {profile.skills.map((g) => (
              <div key={g.group} className="skill-group">
                <p className="muted small">{g.group}</p>
                <div className="tags">
                  {g.items.map((s) => (
                    <span key={s} className="tag">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <h2 className="mt">⌨ Shortcuts</h2>
            <ul className="shortcuts">
              <li>
                <kbd>Ctrl K</kbd> or <kbd>/</kbd> search all questions
              </li>
              <li>
                <kbd>Ctrl `</kbd> toggle the playground
              </li>
              <li>
                <kbd>Ctrl Enter</kbd> run code in the playground
              </li>
              <li>
                <kbd>Space</kbd> / <kbd>M</kbd> / <kbd>R</kbd> / <kbd>N</kbd> in mock interviews
              </li>
            </ul>
            <h2 className="mt">💾 Your progress</h2>
            <p className="muted small">Stored in this browser (localStorage). Export it to move between machines.</p>
            <div className="row-gap">
              <button type="button" className="btn-ghost btn-sm" onClick={exportProgress}>
                Export
              </button>
              <button type="button" className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                Import
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm danger"
                onClick={() => {
                  if (window.confirm('Reset all progress, bookmarks and notes?')) progress.reset();
                }}
              >
                Reset
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importProgress(f);
                  e.target.value = '';
                }}
              />
            </div>
            {msg && <p className="small">{msg}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
