import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  listenOrdersForAdmin,
  confirmBillAndSendKot,
  startOrderPreparing,
  markOrderReady,
  completeOrder,
  cancelOrder,
} from '../../services/orderService';
import { listenTables } from '../../services/tableService';
import { Loading, EmptyState, Badge, ConfirmDialog } from '../../components/Common';
import { formatLKR, formatDateTime } from '../../utils/formatters';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ['all', 'pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'];

// Explicit, one-step-at-a-time transitions instead of a generic "set status
// to anything" control — mirrors the Kitchen dashboard. Owners/admins may
// call every transition RPC (they're an allowed role on each one); Reception
// staff have their own view in a later phase, but this page stays available
// to owners/admins for oversight of the full order lifecycle.
const NEXT_ACTION = {
  pending: { run: confirmBillAndSendKot, label: 'Confirm Bill & Send KOT' },
  confirmed: { run: startOrderPreparing, label: 'Start preparing' },
  preparing: { run: markOrderReady, label: 'Mark ready' },
  ready: { run: completeOrder, label: 'Complete' },
};

export default function OrdersPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [orders, setOrders] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [tableFilter, setTableFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenOrdersForAdmin(restaurantId, { statusFilter, tableFilter }, (data) => {
      setOrders(data);
      setLoading(false);
    });
    const unsubTables = listenTables(restaurantId, setTables);
    return () => {
      unsub();
      unsubTables();
    };
  }, [restaurantId, statusFilter, tableFilter]);

  useEffect(() => setPage(1), [statusFilter, tableFilter, dateFilter, searchTerm]);

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (dateFilter) {
        const d = o.createdAt?.toDate ? o.createdAt.toDate() : null;
        if (!d || d.toISOString().slice(0, 10) !== dateFilter) return false;
      }
      if (searchTerm && !o.orderId.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [orders, dateFilter, searchTerm]);

  const paged = filtered.slice(0, page * PAGE_SIZE);

  const handleCancel = async () => {
    if (!cancelTarget) return;
    try {
      await cancelOrder(cancelTarget.id);
      toast.success('Order cancelled.');
    } catch (err) {
      toast.error(err.message || 'Could not cancel order.');
    } finally {
      setCancelTarget(null);
    }
  };

  const handleAdvance = async (order) => {
    const action = NEXT_ACTION[order.status];
    if (!action) return;
    try {
      await action.run(order.id);
    } catch (err) {
      toast.error(err.message || 'Could not update order status.');
    }
  };

  if (loading) return <Loading fullPage label="Loading orders…" />;

  return (
    <div className="page">
      <h1>Orders</h1>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search order number…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s}
            </option>
          ))}
        </select>
        <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}>
          <option value="all">All tables</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>
              Table {t.tableNumber}
            </option>
          ))}
        </select>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🧾" title="No orders found" description="Try adjusting your filters." />
      ) : (
        <>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Table</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <button className="link-btn" onClick={() => setSelectedOrder(o)}>
                        #{o.orderId.slice(0, 8).toUpperCase()}
                      </button>
                    </td>
                    <td>{o.tableNumber}</td>
                    <td>{o.items.reduce((s, i) => s + i.quantity, 0)}</td>
                    <td>{formatLKR(o.total)}</td>
                    <td>
                      <Badge status={o.status} />
                    </td>
                    <td>{formatDateTime(o.createdAt)}</td>
                    <td>
                      {o.status !== 'completed' && o.status !== 'cancelled' && (
                        <button className="btn btn-small btn-ghost" onClick={() => setCancelTarget(o)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {paged.length < filtered.length && (
            <button className="btn btn-ghost" onClick={() => setPage((p) => p + 1)}>
              Load more ({filtered.length - paged.length} remaining)
            </button>
          )}
        </>
      )}

      {selectedOrder && (
        <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} onAdvance={handleAdvance} />
      )}

      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel this order?"
        message={`Order #${cancelTarget?.orderId?.slice(0, 8).toUpperCase()} will be marked as cancelled.`}
        confirmLabel="Cancel order"
        danger
        onConfirm={handleCancel}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  );
}

function OrderDetailModal({ order, onClose, onAdvance }) {
  const action = NEXT_ACTION[order.status];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Order #{order.orderId.slice(0, 8).toUpperCase()}</h3>
        <p>Table {order.tableNumber} · {formatDateTime(order.createdAt)}</p>
        <ul className="order-items-summary">
          {order.items.map((item, idx) => (
            <li key={idx} className="order-item-row">
              <span>
                {item.quantity} × {item.name}
                {item.notes && <em> — {item.notes}</em>}
              </span>
              <span>{formatLKR(item.lineTotal)}</span>
            </li>
          ))}
        </ul>
        {order.notes && <p>Note: {order.notes}</p>}
        <div className="order-total-row">
          <strong>Total</strong>
          <strong>{formatLKR(order.total)}</strong>
        </div>
        <p>
          Status: <Badge status={order.status} />
        </p>
        {order.kotSentAt && <p className="form-hint">KOT issued {formatDateTime(order.kotSentAt)}</p>}
        <div className="modal-actions">
          {action && (
            <button className="btn btn-primary" onClick={() => onAdvance(order)}>
              {action.label}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
