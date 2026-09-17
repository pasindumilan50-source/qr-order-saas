import { useState, useEffect } from 'react';
import { useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { isSupabaseConfigured, supabaseConfigMissingKeys } from '../supabase/config';

function roleHomePath(role) {
  switch (role) {
    case 'super_admin':
      return '/super-admin';
    case 'owner':
    case 'admin':
      return '/admin';
    case 'kitchen':
      return '/kitchen';
    case 'reception':
      return '/reception';
    default:
      return '/login';
  }
}

// Mirrors the `allowedRoles` guards in AppRoutes.jsx. Used to sanity-check a
// post-login bounce-back target (`location.state.from`, set by
// ProtectedRoute) before trusting it — that value can be stale (e.g. left
// over in browser/router state from a previous, differently-privileged
// session on the same tab), so blindly navigating to it can send a
// correctly-authenticated user straight into a route their role isn't
// allowed on, surfacing as "Access denied" immediately after a successful
// login.
function isPathAllowedForRole(path, role) {
  if (!path || !role) return false;
  if (path.startsWith('/super-admin')) return role === 'super_admin';
  if (path.startsWith('/admin')) return role === 'owner' || role === 'admin';
  if (path.startsWith('/kitchen')) return role === 'kitchen' || role === 'owner' || role === 'admin';
  if (path.startsWith('/reception')) return role === 'reception' || role === 'owner' || role === 'admin';
  return false;
}

export default function Login() {
  const { user, role, loginWithEmail, authError, loading, isGuest } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const location = useLocation();

  useEffect(() => {
    document.title = 'Sign in — QR Order';
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <div className="full-page-message">
        <h1>Supabase configuration missing</h1>
        <p>
          The app can't connect to Supabase because these environment variables are not set:
        </p>
        <ul className="missing-keys-list">
          {supabaseConfigMissingKeys.map((k) => (
            <li key={k}>
              <code>{k}</code>
            </li>
          ))}
        </ul>
        <p>Copy <code>.env.example</code> to <code>.env</code>, fill in your Supabase project's URL and anon key, and restart the dev server.</p>
      </div>
    );
  }

  if (!loading && user && !isGuest && role) {
    const from = location.state?.from?.pathname;
    const target = isPathAllowedForRole(from, role) ? from : roleHomePath(role);
    return <Navigate to={target} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalError('');
    if (!email || !password) {
      setLocalError('Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    await loginWithEmail(email.trim(), password);
    setSubmitting(false);
    // On success, `user`/`role` update via the onAuthStateChanged listener and the
    // <Navigate> above redirects automatically to the correct dashboard.
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>QR Order</h1>
        <p className="auth-subtitle">Sign in to manage your restaurant</p>
        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {(localError || authError) && <p className="form-error">{localError || authError}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
