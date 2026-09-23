import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listenRestaurants, setRestaurantStatus } from '../../services/restaurantService';
import { useToast } from '../../context/ToastContext';
import { Loading, EmptyState, ConfirmDialog, Badge } from '../../components/Common';
import { formatDateTime } from '../../utils/formatters';
import RestaurantForm from './RestaurantForm';

export default function RestaurantsList() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const toast = useToast();

  useEffect(() => {
    const unsub = listenRestaurants(
      (data) => {
        setRestaurants(data);
        setLoading(false);
      },
      () => {
        toast.error('Could not load restaurants.');
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    return restaurants.filter((r) => {
      const matchesSearch = !search || r.name?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [restaurants, search, statusFilter]);

  const handleToggleStatus = async () => {
    if (!confirmTarget) return;
    const newStatus = confirmTarget.status === 'active' ? 'disabled' : 'active';
    try {
      await setRestaurantStatus(confirmTarget.restaurantId, newStatus);
      toast.success(`${confirmTarget.name} is now ${newStatus}.`);
    } catch (err) {
      toast.error('Could not update restaurant status.');
    } finally {
      setConfirmTarget(null);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Restaurants</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + New restaurant
        </button>
      </div>

      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search restaurants…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {loading ? (
        <Loading label="Loading restaurants…" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🏬" title="No restaurants found" description="Create your first restaurant to get started." />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.restaurantId}>
                  <td>
                    <Link to={`/super-admin/restaurants/${r.restaurantId}`}>{r.name}</Link>
                  </td>
                  <td>{r.email || '—'}</td>
                  <td>
                    <Badge status={r.status} />
                  </td>
                  <td>{formatDateTime(r.createdAt)}</td>
                  <td>
                    <button className="btn btn-small btn-ghost" onClick={() => setConfirmTarget(r)}>
                      {r.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <RestaurantForm onClose={() => setShowForm(false)} />}

      <ConfirmDialog
        open={!!confirmTarget}
        title={confirmTarget?.status === 'active' ? 'Disable restaurant?' : 'Enable restaurant?'}
        message={
          confirmTarget?.status === 'active'
            ? `${confirmTarget?.name} will no longer be able to receive orders.`
            : `${confirmTarget?.name} will be able to receive orders again.`
        }
        confirmLabel={confirmTarget?.status === 'active' ? 'Disable' : 'Enable'}
        danger={confirmTarget?.status === 'active'}
        onConfirm={handleToggleStatus}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
