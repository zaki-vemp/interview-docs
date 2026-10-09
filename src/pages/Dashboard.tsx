import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { prefetchDoc, useManifest, useProfile } from '../hooks/useResources';
import { useProgress } from '../lib/progress';
import { Icon } from '../components/Icon';
import type { DocMeta } from '../lib/types';

export function Dashboard() {
  const { data: manifest, error, isLoading } = useManifest();
  const { data: profile } = useProfile();
  const status = useProgress((s) => s.status);
  const visited = useProgress((s) => s.visited);
  const allDocs = useMemo(() => manifest?.categories.flatMap((c) => c.docs) ?? [], [manifest]);
  const doneBySlug = useMemo(() => {
    const result: Record<string, number> = {};
    Object.entries(status).forEach(([key, value]) => {
      if (value === 'mastered') {
        const slug = key.split('/')[0];
        result[slug] = (result[slug] ?? 0) + 1;
      }
    });
    return result;
  }, [status]);
  const mastered = allDocs.reduce((n, d) => n + Math.min(doneBySlug[d.slug] ?? 0, d.questions ?? 0), 0);
  const total = allDocs.reduce((n, d) => n + (d.questions ?? 0), 0);
  const review = Object.values(status).filter((s) => s === 'review').length;
  const recent = Object.entries(visited)
    .sort((a, b) => b[1] - a[1])
    .map(([slug]) => allDocs.find((d) => d.slug === slug))
    .filter((d): d is DocMeta => !!d);
  const continuing = recent.find((d) => (doneBySlug[d.slug] ?? 0) < (d.questions ?? 0));
  const focus = continuing ?? allDocs.find((d) => d.slug === 'elevator-pitch');
  const reading = recent.length
    ? recent.slice(0, 3)
    : ['react-internals', 'javascript-core', 'elevator-pitch']
        .map((slug) => allDocs.find((d) => d.slug === slug))
        .filter((d): d is DocMeta => !!d);
  const plan = profile?.studyPlan ?? [];
  const dayDone = (docs: string[]) =>
    docs.length > 0 &&
    docs.every((slug) => {
      const d = allDocs.find((d) => d.slug === slug);
      return d && (d.questions ?? 0) > 0 && (doneBySlug[slug] ?? 0) >= (d.questions ?? 0);
    });
  const nextDayIndex = plan.findIndex((p) => !dayDone(p.docs));
  const dayIndex = Math.max(0, nextDayIndex === -1 ? plan.length - 1 : nextDayIndex);
  if (error)
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Your study desk is taking a moment.</h1>
          <p>We couldn’t load your topics. Refresh the page to try again.</p>
        </div>
      </div>
    );
  if (isLoading || !manifest)
    return (
      <div className="page study-desk">
        <div className="skeleton h1" />
        <div className="skeleton p" />
        <div className="skeleton study-skel" />
      </div>
    );
  return (
    <div className="page study-desk">
      <div className="desk-greeting">
        <p className="eyebrow">Your study desk</p>
        {profile && <span className="muted small">Welcome, {profile.name}</span>}
      </div>
      <h1 className="desk-title">
        Make space for
        <br />
        <em>better answers.</em>
      </h1>
      <p className="lede">A calm place to work through your next interview.</p>
      <div className="desk-status">
        <span>
          <Icon name="check" />
          <b>{mastered}</b> / {total} mastered
        </span>
        <Link to="/saved?tab=review">
          <Icon name="review" />
          <b>{review}</b> to revisit
        </Link>
        <Link to="/topics">
          {allDocs.length} topics to explore <Icon name="external" />
        </Link>
      </div>
      <div className="desk-focus-layout">
        {focus && (
          <article className="desk-session">
            <p className="eyebrow">{continuing ? 'Continue preparing' : 'Today’s focus'}</p>
            <h2>{continuing ? 'Pick up where you left off.' : 'Start with your story.'}</h2>
            <p className="muted">
              {continuing ? (
                focus.title
              ) : (
                <>
                  You already have the experience.
                  <br />
                  Let’s make it easier to talk about.
                </>
              )}
            </p>
            <div className="session-meta">
              <span>{focus.level}</span>
              <span>{focus.questions} questions</span>
              <span>{focus.minutes} min</span>
            </div>
            <Link
              to={`/docs/${focus.slug}`}
              className="btn-primary"
              onMouseEnter={() => prefetchDoc(focus.slug)}
              onFocus={() => prefetchDoc(focus.slug)}
            >
              {continuing ? 'Continue reading' : 'Open your introduction'}
              <Icon name="arrow" />
            </Link>
            <div className="session-footnote">
              <Icon name="leaf" />
              <span>One topic at a time is a good pace.</span>
            </div>
          </article>
        )}
        <aside className="desk-path" aria-label="Suggested study path">
          <div className="section-heading">
            <h2>A suggested path</h2>
            {plan.length > 0 && <span className="muted small">{plan.length} days</span>}
          </div>
          {plan.slice(dayIndex, dayIndex + 3).map((p, i) => (
            <Link
              key={p.day}
              to={`/plan#day-${dayIndex + i + 1}`}
              className={`path-step${i === 0 ? ' current' : ''}`}
            >
              <span className="path-number">{dayIndex + i + 1}</span>
              <span>
                <b>{p.day}</b>
                <small>{p.focus}</small>
              </span>
            </Link>
          ))}
          <Link to="/plan" className="text-link">
            See your full plan <Icon name="external" />
          </Link>
        </aside>
      </div>
      <section className="desk-reading">
        <div className="section-heading">
          <h2>{recent.length ? 'Continue reading' : 'On your reading list'}</h2>
          <Link to="/topics" className="text-link">
            Explore all topics <Icon name="external" />
          </Link>
        </div>
        <div className="reading-list">
          {reading.map((d, i) => (
            <Link
              key={d.slug}
              to={`/docs/${d.slug}`}
              className="reading-row"
              onMouseEnter={() => prefetchDoc(d.slug)}
              onFocus={() => prefetchDoc(d.slug)}
            >
              <span className="reading-number">{String(i + 1).padStart(2, '0')}</span>
              <span className="reading-description">
                <b>{d.title}</b>
                <small>
                  {d.questions} questions · {doneBySlug[d.slug] ?? 0} mastered
                </small>
              </span>
              <span className="reading-time">{d.minutes} min</span>
              <Icon name="external" />
            </Link>
          ))}
        </div>
      </section>
      <div className="practice-invitation">
        <span className="invitation-icon">
          <Icon name="play" />
        </span>
        <div>
          <h2>A rehearsal for the real thing.</h2>
          <p className="muted small">
            Answer out loud. Compare with the reference. Find what needs another look.
          </p>
        </div>
        <Link to="/practice" className="btn-ghost">
          Try a mock interview <Icon name="arrow" />
        </Link>
      </div>
      <footer className="desk-footer">
        <span>
          <span className="storage-dot" />
          Progress saved on this device
        </span>
        <Link to="/settings">
          Progress & settings <Icon name="external" />
        </Link>
      </footer>
    </div>
  );
}
