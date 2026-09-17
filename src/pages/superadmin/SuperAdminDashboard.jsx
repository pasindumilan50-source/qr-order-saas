import { useEffect, useState } from 'react';
import { supabase } from '../../supabase/config';
import { listenRestaurants } from '../../services/restaurantService';
import { Loading } from '../../components/Common';

export default function SuperAdminDashboard() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orderCount, setOrderCount] = useState(null);
  const [customerCount, setCustomerCount] = useState(null);

  useEffect(() => {
    const unsub = listenRestaurants(
      (data) => {
        setRestaurants(data);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    async function loadCounts() {
      try {
        const { count, error } = await supabase.from('orders').select('*', { count: 'exact', head: true });
        if (error) throw error;
        setOrderCount(count);
      } catch {
        setOrderCount(null);
      }
      try {
        const { count, error } = await supabase.from('customers').select('*', { count: 'exact', head: true });
        if (error) throw error;
        setCustomerCount(count);
      } catch {
        setCustomerCount(null);
      }
    }
    loadCounts();
  }, []);

  if (loading) return <Loading fullPage label="Loading platform stats…" />;

  const active = restaurants.filter((r) => r.status === 'active').length;
  const disabled = restaurants.filter((r) => r.status === 'disabled').length;

  return (
    <div className="page">
      <h1>Platform overview</h1>
      <div className="stat-grid">
        <StatCard label="Total restaurants" value={restaurants.length} icon="🏬" />
        <StatCard label="Active restaurants" value={active} icon="✅" />
        <StatCard label="Disabled restaurants" value={disabled} icon="🚫" />
        <StatCard label="Total orders (platform)" value={orderCount ?? '—'} icon="🧾" />
        <StatCard label="Total customers (platform)" value={customerCount ?? '—'} icon="👥" />
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }) {
  return (
    <div className="stat-card">
      <span className="stat-icon">{icon}</span>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
