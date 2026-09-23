import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  listenKitchenOrders,
  startOrderPreparing,
  markOrderReady,
  cancelOrder,
} from '../../services/orderService';
import { Loading, EmptyState } from '../../components/Common';
import { formatLKR, timeAgo } from '../../utils/formatters';

// Kitchen's first actionable state is `confirmed` (with the KOT already
// issued by Reception) — there is no `pending -> confirmed` transition here;
// that belongs to Reception's "Confirm Bill & Send KOT" action.
//
// Kitchen's role ends at `ready` — completing the order (taking cash, or
// auto-completing on a verified card payment) happens at Reception now, not
// here. A `ready` order shows no action button; it just waits.
const NEXT_ACTION = {
  confirmed: { run: startOrderPreparing, label: 'Start preparing' },
  preparing: { run: markOrderReady, label: 'Mark ready' },
};

export default function KitchenDashboard() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState({});

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenKitchenOrders(
      restaurantId,
      (data) => {
        setOrders(data);
        setLoading(false);
      },
      () => {
        toast.error('Lost connection to live orders. Trying to reconnect…');
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const advance = async (order) => {
    const action = NEXT_ACTION[order.status];
    if (!action) return;
    setBusyIds((b) => ({ ...b, [order.id]: true }));
    try {
      await action.run(order.id);
    } catch (err) {
      toast.error(err.message || 'Could not update order status. Please try again.');
    } finally {
      setBusyIds((b) => ({ ...b, [order.id]: false }));
    }
  };

  const cancel = async (order) => {
    setBusyIds((b) => ({ ...b, [order.id]: true }));
    try {
      await cancelOrder(order.id);
      toast.success('Order cancelled.');
    } catch (err) {
      toast.error(err.message || 'Could not cancel order.');
    } finally {
      setBusyIds((b) => ({ ...b, [order.id]: false }));
    }
  };

  if (loading) return <Loading fullPage label="Loading kitchen orders…" />;

  if (orders.length === 0) {
    return <EmptyState icon="✅" title="No active orders" description="New orders will appear here in real time." />;
  }

  return (
    <div className="kitchen-board">
      {orders.map((order) => (
        <div key={order.id} className={`kitchen-card kitchen-card-${order.status}`}>
          <div className="kitchen-card-header">
            <strong>Table {order.tableNumber}</strong>
            <span className="badge">{order.status}</span>
          </div>
          <p className="kitchen-card-time">{timeAgo(order.createdAt)}</p>
          <ul className="kitchen-card-items">
            {order.items.map((item, idx) => (
              <li key={idx}>
                <strong>{item.quantity}×</strong> {item.name}
                {item.notes && <span className="item-note"> — {item.notes}</span>}
              </li>
            ))}
          </ul>
          {order.notes && <p className="kitchen-card-notes">Note: {order.notes}</p>}
          <div className="kitchen-card-footer">
            <span>{formatLKR(order.total)}</span>
          </div>
          <div className="kitchen-card-actions">
            {NEXT_ACTION[order.status] && (
              <button
                className="btn btn-primary btn-block"
                disabled={busyIds[order.id]}
                onClick={() => advance(order)}
              >
                {NEXT_ACTION[order.status].label}
              </button>
            )}
            {order.status === 'ready' && <p className="kitchen-card-waiting">Ready — waiting for cashier to complete.</p>}
            {order.status !== 'completed' && (
              <button className="btn btn-ghost" disabled={busyIds[order.id]} onClick={() => cancel(order)}>
                Cancel
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
