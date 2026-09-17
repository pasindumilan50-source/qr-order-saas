import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { supabase } from '../../supabase/config';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Loading, EmptyState } from '../../components/Common';
import { formatLKR } from '../../utils/formatters';

const DAY_MS = 24 * 60 * 60 * 1000;

export default function ReportsPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) return;
    let cancelled = false;

    async function fetchReportData() {
      try {
        const { data: orderRows, error } = await supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .neq('status', 'cancelled')
          .order('created_at', { ascending: false })
          .limit(2000);
        if (error) throw error;

        const orderIds = (orderRows || []).map((o) => o.id);
        let itemsByOrder = {};
        if (orderIds.length > 0) {
          const { data: itemRows, error: itemsError } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds);
          if (itemsError) throw itemsError;
          for (const item of itemRows || []) {
            (itemsByOrder[item.order_id] ||= []).push(item);
          }
        }

        if (cancelled) return;
        setOrders(
          (orderRows || []).map((o) => ({
            id: o.id,
            status: o.status,
            total: Number(o.total),
            tableNumber: o.table_number,
            createdAt: o.created_at,
            items: (itemsByOrder[o.id] || []).map((it) => ({
              name: it.name,
              quantity: it.quantity,
              category: it.category,
              lineTotal: Number(it.subtotal),
            })),
          }))
        );
        setLoading(false);
      } catch {
        if (!cancelled) {
          toast.error('Could not load report data.');
          setLoading(false);
        }
      }
    }

    fetchReportData();

    const channel = supabase
      .channel(`reports-orders-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        () => fetchReportData()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const { dailySales, totals, bestSellers, categorySales, tableSales } = useMemo(() => {
    const now = Date.now();
    const cutoff30 = now - 30 * DAY_MS;

    const byDay = {};
    let totalOrders = 0;
    let completedOrders = 0;
    let pendingOrders = 0;
    const itemTotals = {};
    const categoryTotals = {};
    const tableTotals = {};

    for (const o of orders) {
      const created = o.createdAt ? new Date(o.createdAt) : null;
      totalOrders += 1;
      if (o.status === 'completed') completedOrders += 1;
      if (['pending', 'confirmed', 'preparing'].includes(o.status)) pendingOrders += 1;

      if (created && created.getTime() >= cutoff30) {
        const key = created.toISOString().slice(0, 10);
        byDay[key] = (byDay[key] || 0) + (o.total || 0);
      }

      for (const item of o.items || []) {
        itemTotals[item.name] = (itemTotals[item.name] || 0) + item.quantity;
        const category = item.category || 'Uncategorized';
        categoryTotals[category] = (categoryTotals[category] || 0) + (item.lineTotal || 0);
      }

      const tableLabel = `Table ${o.tableNumber}`;
      tableTotals[tableLabel] = (tableTotals[tableLabel] || 0) + (o.total || 0);
    }

    const dailySales = Object.entries(byDay)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, sales]) => ({ date: date.slice(5), sales }));

    const bestSellers = Object.entries(itemTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([name, qty]) => ({ name, qty }));

    const categorySales = Object.entries(categoryTotals)
      .sort(([, a], [, b]) => b - a)
      .map(([category, total]) => ({ category, total }));

    const tableSales = Object.entries(tableTotals)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([table, total]) => ({ table, total }));

    return {
      dailySales,
      totals: { totalOrders, completedOrders, pendingOrders, totalSales: orders.reduce((s, o) => s + (o.total || 0), 0) },
      bestSellers,
      categorySales,
      tableSales,
    };
  }, [orders]);

  if (loading) return <Loading fullPage label="Crunching numbers…" />;

  if (orders.length === 0) {
    return (
      <div className="page">
        <h1>Reports</h1>
        <EmptyState icon="📈" title="No data yet" description="Reports will appear once you have completed orders." />
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Reports</h1>

      <div className="stat-grid">
        <StatCard label="Total sales" value={formatLKR(totals.totalSales)} icon="💰" />
        <StatCard label="Total orders" value={totals.totalOrders} icon="🧾" />
        <StatCard label="Completed orders" value={totals.completedOrders} icon="✅" />
        <StatCard label="Pending orders" value={totals.pendingOrders} icon="⏳" />
      </div>

      <div className="report-section">
        <h2>Sales (last 30 days)</h2>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={dailySales}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip formatter={(v) => formatLKR(v)} />
            <Line type="monotone" dataKey="sales" stroke="#4f46e5" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="report-section">
        <h2>Best-selling items</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={bestSellers} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" />
            <YAxis type="category" dataKey="name" width={120} />
            <Tooltip />
            <Bar dataKey="qty" fill="#4f46e5" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="report-section">
        <h2>Category sales</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={categorySales}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis />
            <Tooltip formatter={(v) => formatLKR(v)} />
            <Bar dataKey="total" fill="#d97706" name="Sales" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="report-section">
        <h2>Sales by table</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={tableSales}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="table" />
            <YAxis />
            <Tooltip formatter={(v) => formatLKR(v)} />
            <Legend />
            <Bar dataKey="total" fill="#059669" name="Sales" />
          </BarChart>
        </ResponsiveContainer>
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
