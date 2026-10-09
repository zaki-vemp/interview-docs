import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PlaygroundHost } from '../playground/PlaygroundHost';
import { AppearancePanel } from './AppearancePanel';
import { Icon } from './Icon';
import { useTheme } from '../hooks/useTheme';
import { useHotkey } from '../hooks/useHotkeys';

export function Layout() {
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearance = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [q, setQ] = useState(location.pathname === '/search' ? (params.get('q') ?? '') : '');
  const searchRef = useRef<HTMLInputElement>(null);
  const appearanceRef = useRef<HTMLButtonElement>(null);
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
  const closeAppearance = () => {
    setAppearanceOpen(false);
    appearanceRef.current?.focus();
  };
  const submit = (value: string) => {
    const v = value.trim();
    navigate(v ? `/search?q=${encodeURIComponent(v)}` : '/search', {
      replace: location.pathname === '/search',
    });
  };
  return (
    <div className={`app${appearanceOpen ? ' appearance-open' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Icon name="book" />
          </span>
          <span>
            Interview Prep<small>A space to prepare</small>
          </span>
        </Link>
        <nav className="primary-nav" aria-label="Main navigation">
          <NavLink to="/" end>
            Study desk
          </NavLink>
          <NavLink to="/topics" className={location.pathname.startsWith('/docs/') ? 'active' : undefined}>
            Topics
          </NavLink>
          <NavLink to="/practice">Practice</NavLink>
          <NavLink to="/saved">Saved</NavLink>
        </nav>
        <form
          className="search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            submit(q);
          }}
        >
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (location.pathname === '/search') submit(e.target.value);
            }}
            placeholder="Find a question…"
            aria-label="Search all questions"
          />
          <kbd>Ctrl K</kbd>
        </form>
        <button
          ref={appearanceRef}
          type="button"
          className="btn-ghost appearance-toggle"
          onClick={() => setAppearanceOpen((v) => !v)}
          aria-label="Appearance"
          aria-expanded={appearanceOpen}
          aria-controls="appearance-panel"
        >
          <Icon name="settings" />
          <span>Appearance</span>
        </button>
      </header>
      <div className="shell">
        <main className="main" id="main">
          <Outlet />
        </main>
        {appearanceOpen && <AppearancePanel appearance={appearance} onClose={closeAppearance} />}
      </div>
      <PlaygroundHost />
    </div>
  );
}
