import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="page narrow">
      <div className="empty-state">
        <h1>Page not found</h1>
        <Link to="/">← Back to the dashboard</Link>
      </div>
    </div>
  );
}
