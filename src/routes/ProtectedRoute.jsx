import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Loading } from '../components/Common';

/**
 * Guards a route by required role(s). Renders children only if the signed-in
 * user's role (loaded live from the `profiles` table via Supabase Auth +
 * RLS) matches. Redirects to /login otherwise,
 * preserving the attempted location for a post-login bounce-back.
 */
export function ProtectedRoute({ allowedRoles, children }) {
  const { user, role, loading, authError, isGuest } = useAuth();
  const location = useLocation();

  if (loading) {
    return <Loading fullPage label="Checking your session…" />;
  }

  if (!user || isGuest) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (authError) {
    return (
      <div className="full-page-message">
        <h1>Access issue</h1>
        <p>{authError}</p>
      </div>
    );
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return (
      <div className="full-page-message">
        <h1>Access denied</h1>
        <p>You don't have permission to view this page.</p>
      </div>
    );
  }

  return children;
}
