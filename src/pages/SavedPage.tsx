import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAllDocs, useFlatDocs } from '../hooks/useResources';
import { progress, useProgress } from '../lib/progress';
import { Icon } from '../components/Icon';

type Tab = 'bookmarks' | 'review' | 'notes';
const tabs: { id: Tab; label: string }[] = [
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'review', label: 'To revisit' },
  { id: 'notes', label: 'Your notes' },
];
const empty = {
  bookmarks: { title: 'Keep a few answers close.', text: 'Bookmark any question to return to it here.' },
  review: {
    title: 'Room for another look.',
    text: 'Mark a question for review while reading or practicing. Your next revision list will be waiting here.',
  },
  notes: {
    title: 'Make the answers your own.',
    text: 'Add notes beneath an answer: a project example, a useful number, or a phrase that sounds like you.',
  },
};

export function SavedPage() {
  const { data: docs, isLoading, error } = useAllDocs();
  const flat = useFlatDocs();
  const bookmarks = useProgress((s) => s.bookmarks);
  const status = useProgress((s) => s.status);
  const notes = useProgress((s) => s.notes);
  const [params, setParams] = useSearchParams();
  const tab: Tab =
    params.get('tab') === 'review' ? 'review' : params.get('tab') === 'notes' ? 'notes' : 'bookmarks';

  const lookup = useMemo(() => {
    const m = new Map<string, { slug: string; id: string; title: string; doc: string }>();
    docs?.forEach((d) => {
      const title = flat.find((f) => f.slug === d.slug)?.title ?? d.title;
      d.questions.forEach((q) => m.set(q.key, { slug: d.slug, id: q.id, title: q.title, doc: title }));
    });
    return m;
  }, [docs, flat]);

  const keys = (
    tab === 'bookmarks'
      ? Object.entries(bookmarks)
          .sort((a, b) => b[1] - a[1])
          .map(([k]) => k)
      : tab === 'review'
        ? Object.keys(status).filter((k) => status[k] === 'review')
        : Object.keys(notes)
  ).filter((k) => lookup.has(k));
  const counts = {
    bookmarks: Object.keys(bookmarks).filter((k) => lookup.has(k)).length,
    review: Object.keys(status).filter((k) => status[k] === 'review' && lookup.has(k)).length,
    notes: Object.keys(notes).filter((k) => lookup.has(k)).length,
  };

  return (
    <div className="page narrow">
      <p className="eyebrow">For your next session</p>
      <h1>Your saved answers.</h1>
      <p className="lede">The questions you want to keep, revisit, or explain in your own words.</p>
      <div className="chips" role="group" aria-label="Saved question filters">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip-btn${tab === t.id ? ' on' : ''}`}
            aria-pressed={tab === t.id}
            onClick={() => setParams(t.id === 'bookmarks' ? {} : { tab: t.id })}
          >
            {t.label} ({counts[t.id]})
          </button>
        ))}
      </div>
      {(isLoading || !docs) && !error && (
        <p className="muted" role="status">
          Finding your saved questions…
        </p>
      )}
      {error && (
        <p className="empty-state" role="alert">
          We couldn’t load your saved questions. Refresh to try again.
        </p>
      )}
      {docs && !isLoading && !error && keys.length === 0 && (
        <div className="empty-state">
          <Icon name={tab === 'bookmarks' ? 'bookmark' : tab === 'review' ? 'review' : 'book'} />
          <h2>{empty[tab].title}</h2>
          <p>{empty[tab].text}</p>
          <Link to="/topics" className="btn-ghost">
            Explore your topics <Icon name="arrow" />
          </Link>
        </div>
      )}
      <ul className="saved-list">
        {keys.map((k) => {
          const item = lookup.get(k)!;
          return (
            <li key={k}>
              <Link className="saved-title" to={`/docs/${item.slug}#q-${item.id}`}>
                {item.title}
              </Link>
              <span className="muted saved-meta">{item.doc}</span>
              {tab === 'notes' && <p className="saved-note">{notes[k]}</p>}
              {tab === 'bookmarks' && (
                <button
                  type="button"
                  className="link-btn"
                  aria-label={`Remove bookmark: ${item.title}`}
                  onClick={() => progress.toggleBookmark(k)}
                >
                  Remove bookmark
                </button>
              )}
              {tab === 'review' && (
                <button
                  type="button"
                  className="link-btn"
                  aria-label={`Mark mastered: ${item.title}`}
                  onClick={() => progress.setStatus(k, 'mastered', false)}
                >
                  Mark mastered
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
