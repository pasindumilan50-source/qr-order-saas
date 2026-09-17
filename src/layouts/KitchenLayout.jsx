import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function KitchenLayout() {
  const { logout, profile } = useAuth();
  return (
    <div className="kitchen-shell">
      <header className="kitchen-header">
        <span className="brand">🍳 Kitchen · {profile?.name || ''}</span>
        <button className="btn btn-ghost" onClick={logout}>
          Logout
        </button>
      </header>
      <main className="kitchen-main">
        <Outlet />
      </main>
    </div>
  );
}
