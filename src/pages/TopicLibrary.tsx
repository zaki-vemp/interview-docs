import { useDeferredValue, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFlatDocs, useManifest, prefetchDoc } from '../hooks/useResources';
import { useStatusMap } from '../lib/progress';
import { Icon, categoryIcon } from '../components/Icon';

export function TopicLibrary() {
  const { data: manifest, error, isLoading } = useManifest();
  const docs = useFlatDocs();
  const status = useStatusMap();
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? 'all';
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [level, setLevel] = useState('all');
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(status).forEach(([key, s]) => {
      if (s === 'mastered') {
        const slug = key.split('/')[0];
        map[slug] = (map[slug] ?? 0) + 1;
      }
    });
    return map;
  }, [status]);
  const shown = docs.filter(
    (d) =>
      (category === 'all' || d.category.id === category) &&
      (level === 'all' || d.level === level) &&
      `${d.title} ${d.description} ${d.tags.join(' ')}`.toLowerCase().includes(deferred.toLowerCase().trim()),
  );
  return (
    <div className="page library-page">
      <p className="eyebrow">Explore your stack</p>
      <h1>Your topic library.</h1>
      <p className="lede">Your career story, your core skills, and the questions that matter.</p>
      <div className="library-toolbar">
        <label className="library-search">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a topic…"
            aria-label="Filter topics"
          />
        </label>
        <label className="filter-select">
          Category
          <select
            value={category}
            onChange={(e) => setParams(e.target.value === 'all' ? {} : { category: e.target.value })}
          >
            <option value="all">All categories</option>
            {manifest?.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-select">
          Level
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="all">All levels</option>
            {['Core', 'Advanced', 'Expert'].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="empty-state">We couldn’t load the library. Refresh to try again.</p>}
      {isLoading ? (
        <div className="skeleton study-skel" />
      ) : (
        !error && (
          <>
            <p className="muted small library-result" aria-live="polite">
              {shown.length} of {docs.length} topics · {shown.reduce((n, d) => n + (d.questions ?? 0), 0)}{' '}
              questions
            </p>
            {shown.length === 0 && (
              <div className="empty-state">
                <h2>No topics match just yet.</h2>
                <p>Try a different term or clear the filters.</p>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setQuery('');
                    setLevel('all');
                    setParams({});
                  }}
                >
                  Clear filters
                </button>
              </div>
            )}
            <div className="doc-grid">
              {shown.map((d) => {
                const done = Math.min(counts[d.slug] ?? 0, d.questions ?? 0);
                return (
                  <Link
                    key={d.slug}
                    to={`/docs/${d.slug}`}
                    className="doc-card"
                    onMouseEnter={() => prefetchDoc(d.slug)}
                    onFocus={() => prefetchDoc(d.slug)}
                  >
                    <span className="doc-card-top">
                      <span className="topic-icon">
                        <Icon name={categoryIcon(d.category.id)} />
                      </span>
                      <span className={`badge lvl-${d.level.toLowerCase()}`}>{d.level}</span>
                    </span>
                    <span className="doc-card-category">{d.category.title}</span>
                    <span className="doc-card-title">{d.title}</span>
                    <span className="doc-card-desc">{d.description}</span>
                    <span className="doc-card-foot">
                      <span>
                        {d.questions} questions · {d.minutes} min
                      </span>
                      <Icon name="external" />
                    </span>
                    {done > 0 && (
                      <span className="topic-progress">
                        <span className="progress-line">
                          <span
                            className="progress-fill"
                            style={{ width: `${(done / (d.questions || 1)) * 100}%` }}
                          />
                        </span>
                        <small>
                          {done} / {d.questions} mastered
                        </small>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </>
        )
      )}
    </div>
  );
}
