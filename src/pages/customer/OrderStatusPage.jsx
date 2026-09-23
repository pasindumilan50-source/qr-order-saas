import { useEffect, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { listenOrder } from '../../services/orderService';
import { payOrderWithCard } from '../../services/paymentService';
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

function PaymentSection({ order }) {
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  // Only relevant once the bill is ready and not already paid.
  if (order.status !== 'ready' && order.status !== 'completed') return null;
  if (order.paymentStatus === 'paid') {
    return (
      <div className="payment-section payment-success">
        <span className="empty-state-icon">✅</span>
        <h3>Payment successful</h3>
        <p>Thank you — your bill has been paid.</p>
      </div>
    );
  }

  if (order.status === 'completed') return null; // paid by cash at the counter

  const handlePayWithCard = async () => {
    setPayError('');
    setPaying(true);
    try {
      await payOrderWithCard(order.orderId);
      // payOrderWithCard navigates the browser away (form submit to
      // PayHere), so normally we never reach the lines below in this tab.
    } catch (err) {
      setPayError(err.message || 'Could not start payment. Please try again.');
      setPaying(false);
    }
  };

  if (order.paymentStatus === 'pending') {
    return (
      <div className="payment-section payment-pending">
        <Loading label="Waiting for payment confirmation…" />
        <p className="payment-hint">
          If you already completed payment on PayHere, this will update automatically within a few
          seconds. If nothing happens, please speak to restaurant staff.
        </p>
      </div>
    );
  }

  return (
    <div className="payment-section">
      <h3>Bill ready — {formatLKR(order.total)}</h3>
      {(order.paymentStatus === 'failed' || order.paymentStatus === 'cancelled') && (
        <p className="payment-error">
          {order.paymentStatus === 'cancelled' ? 'Payment was cancelled.' : 'Payment failed.'} Please try
          again, or pay cash at the counter.
        </p>
      )}
      {payError && <p className="payment-error">{payError}</p>}
      <button className="btn btn-primary btn-block" onClick={handlePayWithCard} disabled={paying}>
        {paying ? 'Redirecting to PayHere…' : 'Pay with Card 💳'}
      </button>
      <p className="payment-hint">Or pay cash at the counter.</p>
    </div>
  );
}

export default function OrderStatusPage() {
  const { orderId } = useParams();
  const location = useLocation();
  // Only true for the one navigation right after CustomerMenuPage places
  // the order — a page refresh or a shared link won't carry this state,
  // so returning customers just see the normal tracker below, not the
  // "just confirmed" hero every time.
  const justPlaced = Boolean(location.state?.justPlaced);
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
      {justPlaced && !isCancelled && (
        <div className="order-confirm-hero">
          <div className="order-confirm-check" aria-hidden="true">
            ✓
          </div>
          <h2>Order confirmed</h2>
          <p>Your order has been sent to the kitchen.</p>
          <p className="order-confirm-number">Order #{order.orderId.slice(0, 8).toUpperCase()}</p>
        </div>
      )}

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
            <div
              key={step}
              className={`status-step ${idx <= currentStepIndex ? 'status-step-done' : ''} ${
                idx === currentStepIndex ? 'status-step-current' : ''
              }`}
            >
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

      {!isCancelled && <PaymentSection order={order} />}
    </div>
  );
}
