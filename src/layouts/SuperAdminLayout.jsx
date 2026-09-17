import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/super-admin', label: 'Dashboard', icon: '📊', end: true },
  { to: '/super-admin/restaurants', label: 'Restaurants', icon: '🏬' },
];

export default function SuperAdminLayout() {
  const { logout, profile } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="app-shell">
      <button className="mobile-nav-toggle" onClick={() => setNavOpen((o) => !o)} aria-label="Toggle navigation">
        ☰
      </button>
      <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <span className="brand">QR Order</span>
          <span className="brand-subtitle">Super Admin · {profile?.name || ''}</span>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
              onClick={() => setNavOpen(false)}
            >
              <span className="sidebar-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="btn btn-ghost sidebar-logout" onClick={logout}>
          🚪 Logout
        </button>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
