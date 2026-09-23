import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="full-page-message">
      <h1>404</h1>
      <p>This page doesn't exist.</p>
      <Link to="/login" className="btn btn-primary">
        Go to sign in
      </Link>
    </div>
  );
}
