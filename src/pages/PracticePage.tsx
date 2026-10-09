import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAllDocs, useManifest } from '../hooks/useResources';
import { useHotkey } from '../hooks/useHotkeys';
import { Markdown } from '../components/Markdown';
import { Icon } from '../components/Icon';
import { progress, useStatusMap } from '../lib/progress';
import type { ParsedQuestion } from '../lib/types';

interface Card {
  q: ParsedQuestion;
  slug: string;
  docTitle: string;
}

type Phase = 'setup' | 'run' | 'summary';

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PracticePage() {
  const [params] = useSearchParams();
  const topic = params.get('topic');
  const { data: manifest } = useManifest();
  const { data: docs, isLoading } = useAllDocs();
  const status = useStatusMap();

  const [selected, setSelected] = useState<Set<string>>(() => new Set(topic ? [topic] : []));
  useEffect(() => {
    setSelected(new Set(topic ? [topic] : []));
  }, [topic]);
  const [hotOnly, setHotOnly] = useState(false);
  const [skipMastered, setSkipMastered] = useState(true);
  const [size, setSize] = useState(15);
  const [phase, setPhase] = useState<Phase>('setup');
  const [deck, setDeck] = useState<Card[]>([]);
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Record<string, 'mastered' | 'review' | 'skipped'>>({});
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [phase, i]);

  const docTitle = useMemo(() => {
    const m: Record<string, string> = {};
    manifest?.categories.forEach((c) => c.docs.forEach((d) => (m[d.slug] = d.title)));
    return m;
  }, [manifest]);

  const pool = useMemo<Card[]>(() => {
    if (!docs) return [];
    return docs
      .filter((d) => selected.size === 0 || selected.has(d.slug))
      .flatMap((d) => d.questions.map((q) => ({ q, slug: d.slug, docTitle: docTitle[d.slug] ?? d.title })))
      .filter((c) => (!hotOnly || c.q.hot) && (!skipMastered || status[c.q.key] !== 'mastered'));
  }, [docs, selected, hotOnly, skipMastered, status, docTitle]);

  useEffect(() => {
    if (phase !== 'run') return;
    setSeconds(0);
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase, i]);

  const start = () => {
    if (!pool.length) return;
    setDeck(shuffle(pool).slice(0, size === 0 ? pool.length : size));
    setI(0);
    setRevealed(false);
    setResults({});
    setPhase('run');
  };

  const card = deck[i];
  const advance = useCallback(
    (verdict: 'mastered' | 'review' | 'skipped') => {
      if (!card) return;
      if (verdict !== 'skipped') progress.setStatus(card.q.key, verdict, false);
      setResults((r) => ({ ...r, [card.q.key]: verdict }));
      setRevealed(false);
      if (i + 1 >= deck.length) setPhase('summary');
      else setI(i + 1);
    },
    [card, i, deck.length],
  );

  const active = phase === 'run';
  useHotkey(
    ' ',
    (e) => {
      e.preventDefault();
      setRevealed(true);
    },
    active && !revealed,
  );
  useHotkey('m', () => advance('mastered'), active && revealed);
  useHotkey('r', () => advance('review'), active && revealed);
  useHotkey('n', () => advance('skipped'), active);

  if (phase === 'setup') {
    return (
      <div className="page narrow">
        <p className="eyebrow">A little rehearsal</p>
        <h1>Find your rhythm.</h1>
        <p className="lede">
          Pick your topics, then answer out loud. Give yourself a minute or two before revealing the reference
          answer. Your self-assessment is saved to your progress.
        </p>
        <div className="practice-setup">
          <fieldset>
            <legend>Topics {selected.size ? `· ${selected.size} selected` : '· all topics'}</legend>
            <p className="muted small">Leave every topic unchecked to practice across the library.</p>
            {manifest?.categories.map((c) => (
              <div key={c.id} className="setup-group">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    setSelected((s) => {
                      const nx = new Set(s);
                      const allIn = c.docs.every((d) => nx.has(d.slug));
                      c.docs.forEach((d) => (allIn ? nx.delete(d.slug) : nx.add(d.slug)));
                      return nx;
                    })
                  }
                >
                  {c.title}
                </button>
                <div className="setup-docs">
                  {c.docs.map((d) => (
                    <label key={d.slug} className="check">
                      <input
                        type="checkbox"
                        checked={selected.has(d.slug)}
                        onChange={() =>
                          setSelected((s) => {
                            const nx = new Set(s);
                            if (nx.has(d.slug)) nx.delete(d.slug);
                            else nx.add(d.slug);
                            return nx;
                          })
                        }
                      />
                      {d.title}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          <div className="setup-options">
            <h2>Your round</h2>
            <label className="check">
              <input type="checkbox" checked={hotOnly} onChange={(e) => setHotOnly(e.target.checked)} />{' '}
              Frequently asked questions only
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={skipMastered}
                onChange={(e) => setSkipMastered(e.target.checked)}
              />{' '}
              Skip questions I already mastered
            </label>
            <label>
              Questions per round{' '}
              <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {[5, 10, 15, 25, 40, 0].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'All' : n}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn-primary"
              onClick={start}
              disabled={isLoading || pool.length === 0}
            >
              {isLoading || !docs
                ? 'Loading questions…'
                : `Start ${size === 0 ? pool.length : Math.min(size, pool.length)} questions`}{' '}
              <Icon name="arrow" />
            </button>
            <p className="muted small" role="status">
              {docs
                ? pool.length
                  ? `${pool.length} questions available with your settings.`
                  : 'No questions available. Try more topics or turn off “Skip questions I already mastered”.'
                : 'Preparing your questions…'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'summary') {
    const vals = Object.values(results);
    const m = vals.filter((v) => v === 'mastered').length;
    const r = vals.filter((v) => v === 'review').length;
    return (
      <div className="page narrow">
        <p className="eyebrow">Session complete</p>
        <h1>Another step forward.</h1>
        <p className="lede">
          You practiced {vals.length} of {deck.length} questions. Keep the confident answers and give the
          others another look.
        </p>
        <div className="stat-row">
          <div className="stat">
            <b>{m}</b>
            <span>mastered</span>
          </div>
          <div className="stat">
            <b>{r}</b>
            <span>to review</span>
          </div>
          <div className="stat">
            <b>{vals.length - m - r}</b>
            <span>skipped</span>
          </div>
        </div>
        <ul className="summary-list">
          {deck
            .filter((c) => results[c.q.key])
            .map((c) => (
              <li key={c.q.key} className={`sum-${results[c.q.key] ?? 'skipped'}`}>
                <Link to={`/docs/${c.slug}#q-${c.q.id}`}>{c.q.title}</Link>{' '}
                <span className="muted small">· {c.docTitle}</span>
              </li>
            ))}
        </ul>
        <div className="row-gap">
          <button type="button" className="btn-primary" onClick={start} disabled={!pool.length}>
            New round
          </button>
          <button type="button" className="btn-ghost" onClick={() => setPhase('setup')}>
            Change settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <div className="practice-top">
        <span className="muted">
          Question {i + 1} / {deck.length} · {card?.docTitle}
        </span>
        <span className={`timer${seconds >= 120 ? ' over' : ''}`}>
          <Icon name="clock" /> {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="progress-line">
        <div className="progress-fill" style={{ width: `${(i / Math.max(1, deck.length)) * 100}%` }} />
      </div>
      {card && (
        <article className="practice-card">
          <h2>
            {card.q.title} {card.q.hot && <span className="badge hot">Frequently asked</span>}
          </h2>
          {!revealed ? (
            <div className="practice-hidden">
              <p className="muted">
                Answer out loud first. Structure: definition → how it works → example from your projects →
                trade-offs.
              </p>
              <button type="button" className="btn-primary" onClick={() => setRevealed(true)}>
                Reveal answer <kbd>Space</kbd>
              </button>
              <button type="button" className="btn-ghost" onClick={() => advance('skipped')}>
                Skip <kbd>N</kbd>
              </button>
            </div>
          ) : (
            <>
              <Markdown>{card.q.body}</Markdown>
              <div className="practice-grade">
                <button type="button" className="btn-good" onClick={() => advance('mastered')}>
                  <Icon name="check" /> I can answer this <kbd>M</kbd>
                </button>
                <button type="button" className="btn-warn" onClick={() => advance('review')}>
                  <Icon name="review" /> Needs another look <kbd>R</kbd>
                </button>
                <button type="button" className="btn-ghost" onClick={() => advance('skipped')}>
                  Next <kbd>N</kbd>
                </button>
              </div>
            </>
          )}
        </article>
      )}
      <button type="button" className="link-btn" onClick={() => setPhase('summary')}>
        End round early
      </button>
    </div>
  );
}
