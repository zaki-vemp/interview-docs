import { memo, useState } from 'react';
import { Markdown } from './Markdown';
import { progress, useProgress } from '../lib/progress';
import type { ParsedQuestion } from '../lib/types';

interface Props {
  q: ParsedQuestion;
  index: number;
  open: boolean;
  onToggle: (id: string) => void;
}

export const QuestionCard = memo(function QuestionCard({ q, index, open, onToggle }: Props) {
  const status = useProgress((s) => s.status[q.key]);
  const bookmarked = useProgress((s) => !!s.bookmarks[q.key]);
  const note = useProgress((s) => s.notes[q.key] ?? '');
  const [showNote, setShowNote] = useState(false);

  return (
    <article id={`q-${q.id}`} className={`qcard${open ? ' open' : ''}${status ? ` st-${status}` : ''}`}>
      <header className="qcard-head">
        <button type="button" className="qcard-toggle" onClick={() => onToggle(q.id)} aria-expanded={open}>
          <span className="qcard-num">{index}</span>
          <span className="qcard-title">{q.title}</span>
          {q.hot && (
            <span className="badge hot" title="Frequently asked">
              🔥 hot
            </span>
          )}
          <span className="qcard-chevron" aria-hidden>
            {open ? '−' : '+'}
          </span>
        </button>
        <div className="qcard-actions">
          <button
            type="button"
            className={`pill ${status === 'mastered' ? 'on-good' : ''}`}
            onClick={() => progress.setStatus(q.key, 'mastered')}
            title="I can answer this confidently"
          >
            ✓ Mastered
          </button>
          <button
            type="button"
            className={`pill ${status === 'review' ? 'on-warn' : ''}`}
            onClick={() => progress.setStatus(q.key, 'review')}
            title="Revisit before the interview"
          >
            ↻ Review
          </button>
          <button type="button" className={`pill ${bookmarked ? 'on-accent' : ''}`} onClick={() => progress.toggleBookmark(q.key)} title="Bookmark">
            {bookmarked ? '★' : '☆'}
          </button>
          <a className="pill" href={`#q-${q.id}`} title="Link to this question">
            #
          </a>
        </div>
      </header>
      {open && (
        <div className="qcard-body">
          <Markdown>{q.body}</Markdown>
          <div className="qcard-notes">
            {showNote || note ? (
              <>
                <label htmlFor={`note-${q.id}`}>My notes — add your own project examples, numbers and phrasing</label>
                <textarea
                  id={`note-${q.id}`}
                  value={note}
                  rows={Math.min(10, Math.max(3, note.split('\n').length + 1))}
                  placeholder="e.g. In MeetHour we measured…"
                  onChange={(e) => progress.setNote(q.key, e.target.value)}
                />
              </>
            ) : (
              <button type="button" className="btn-ghost btn-xs" onClick={() => setShowNote(true)}>
                ✎ Add my notes
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
});
