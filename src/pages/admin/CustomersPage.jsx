import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { listenCustomers } from '../../services/customerService';
import { Loading, EmptyState } from '../../components/Common';
import { formatLKR, formatDateTime } from '../../utils/formatters';

export default function CustomersPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenCustomers(
      restaurantId,
      (data) => {
        setCustomers(data);
        setLoading(false);
      },
      () => {
        toast.error('Could not load customers.');
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const filtered = customers.filter((c) => {
    if (!search) return true;
    const term = search.toLowerCase();
    return c.name?.toLowerCase().includes(term) || c.phone?.includes(term) || c.email?.toLowerCase().includes(term);
  });

  if (loading) return <Loading fullPage label="Loading customers…" />;

  return (
    <div className="page">
      <h1>Customers</h1>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by name, phone, or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="👥" title="No customers yet" description="Customers appear here after their first order." />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Orders</th>
                <th>Total spent</th>
                <th>Last order</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c)} className="clickable-row">
                  <td>{c.name || 'Guest'}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.orderCount || 0}</td>
                  <td>{formatLKR(c.totalSpent)}</td>
                  <td>{formatDateTime(c.lastOrderAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.name || 'Guest'}</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span>Phone</span>
                <strong>{selected.phone || '—'}</strong>
              </div>
              <div className="detail-item">
                <span>Email</span>
                <strong>{selected.email || '—'}</strong>
              </div>
              <div className="detail-item">
                <span>Order count</span>
                <strong>{selected.orderCount || 0}</strong>
              </div>
              <div className="detail-item">
                <span>Total spent</span>
                <strong>{formatLKR(selected.totalSpent)}</strong>
              </div>
              <div className="detail-item">
                <span>Customer since</span>
                <strong>{formatDateTime(selected.createdAt)}</strong>
              </div>
              <div className="detail-item">
                <span>Last order</span>
                <strong>{formatDateTime(selected.lastOrderAt)}</strong>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
