import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { PlaygroundHost } from '../playground/PlaygroundHost';
import { useTheme } from '../hooks/useTheme';
import { useHotkey } from '../hooks/useHotkeys';
import { playground } from '../lib/playgroundStore';

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(location.pathname === '/search' ? (params.get('q') ?? '') : '');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (location.pathname === '/search') setQ(params.get('q') ?? '');
  }, [location.pathname, params]);

  useEffect(() => {
    if (!location.hash) window.scrollTo({ top: 0 });
  }, [location.pathname, location.hash]);

  const focusSearch = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    searchRef.current?.focus();
    searchRef.current?.select();
  }, []);
  useHotkey('mod+k', focusSearch);
  useHotkey('/', focusSearch);

  const submit = (value: string) => {
    const v = value.trim();
    navigate(v ? `/search?q=${encodeURIComponent(v)}` : '/search', { replace: location.pathname === '/search' });
  };

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="icon-btn menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Toggle navigation">
          ☰
        </button>
        <Link to="/" className="brand">
          <span className="brand-mark">{'{ }'}</span>
          <span className="brand-text">Interview Prep Docs</span>
        </Link>
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
          }}
        >
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (location.pathname === '/search') submit(e.target.value);
            }}
            placeholder="Search every question…"
            aria-label="Search questions"
          />
          <kbd>Ctrl K</kbd>
        </form>
        <nav className="top-actions">
          <Link to="/practice" className="top-link">
            Mock
          </Link>
          <button type="button" className="icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button type="button" className="btn-run btn-sm" onClick={playground.toggle} title="Toggle playground (Ctrl + `)">
            ▶ Playground
          </button>
        </nav>
      </header>
      <div className="shell">
        <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        {menuOpen && <div className="scrim" onClick={() => setMenuOpen(false)} />}
        <main className="main" id="main">
          <Outlet />
        </main>
      </div>
      <PlaygroundHost />
    </div>
  );
}
