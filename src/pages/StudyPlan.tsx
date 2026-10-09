import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useFlatDocs, useProfile, prefetchDoc } from '../hooks/useResources';
import { useStatusMap } from '../lib/progress';
import { Icon } from '../components/Icon';

export function StudyPlan() {
  const { data: profile, error } = useProfile();
  const docs = useFlatDocs();
  const status = useStatusMap();
  const location = useLocation();
  useEffect(() => {
    if (!profile || !/^#day-\d+$/.test(location.hash)) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, [profile, docs.length, location.hash]);
  return (
    <div className="page narrow plan-page">
      <p className="eyebrow">Structure, without the pressure</p>
      <h1>Your study path.</h1>
      <p className="lede">
        {profile?.studyPlan.length ?? 12} suggested days. Move at the pace that works for you.
      </p>
      {error && <p className="empty-state">We couldn’t load your study plan. Refresh to try again.</p>}
      {!profile && !error && <div className="skeleton study-skel" />}
      <div className="study-plan-list">
        {profile?.studyPlan.map((p, i) => {
          const topics = p.docs.map((slug) => docs.find((d) => d.slug === slug)).filter((d) => !!d);
          const total = topics.reduce((n, d) => n + (d.questions ?? 0), 0);
          const mastered = Object.entries(status).filter(
            ([key, s]) => s === 'mastered' && p.docs.includes(key.split('/')[0]),
          ).length;
          const complete = total > 0 && mastered >= total;
          return (
            <article className={`study-day${complete ? ' complete' : ''}`} key={p.day} id={`day-${i + 1}`}>
              <span className="path-number">{complete ? <Icon name="check" /> : i + 1}</span>
              <div>
                <div className="section-heading">
                  <h2>{p.day}</h2>
                  <span className="muted small">
                    {complete ? 'Complete' : `${mastered} / ${total} mastered`}
                  </span>
                </div>
                <p className="muted">{p.focus}</p>
                <div className="plan-topics">
                  {topics.map((d) => (
                    <Link
                      key={d.slug}
                      to={`/docs/${d.slug}`}
                      onMouseEnter={() => prefetchDoc(d.slug)}
                      onFocus={() => prefetchDoc(d.slug)}
                    >
                      {d.title}
                      <Icon name="external" />
                    </Link>
                  ))}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
