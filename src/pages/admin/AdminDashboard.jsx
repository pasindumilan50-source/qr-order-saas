import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { listenOrdersForAdmin } from '../../services/orderService';
import { listenTables } from '../../services/tableService';
import { Loading } from '../../components/Common';
import { formatLKR, isSameDay } from '../../utils/formatters';

// Animates a number counting up to `value` whenever it changes, instead of
// just snapping — small touch that makes the dashboard feel alive rather
// than a static report.
function useCountUp(value, duration = 600) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);

  useEffect(() => {
    const from = fromRef.current;
    const to = typeof value === 'number' ? value : 0;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const start = performance.now();
    let raf;
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

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

  const animatedSales = useCountUp(todaySales);
  const animatedOrders = useCountUp(todayOrders.length);
  const animatedPending = useCountUp(pendingCount);
  const animatedCompleted = useCountUp(completedToday);
  const animatedCustomers = useCountUp(uniqueCustomersToday);

  if (loading) return <Loading fullPage label="Loading dashboard…" />;

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="stat-grid">
        <StatCard label="Today's sales" value={formatLKR(animatedSales)} icon="💰" />
        <StatCard label="Today's orders" value={animatedOrders} icon="🧾" />
        <StatCard label="Pending orders" value={animatedPending} icon="⏳" />
        <StatCard label="Completed today" value={animatedCompleted} icon="✅" />
        <StatCard label="Active tables" value={`${activeTables} / ${tables.length}`} icon="🪑" />
        <StatCard label="Customers today" value={animatedCustomers} icon="👥" />
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
