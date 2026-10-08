import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { prefetchDoc, useDoc, useFlatDocs, useManifest } from '../hooks/useResources';
import { Markdown } from '../components/Markdown';
import { QuestionCard } from '../components/QuestionCard';
import { progress, useStatusMap } from '../lib/progress';
import type { ParsedQuestion } from '../lib/types';

type Filter = 'all' | 'hot' | 'todo' | 'review' | 'mastered';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hot', label: '🔥 Hot' },
  { id: 'todo', label: 'Not mastered' },
  { id: 'review', label: '↻ Review' },
  { id: 'mastered', label: '✓ Mastered' },
];

export function DocPage() {
  const { slug = '' } = useParams();
  const location = useLocation();
  const { isLoading: manifestLoading } = useManifest();
  const flat = useFlatDocs();
  const { data: doc, error, isLoading } = useDoc(slug);
  const status = useStatusMap();

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const metaIndex = flat.findIndex((d) => d.slug === slug);
  const meta = metaIndex >= 0 ? flat[metaIndex] : undefined;
  const prev = metaIndex > 0 ? flat[metaIndex - 1] : undefined;
  const next = metaIndex >= 0 && metaIndex < flat.length - 1 ? flat[metaIndex + 1] : undefined;

  useEffect(() => {
    progress.visit(slug);
    setOpenIds(new Set());
    setFilter('all');
    setQuery('');
  }, [slug]);

  // Deep links: /docs/x#q-some-question opens and scrolls to that question
  useEffect(() => {
    if (!doc || !location.hash.startsWith('#q-')) return;
    const id = decodeURIComponent(location.hash.slice(3));
    if (!doc.questions.some((q) => q.id === id)) return;
    setOpenIds((s) => new Set(s).add(id));
    requestAnimationFrame(() => document.getElementById(`q-${id}`)?.scrollIntoView({ block: 'start' }));
  }, [doc, location.hash]);

  const matches = useCallback(
    (q: ParsedQuestion) => {
      const st = status[q.key];
      if (filter === 'hot' && !q.hot) return false;
      if (filter === 'todo' && st === 'mastered') return false;
      if (filter === 'review' && st !== 'review') return false;
      if (filter === 'mastered' && st !== 'mastered') return false;
      const needle = deferredQuery.trim().toLowerCase();
      if (needle && !q.title.toLowerCase().includes(needle) && !q.body.toLowerCase().includes(needle)) return false;
      return true;
    },
    [filter, deferredQuery, status],
  );

  const visibleSections = useMemo(() => {
    if (!doc) return [];
    let n = 0;
    return doc.sections
      .map((s) => ({
        ...s,
        visible: s.questions
          .map((q) => ({ q, index: 0 }))
          .filter(({ q }) => matches(q))
          .map((x) => ({ ...x, index: ++n })),
      }))
      .filter((s) => s.visible.length || (filter === 'all' && !deferredQuery && s.intro));
  }, [doc, matches, filter, deferredQuery]);

  const toggle = useCallback((id: string) => {
    setOpenIds((s) => {
      const nx = new Set(s);
      if (nx.has(id)) nx.delete(id);
      else nx.add(id);
      return nx;
    });
  }, []);

  if (error) {
    return (
      <div className="page">
        <div className="empty-state">
          <h1>Document not found</h1>
          <p>
            <code>{slug}</code> could not be loaded ({String(error.message ?? error)}).
          </p>
          <Link to="/">← Back to the dashboard</Link>
        </div>
      </div>
    );
  }

  if (isLoading || manifestLoading || !doc) {
    return (
      <div className="page">
        <div className="skeleton h1" />
        <div className="skeleton p" />
        <div className="skeleton card" />
        <div className="skeleton card" />
        <div className="skeleton card" />
      </div>
    );
  }

  const total = doc.questions.length;
  const mastered = doc.questions.filter((q) => status[q.key] === 'mastered').length;
  const hotCount = doc.questions.filter((q) => q.hot).length;
  const allVisibleIds = visibleSections.flatMap((s) => s.visible.map((v) => v.q.id));
  const allOpen = allVisibleIds.length > 0 && allVisibleIds.every((id) => openIds.has(id));

  return (
    <div className="page doc-page">
      <div className="doc-main">
        <nav className="crumbs">
          <Link to="/">Dashboard</Link> <span>/</span> <span>{meta?.category.title ?? 'Docs'}</span>
        </nav>
        <header className="doc-header">
          <h1>{meta?.title ?? doc.title}</h1>
          {meta?.description && <p className="lede">{meta.description}</p>}
          <div className="doc-meta">
            {meta && <span className={`badge lvl-${meta.level.toLowerCase()}`}>{meta.level}</span>}
            <span className="badge">{total} questions</span>
            {hotCount > 0 && <span className="badge hot">🔥 {hotCount} hot</span>}
            <span className="badge">≈ {Math.max(1, Math.round(doc.words / 200))} min read</span>
            {meta?.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          <div className="progress-line" title={`${mastered} of ${total} mastered`}>
            <div className="progress-fill" style={{ width: `${total ? (mastered / total) * 100 : 0}%` }} />
          </div>
          <p className="muted small">
            {mastered} / {total} mastered
          </p>
        </header>

        {doc.intro && (
          <div className="doc-intro">
            <Markdown>{doc.intro}</Markdown>
          </div>
        )}

        <div className="doc-toolbar">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Filter ${total} questions…`}
            aria-label="Filter questions in this document"
          />
          <div className="chips" role="group" aria-label="Filter">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={`chip-btn${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setOpenIds(allOpen ? new Set() : new Set(allVisibleIds))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        {visibleSections.length === 0 && <p className="empty-state">No questions match this filter.</p>}

        {visibleSections.map((s) => (
          <section key={s.id} id={s.id} className="doc-section">
            <h2>
              <a href={`#${s.id}`} className="anchor">
                {s.title}
              </a>
            </h2>
            {s.intro && filter === 'all' && !deferredQuery && <Markdown>{s.intro}</Markdown>}
            {s.visible.map(({ q, index }) => (
              <QuestionCard key={q.id} q={q} index={index} open={openIds.has(q.id)} onToggle={toggle} />
            ))}
          </section>
        ))}

        <nav className="pager">
          {prev ? (
            <Link to={`/docs/${prev.slug}`} className="pager-link" onMouseEnter={() => prefetchDoc(prev.slug)}>
              <small>← Previous</small>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link to={`/docs/${next.slug}`} className="pager-link next" onMouseEnter={() => prefetchDoc(next.slug)}>
              <small>Next →</small>
              {next.title}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>

      <aside className="toc" aria-label="On this page">
        <p className="toc-title">On this page</p>
        {doc.sections.map((s) => {
          const done = s.questions.filter((q) => status[q.key] === 'mastered').length;
          return (
            <a key={s.id} href={`#${s.id}`} className="toc-link">
              <span>{s.title}</span>
              <span className="toc-count">
                {done}/{s.questions.length}
              </span>
            </a>
          );
        })}
      </aside>
    </div>
  );
}
