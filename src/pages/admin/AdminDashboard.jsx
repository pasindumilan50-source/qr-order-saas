import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listenOrdersForAdmin } from '../../services/orderService';
import { listenTables } from '../../services/tableService';
import { Loading } from '../../components/Common';
import { formatLKR, isSameDay } from '../../utils/formatters';

export default function AdminDashboard() {
  const { restaurantId } = useAuth();
  const [orders, setOrders] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenOrdersForAdmin(restaurantId, {}, (data) => {
      setOrders(data);
      setLoading(false);
    });
    const unsubTables = listenTables(restaurantId, setTables);
    return () => {
      unsub();
      unsubTables();
    };
  }, [restaurantId]);

  const todayOrders = useMemo(
    () => orders.filter((o) => o.createdAt && isSameDay(o.createdAt, new Date())),
    [orders]
  );
  const todaySales = useMemo(
    () => todayOrders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + (o.total || 0), 0),
    [todayOrders]
  );
  const pendingCount = useMemo(() => orders.filter((o) => ['pending', 'confirmed', 'preparing'].includes(o.status)).length, [orders]);
  const completedToday = useMemo(() => todayOrders.filter((o) => o.status === 'completed').length, [todayOrders]);
  const activeTables = useMemo(() => tables.filter((t) => t.status === 'active').length, [tables]);
  const uniqueCustomersToday = useMemo(
    () => new Set(todayOrders.map((o) => o.customerUid)).size,
    [todayOrders]
  );

  if (loading) return <Loading fullPage label="Loading dashboard…" />;

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="stat-grid">
        <StatCard label="Today's sales" value={formatLKR(todaySales)} icon="💰" />
        <StatCard label="Today's orders" value={todayOrders.length} icon="🧾" />
        <StatCard label="Pending orders" value={pendingCount} icon="⏳" />
        <StatCard label="Completed today" value={completedToday} icon="✅" />
        <StatCard label="Active tables" value={`${activeTables} / ${tables.length}`} icon="🪑" />
        <StatCard label="Customers today" value={uniqueCustomersToday} icon="👥" />
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
