import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { listenOrdersForAdmin, confirmBillAndSendKot, completeOrder } from '../../services/orderService';
import { listenKotPrintJobs } from '../../services/kotService';
import { listenTables } from '../../services/tableService';
import { Loading, EmptyState, ErrorState, Badge } from '../../components/Common';
import { formatLKR, formatDateTime, timeAgo } from '../../utils/formatters';

const TABS = [
  { key: 'pending', label: 'New Orders' },
  { key: 'confirmed', label: 'Confirmed / KOT' },
  { key: 'ready', label: 'Ready — Take Payment' },
];

export default function ReceptionDashboard() {
  const { restaurantId } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState('pending');
  const [pendingOrders, setPendingOrders] = useState([]);
  const [confirmedOrders, setConfirmedOrders] = useState([]);
  const [readyOrders, setReadyOrders] = useState([]);
  const [tables, setTables] = useState([]);
  const [kotJobsByOrderId, setKotJobsByOrderId] = useState({});

  const [loadingPending, setLoadingPending] = useState(true);
  const [loadingConfirmed, setLoadingConfirmed] = useState(true);
  const [loadingReady, setLoadingReady] = useState(true);
  const [pendingError, setPendingError] = useState(false);
  const [confirmedError, setConfirmedError] = useState(false);
  const [readyError, setReadyError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [completingIds, setCompletingIds] = useState({});

  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [billReference, setBillReference] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [tableFilter, setTableFilter] = useState('all');

  // New Orders queue: `pending` orders waiting for Reception to review the
  // manual bill and issue the KOT. Realtime keeps this in sync — a fresh
  // guest order appears here, and a confirmed one disappears, without a
  // manual refresh.
  useEffect(() => {
    if (!restaurantId) return undefined;
    setLoadingPending(true);
    setPendingError(false);
    const unsub = listenOrdersForAdmin(
      restaurantId,
      { statusFilter: 'pending' },
      (data) => {
        // Oldest first — first-come, first-served at the counter.
        setPendingOrders([...data].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        setLoadingPending(false);
      },
      () => {
        setPendingError(true);
        setLoadingPending(false);
      }
    );
    return () => unsub();
  }, [restaurantId, retryToken]);

  // Confirmed/KOT visibility list — orders Reception has already actioned.
  // Deliberately scoped to status = 'confirmed' AND kot_sent_at set: once
  // Kitchen starts preparing, the order moves on and this list is no longer
  // the right place to track it (Kitchen/Admin dashboards cover that).
  useEffect(() => {
    if (!restaurantId) return undefined;
    setLoadingConfirmed(true);
    setConfirmedError(false);
    const unsub = listenOrdersForAdmin(
      restaurantId,
      { statusFilter: 'confirmed' },
      (data) => {
        setConfirmedOrders(data.filter((o) => !!o.kotSentAt));
        setLoadingConfirmed(false);
      },
      () => {
        setConfirmedError(true);
        setLoadingConfirmed(false);
      }
    );
    return () => unsub();
  }, [restaurantId, retryToken]);

  // Ready/Take-Payment list — orders the kitchen has finished. Card-paid
  // orders never really need to sit here: confirm_card_payment_and_complete
  // (0016) auto-completes them the moment PayHere's payment is verified, so
  // they disappear from this list on their own, same as if Reception had
  // clicked Complete manually. Only cash orders (or a card order still
  // awaiting payment) linger here for the cashier to act on.
  useEffect(() => {
    if (!restaurantId) return undefined;
    setLoadingReady(true);
    setReadyError(false);
    const unsub = listenOrdersForAdmin(
      restaurantId,
      { statusFilter: 'ready' },
      (data) => {
        setReadyOrders([...data].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)));
        setLoadingReady(false);
      },
      () => {
        setReadyError(true);
        setLoadingReady(false);
      }
    );
    return () => unsub();
  }, [restaurantId, retryToken]);

  useEffect(() => {
    if (!restaurantId) return undefined;
    const unsub = listenTables(restaurantId, setTables);
    return () => unsub();
  }, [restaurantId]);

  // KOT print queue status per order — purely a live reflection of
  // kot_print_jobs.status (queued/printing/printed/failed). Never inferred
  // or assumed from the bill/KOT confirmation itself: a job only shows
  // "Printed" here once the database row was actually marked printed by a
  // future Print Bridge.
  useEffect(() => {
    if (!restaurantId) return undefined;
    const unsub = listenKotPrintJobs(
      restaurantId,
      { statusFilter: 'all' },
      (jobs) => {
        const byOrder = {};
        for (const job of jobs) {
          // Jobs are already sorted newest-first by listenKotPrintJobs.
          if (!byOrder[job.orderId]) byOrder[job.orderId] = job;
        }
        setKotJobsByOrderId(byOrder);
      },
      () => {
        /* Non-fatal: the queue indicator just won't update live. */
      }
    );
    return () => unsub();
  }, [restaurantId]);

  // Selected order is derived from the live pending list rather than copied
  // into its own state, so it always reflects reality — e.g. if another
  // cashier confirms it first, it disappears from here automatically.
  const selectedOrder = useMemo(
    () => pendingOrders.find((o) => o.id === selectedOrderId) || null,
    [pendingOrders, selectedOrderId]
  );

  useEffect(() => {
    if (selectedOrderId && !selectedOrder) {
      setSelectedOrderId(null);
      setBillReference('');
      toast.info('That order is no longer pending — it may have been confirmed or cancelled elsewhere.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId, selectedOrder]);

  const filteredPending = useMemo(() => {
    return pendingOrders.filter((order) => {
      if (tableFilter !== 'all' && order.tableId !== tableFilter) return false;
      if (searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        const matchesOrder = order.orderId.toLowerCase().includes(term);
        const matchesTable = (order.tableNumber || '').toLowerCase().includes(term);
        if (!matchesOrder && !matchesTable) return false;
      }
      return true;
    });
  }, [pendingOrders, tableFilter, searchTerm]);

  const filteredConfirmed = useMemo(() => {
    return confirmedOrders.filter((order) => {
      if (tableFilter !== 'all' && order.tableId !== tableFilter) return false;
      if (searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        const matchesOrder = order.orderId.toLowerCase().includes(term);
        const matchesTable = (order.tableNumber || '').toLowerCase().includes(term);
        if (!matchesOrder && !matchesTable) return false;
      }
      return true;
    });
  }, [confirmedOrders, tableFilter, searchTerm]);

  const filteredReady = useMemo(() => {
    return readyOrders.filter((order) => {
      if (tableFilter !== 'all' && order.tableId !== tableFilter) return false;
      if (searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        const matchesOrder = order.orderId.toLowerCase().includes(term);
        const matchesTable = (order.tableNumber || '').toLowerCase().includes(term);
        if (!matchesOrder && !matchesTable) return false;
      }
      return true;
    });
  }, [readyOrders, tableFilter, searchTerm]);

  const selectOrder = (order) => {
    setSelectedOrderId(order.id);
    setBillReference(order.billReference || '');
  };

  const handleConfirm = async () => {
    if (!selectedOrder || submitting) return;
    setSubmitting(true);
    try {
      await confirmBillAndSendKot(selectedOrder.id, billReference.trim());
      toast.success(`Bill confirmed & KOT sent — Table ${selectedOrder.tableNumber}.`);
      setSelectedOrderId(null);
      setBillReference('');
    } catch (err) {
      toast.error(err.message || 'Could not confirm the bill and send KOT. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteCash = async (order) => {
    if (completingIds[order.id]) return;
    setCompletingIds((c) => ({ ...c, [order.id]: true }));
    try {
      await completeOrder(order.id);
      toast.success(`Order completed — Table ${order.tableNumber}.`);
    } catch (err) {
      toast.error(err.message || 'Could not complete this order. Please try again.');
    } finally {
      setCompletingIds((c) => ({ ...c, [order.id]: false }));
    }
  };

  const retry = () => setRetryToken((t) => t + 1);

  if (loadingPending || loadingConfirmed || loadingReady) {
    return <Loading fullPage label="Loading reception dashboard…" />;
  }

  if (pendingError && confirmedError && readyError) {
    return (
      <ErrorState
        title="Couldn't load the dashboard"
        description="Check your connection and try again."
        onRetry={retry}
      />
    );
  }

  return (
    <div className="page reception-page">
      <div className="page-header">
        <h1>Reception Dashboard</h1>
      </div>

      <div className="reception-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`reception-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'pending' && pendingOrders.length > 0 && (
              <span className="reception-tab-count">{pendingOrders.length}</span>
            )}
            {t.key === 'ready' && readyOrders.length > 0 && (
              <span className="reception-tab-count">{readyOrders.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search order number or table…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}>
          <option value="all">All tables</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              Table {t.tableNumber}
            </option>
          ))}
        </select>
      </div>

      {tab === 'pending' ? (
        pendingError ? (
          <ErrorState title="Couldn't load new orders" description="Check your connection and try again." onRetry={retry} />
        ) : (
          <div className="reception-layout">
            <div className="reception-queue">
              {filteredPending.length === 0 ? (
                <EmptyState icon="🧾" title="No new orders" description="Waiting for guest orders…" />
              ) : (
                filteredPending.map((order) => (
                  <button
                    key={order.id}
                    className={`order-card ${selectedOrderId === order.id ? 'order-card-selected' : ''}`}
                    onClick={() => selectOrder(order)}
                  >
                    <div className="order-card-header">
                      <strong>Table {order.tableNumber}</strong>
                      <span className="order-card-time">{timeAgo(order.createdAt)}</span>
                    </div>
                    <div className="order-card-id">#{order.orderId.slice(0, 8).toUpperCase()}</div>
                    <div className="order-card-summary">
                      {order.items.reduce((s, i) => s + i.quantity, 0)} items · {formatLKR(order.total)}
                    </div>
                    {order.customerName && <div className="order-card-customer">{order.customerName}</div>}
                  </button>
                ))
              )}
            </div>

            <div className="reception-detail">
              {selectedOrder ? (
                <>
                  <h3>Order #{selectedOrder.orderId.slice(0, 8).toUpperCase()}</h3>
                  <p>
                    Table {selectedOrder.tableNumber} · {formatDateTime(selectedOrder.createdAt)}
                  </p>
                  {selectedOrder.customerName && <p>Customer: {selectedOrder.customerName}</p>}

                  <ul className="order-items-summary">
                    {selectedOrder.items.map((item, idx) => (
                      <li key={idx} className="order-item-row">
                        <span>
                          {item.quantity} × {item.name}
                          {item.notes && <em> — {item.notes}</em>}
                        </span>
                        <span>{formatLKR(item.lineTotal)}</span>
                      </li>
                    ))}
                  </ul>
                  {selectedOrder.notes && <p className="order-notes-display">Note: {selectedOrder.notes}</p>}
                  <div className="order-total-row">
                    <strong>Order Total</strong>
                    <strong>{formatLKR(selectedOrder.total)}</strong>
                  </div>

                  <div className="bill-section">
                    <h4>Manual Bill</h4>
                    <label>
                      Bill Number / Reference
                      <input
                        type="text"
                        value={billReference}
                        onChange={(e) => setBillReference(e.target.value)}
                        placeholder="e.g. printed receipt no."
                        disabled={submitting}
                      />
                    </label>
                    <p className="form-hint">
                      Optional — record your restaurant's own manual bill/receipt number here, if you use one.
                    </p>
                  </div>

                  <button
                    className="btn btn-primary btn-block btn-confirm-kot"
                    onClick={handleConfirm}
                    disabled={submitting}
                  >
                    {submitting ? 'Sending…' : 'Confirm Bill & Send KOT'}
                  </button>
                </>
              ) : (
                <EmptyState
                  icon="👆"
                  title="Select an order"
                  description="Choose an order from the queue on the left to review its bill."
                />
              )}
            </div>
          </div>
        )
      ) : tab === 'confirmed' ? (
        confirmedError ? (
          <ErrorState title="Couldn't load confirmed orders" description="Check your connection and try again." onRetry={retry} />
        ) : filteredConfirmed.length === 0 ? (
          <EmptyState icon="✅" title="No confirmed orders yet" description="Orders you confirm will appear here." />
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Table</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Confirmed</th>
                  <th>KOT Issued</th>
                  <th>KOT Print</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredConfirmed.map((o) => {
                  const kotJob = kotJobsByOrderId[o.id];
                  return (
                    <tr key={o.id}>
                      <td>#{o.orderId.slice(0, 8).toUpperCase()}</td>
                      <td>{o.tableNumber}</td>
                      <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                      <td>{formatLKR(o.total)}</td>
                      <td>{formatDateTime(o.billConfirmedAt)}</td>
                      <td>{formatDateTime(o.kotSentAt)}</td>
                      <td>
                        {/* Reflects kot_print_jobs.status exactly — never
                            shown as "Printed" unless the database job was
                            actually marked printed. */}
                        {kotJob ? <Badge status={kotJob.status} /> : <span className="badge">—</span>}
                      </td>
                      <td>
                        <Badge status={o.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : readyError ? (
        <ErrorState title="Couldn't load ready orders" description="Check your connection and try again." onRetry={retry} />
      ) : filteredReady.length === 0 ? (
        <EmptyState icon="🍽️" title="Nothing waiting on payment" description="Orders Kitchen marks Ready will appear here for you to take payment." />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Table</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Ready</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredReady.map((o) => {
                const isCardPending = o.paymentMethod === 'card' && o.paymentStatus === 'pending';
                return (
                  <tr key={o.id}>
                    <td>#{o.orderId.slice(0, 8).toUpperCase()}</td>
                    <td>{o.tableNumber}</td>
                    <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                    <td>{formatLKR(o.total)}</td>
                    <td>
                      {isCardPending ? (
                        <span className="badge">Card — awaiting payment</span>
                      ) : (
                        <span className="badge">Cash</span>
                      )}
                    </td>
                    <td>{timeAgo(o.createdAt)}</td>
                    <td>
                      <button
                        className="btn btn-primary"
                        disabled={completingIds[o.id] || isCardPending}
                        onClick={() => handleCompleteCash(o)}
                        title={isCardPending ? 'Waiting for the card payment to be confirmed automatically.' : undefined}
                      >
                        {isCardPending ? 'Awaiting card payment' : completingIds[o.id] ? 'Completing…' : 'Complete (Cash received)'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
