import { useDeferredValue, useMemo, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAllDocs, useFlatDocs } from '../hooks/useResources';

interface Hit {
  slug: string;
  docTitle: string;
  category: string;
  qid: string;
  title: string;
  hot: boolean;
  score: number;
  snippet: string;
}

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`|[\]()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function highlight(text: string, terms: string[]): ReactNode {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  const deferred = useDeferredValue(q);
  const { data: docs, isLoading, error } = useAllDocs();
  const flat = useFlatDocs();

  const terms = useMemo(
    () =>
      deferred
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    [deferred],
  );

  const index = useMemo(
    () =>
      (docs ?? []).flatMap((d) => {
        const meta = flat.find((f) => f.slug === d.slug);
        return d.questions.map((qq) => ({
          q: qq,
          slug: d.slug,
          docTitle: meta?.title ?? d.title,
          category: meta?.category.title ?? '',
          titleLc: qq.title.toLowerCase(),
          text: plain(qq.body),
        }));
      }),
    [docs, flat],
  );

  const hits = useMemo<Hit[]>(() => {
    if (!terms.length) return [];
    const out: Hit[] = [];
    for (const item of index) {
      const textLc = item.text.toLowerCase();
      let score = 0;
      let ok = true;
      for (const t of terms) {
        const inTitle = item.titleLc.includes(t);
        const inBody = textLc.includes(t);
        if (!inTitle && !inBody && !item.docTitle.toLowerCase().includes(t)) {
          ok = false;
          break;
        }
        score += (inTitle ? 10 : 0) + (inBody ? 2 : 0) + (item.docTitle.toLowerCase().includes(t) ? 1 : 0);
      }
      if (!ok) continue;
      if (item.titleLc.includes(terms.join(' '))) score += 15;
      if (item.q.hot) score += 2;
      const pos = Math.max(
        0,
        ...terms
          .map((t) => textLc.indexOf(t))
          .filter((p) => p >= 0)
          .slice(0, 1),
      );
      const start = Math.max(0, pos - 70);
      const snippet =
        (start > 0 ? '… ' : '') +
        item.text.slice(start, start + 220) +
        (item.text.length > start + 220 ? ' …' : '');
      out.push({
        slug: item.slug,
        docTitle: item.docTitle,
        category: item.category,
        qid: item.q.id,
        title: item.q.title,
        hot: item.q.hot,
        score,
        snippet,
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 150);
  }, [index, terms]);

  return (
    <div className="page narrow">
      <p className="eyebrow">Across your library</p>
      <h1>Find an answer.</h1>
      <p className="muted" role="status">
        {isLoading || !docs
          ? 'Preparing your question library…'
          : error
            ? 'Some documents could not be loaded.'
            : `Search ${index.length} questions across ${docs?.length ?? 0} topics.`}
      </p>
      {!terms.length && !isLoading && (
        <div className="empty-state">
          <h2>What would you like to work on?</h2>
          <p>Use the search above, or start with a familiar topic.</p>
          <div className="chips search-suggestions">
            {['React', 'Closures', 'WebRTC'].map((term) => (
              <Link key={term} className="btn-ghost btn-sm" to={`/search?q=${term}`}>
                {term}
              </Link>
            ))}
          </div>
        </div>
      )}
      {terms.length > 0 && !isLoading && (
        <p className="muted small">
          {hits.length === 150
            ? 'Showing the first 150 results'
            : `${hits.length} result${hits.length === 1 ? '' : 's'}`}{' '}
          for “{deferred}”
        </p>
      )}
      {terms.length > 0 && docs && !isLoading && hits.length === 0 && (
        <div className="empty-state">
          <h2>Let’s try a different phrase.</h2>
          <p>
            Try a shorter search or a broader topic. Each word needs to appear in the question, answer, or
            topic title.
          </p>
          <Link to="/topics" className="btn-ghost">
            Browse topics
          </Link>
        </div>
      )}
      <ol className="search-results">
        {hits.map((h) => (
          <li key={`${h.slug}/${h.qid}`}>
            <Link to={`/docs/${h.slug}#q-${h.qid}`} className="hit">
              <span className="hit-meta">
                {h.category} › {h.docTitle} {h.hot && <span className="badge hot">Frequently asked</span>}
              </span>
              <span className="hit-title">{highlight(h.title, terms)}</span>
              <span className="hit-snippet">{highlight(h.snippet, terms)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
