import { NavLink } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { prefetchDoc, useManifest } from '../hooks/useResources';
import { useStatusMap } from '../lib/progress';

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { data, error } = useManifest();
  const status = useStatusMap();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const mastered = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [key, s] of Object.entries(status)) {
      if (s !== 'mastered') continue;
      const slug = key.slice(0, key.indexOf('/'));
      m[slug] = (m[slug] ?? 0) + 1;
    }
    return m;
  }, [status]);

  return (
    <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Documents">
      <nav>
        <NavLink to="/" end className="side-link top" onClick={onNavigate}>
          🏠 Dashboard
        </NavLink>
        <NavLink to="/practice" className="side-link top" onClick={onNavigate}>
          🎯 Mock interview
        </NavLink>
        <NavLink to="/saved" className="side-link top" onClick={onNavigate}>
          ★ Saved &amp; review
        </NavLink>
        {error && <p className="side-error">Could not load the manifest.</p>}
        {!data && !error && <div className="skeleton side-skel" />}
        {data?.categories.map((c) => (
          <div key={c.id} className="side-group">
            <button
              type="button"
              className="side-group-title"
              onClick={() => setCollapsed((s) => ({ ...s, [c.id]: !s[c.id] }))}
              aria-expanded={!collapsed[c.id]}
            >
              <span aria-hidden>{c.icon}</span> {c.title}
              <span className="side-caret">{collapsed[c.id] ? '▸' : '▾'}</span>
            </button>
            {!collapsed[c.id] &&
              c.docs.map((d) => {
                const total = d.questions ?? 0;
                const done = mastered[d.slug] ?? 0;
                return (
                  <NavLink
                    key={d.slug}
                    to={`/docs/${d.slug}`}
                    className="side-link"
                    onMouseEnter={() => prefetchDoc(d.slug)}
                    onFocus={() => prefetchDoc(d.slug)}
                    onClick={onNavigate}
                  >
                    <span className="side-link-title">{d.title}</span>
                    {total > 0 && (
                      <span className={`side-count${done >= total ? ' full' : ''}`} title={`${done} of ${total} mastered`}>
                        {done}/{total}
                      </span>
                    )}
                  </NavLink>
                );
              })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
