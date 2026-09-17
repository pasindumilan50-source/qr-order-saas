import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRestaurant } from '../services/restaurantService';

export default function ReceptionLayout() {
  const { logout, profile, restaurantId } = useAuth();
  const [restaurantName, setRestaurantName] = useState('');

  useEffect(() => {
    if (!restaurantId) return undefined;
    let cancelled = false;
    getRestaurant(restaurantId)
      .then((r) => {
        if (!cancelled) setRestaurantName(r?.name || '');
      })
      .catch(() => {
        if (!cancelled) setRestaurantName('');
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  return (
    <div className="reception-shell">
      <header className="reception-header">
        <div className="reception-header-left">
          <span className="brand">{restaurantName || 'QR Order'}</span>
          <span className="reception-role-label">Reception / Cashier</span>
        </div>
        <div className="reception-header-right">
          <span className="reception-user">{profile?.full_name || profile?.email || ''}</span>
          <button className="btn btn-ghost" onClick={logout}>
            🚪 Logout
          </button>
        </div>
      </header>
      <main className="reception-main">
        <Outlet />
      </main>
    </div>
  );
}
