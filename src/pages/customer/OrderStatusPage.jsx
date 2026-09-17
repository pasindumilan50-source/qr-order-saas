import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { listenOrder } from '../../services/orderService';
import { Loading } from '../../components/Common';
import { formatLKR, formatDateTime } from '../../utils/formatters';
import { isSupabaseConfigured } from '../../supabase/config';

const STEPS = ['pending', 'confirmed', 'preparing', 'ready', 'completed'];
const STEP_LABELS = {
  pending: 'Order received',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
};

export default function OrderStatusPage() {
  const { orderId } = useParams();
  const { user, loading: authLoading, loginAsGuest } = useAuth();
  const [order, setOrder] = useState(null);
  const [notFoundOrDenied, setNotFoundOrDenied] = useState(false);
  const [loadingOrder, setLoadingOrder] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (!authLoading && !user) loginAsGuest();
  }, [authLoading, user, loginAsGuest]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    if (authLoading || !user) return;
    const unsub = listenOrder(
      orderId,
      (data) => {
        setOrder(data);
        setLoadingOrder(false);
        if (!data) setNotFoundOrDenied(true);
      },
      () => {
        setNotFoundOrDenied(true);
        setLoadingOrder(false);
      }
    );
    return () => unsub();
  }, [orderId, authLoading, user]);

  if (!isSupabaseConfigured) {
    return (
      <div className="full-page-message">
        <h1>Configuration missing</h1>
      </div>
    );
  }

  if (authLoading || loadingOrder) {
    return <Loading fullPage label="Loading your order…" />;
  }

  if (notFoundOrDenied || !order) {
    return (
      <div className="full-page-message">
        <h1>Order not found</h1>
        <p>We couldn't find this order, or it doesn't belong to this device/session.</p>
      </div>
    );
  }

  const isCancelled = order.status === 'cancelled';
  const currentStepIndex = STEPS.indexOf(order.status);

  return (
    <div className="order-status-page">
      <h1>Order #{order.orderId.slice(0, 8).toUpperCase()}</h1>
      <p className="order-meta">
        Table {order.tableNumber} · {formatDateTime(order.createdAt)}
      </p>

      {isCancelled ? (
        <div className="status-cancelled">
          <span className="empty-state-icon">❌</span>
          <h2>Order cancelled</h2>
          <p>Please speak to restaurant staff if you have questions.</p>
        </div>
      ) : (
        <div className="status-tracker">
          {STEPS.map((step, idx) => (
            <div key={step} className={`status-step ${idx <= currentStepIndex ? 'status-step-done' : ''}`}>
              <div className="status-dot" />
              <span>{STEP_LABELS[step]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="order-items-summary">
        <h3>Items</h3>
        {order.items.map((item, idx) => (
          <div key={idx} className="order-item-row">
            <span>
              {item.quantity} × {item.name}
              {item.notes && <em> — {item.notes}</em>}
            </span>
            <span>{formatLKR(item.lineTotal)}</span>
          </div>
        ))}
        {order.notes && <p className="order-notes-display">Note: {order.notes}</p>}
        <div className="order-total-row">
          <strong>Total</strong>
          <strong>{formatLKR(order.total)}</strong>
        </div>
      </div>
    </div>
  );
}
