import { memo, useState } from 'react';
import { Markdown } from './Markdown';
import { Icon } from './Icon';
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
        <button
          type="button"
          className="qcard-toggle"
          onClick={() => onToggle(q.id)}
          aria-expanded={open}
          aria-controls={`answer-${q.id}`}
        >
          <span className="qcard-num">{index}</span>
          <span className="qcard-title">{q.title}</span>
          {status && (
            <span className={`question-status ${status}`}>
              {status === 'mastered' ? 'Mastered' : 'Review'}
            </span>
          )}
          <Icon name="chevron" className={`qcard-chevron${open ? ' expanded' : ''}`} />
        </button>
        <button
          type="button"
          className="icon-btn bookmark-toggle"
          onClick={() => progress.toggleBookmark(q.key)}
          aria-label={`Bookmark: ${q.title}`}
          aria-pressed={bookmarked}
          title={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
        >
          <Icon name="bookmark" />
        </button>
      </header>
      <div id={`answer-${q.id}`} hidden={!open}>
        {open && (
          <div className="qcard-body">
            <div className="question-content">
              <Markdown>{q.body}</Markdown>
            </div>
            <div className="question-footer">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => progress.setStatus(q.key, 'mastered')}
                aria-pressed={status === 'mastered'}
                title="I can answer this confidently"
              >
                <Icon name="check" /> Mastered
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => progress.setStatus(q.key, 'review')}
                aria-pressed={status === 'review'}
                title="Revisit before the interview"
              >
                <Icon name="review" /> Review
              </button>
              {q.hot && <span className="badge hot">Frequently asked</span>}
              <a className="text-link question-link" href={`#q-${q.id}`} aria-label={`Link to: ${q.title}`}>
                <Icon name="link" /> Question link
              </a>
            </div>
            <div className="qcard-notes">
              {showNote || note ? (
                <>
                  <label htmlFor={`note-${q.id}`}>Your notes · saved as you type</label>
                  <textarea
                    id={`note-${q.id}`}
                    value={note}
                    rows={Math.min(10, Math.max(3, note.split('\n').length + 1))}
                    placeholder="Add a project example, a useful number, or a way to explain this in your own words…"
                    onChange={(e) => progress.setNote(q.key, e.target.value)}
                  />
                </>
              ) : (
                <button type="button" className="btn-ghost btn-xs" onClick={() => setShowNote(true)}>
                  Add your own notes
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
});
