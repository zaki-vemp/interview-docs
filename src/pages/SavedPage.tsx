import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAllDocs, useFlatDocs } from '../hooks/useResources';
import { progress, useProgress } from '../lib/progress';

type Tab = 'bookmarks' | 'review' | 'notes';

export function SavedPage() {
  const { data: docs, isLoading } = useAllDocs();
  const flat = useFlatDocs();
  const bookmarks = useProgress((s) => s.bookmarks);
  const status = useProgress((s) => s.status);
  const notes = useProgress((s) => s.notes);
  const [tab, setTab] = useState<Tab>('bookmarks');

  const lookup = useMemo(() => {
    const m = new Map<string, { slug: string; id: string; title: string; doc: string }>();
    docs?.forEach((d) => {
      const title = flat.find((f) => f.slug === d.slug)?.title ?? d.title;
      d.questions.forEach((q) => m.set(q.key, { slug: d.slug, id: q.id, title: q.title, doc: title }));
    });
    return m;
  }, [docs, flat]);

  const keys =
    tab === 'bookmarks'
      ? Object.entries(bookmarks).sort((a, b) => b[1] - a[1]).map(([k]) => k)
      : tab === 'review'
        ? Object.keys(status).filter((k) => status[k] === 'review')
        : Object.keys(notes);

  const counts = {
    bookmarks: Object.keys(bookmarks).length,
    review: Object.values(status).filter((s) => s === 'review').length,
    notes: Object.keys(notes).length,
  };

  return (
    <div className="page narrow">
      <h1>Saved &amp; review</h1>
      <div className="chips">
        {(['bookmarks', 'review', 'notes'] as Tab[]).map((t) => (
          <button key={t} type="button" className={`chip-btn${tab === t ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t === 'bookmarks' ? '★ Bookmarked' : t === 'review' ? '↻ Needs review' : '✎ With my notes'} ({counts[t]})
          </button>
        ))}
      </div>
      {isLoading && <p className="muted">Loading…</p>}
      {!isLoading && keys.length === 0 && (
        <p className="empty-state">
          Nothing here yet. Use ☆, ↻ Review and “Add my notes” on any question — or run a <Link to="/practice">mock interview</Link>.
        </p>
      )}
      <ul className="saved-list">
        {keys.map((k) => {
          const item = lookup.get(k);
          if (!item) return null;
          return (
            <li key={k}>
              <Link to={`/docs/${item.slug}#q-${item.id}`}>{item.title}</Link>
              <span className="muted small"> · {item.doc}</span>
              {tab === 'notes' && <p className="saved-note">{notes[k]}</p>}
              {tab === 'bookmarks' && (
                <button type="button" className="link-btn small" onClick={() => progress.toggleBookmark(k)}>
                  remove
                </button>
              )}
              {tab === 'review' && (
                <button type="button" className="link-btn small" onClick={() => progress.setStatus(k, 'mastered')}>
                  mark mastered
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
