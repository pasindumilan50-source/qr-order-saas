import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  createMenuItem,
  deleteMenuItem,
  listenMenuItems,
  toggleAvailable,
  toggleSoldOut,
  updateMenuItem,
} from '../../services/menuService';
import { uploadMenuImage } from '../../services/storageService';
import { Loading, EmptyState, ConfirmDialog } from '../../components/Common';
import { formatLKR } from '../../utils/formatters';
import { BADGE_CATALOG, BADGE_BY_ID } from '../../utils/badges';

const emptyForm = { name: '', description: '', price: '', category: '', imageUrl: '', badges: [], autoBadgesOff: [] };

// Badges the system can award automatically from order history.
const AUTO_BADGE_IDS = ['fast_moving', 'popular'];

export default function MenuPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // item being edited, or 'new'
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('All');

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenMenuItems(
      restaurantId,
      (data) => {
        setItems(data);
        setLoading(false);
      },
      () => {
        toast.error('Could not load menu items.');
        setLoading(false);
      },
      { withAutoBadges: true }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const categories = useMemo(() => ['All', ...new Set(items.map((i) => i.category || 'Uncategorized'))], [items]);
  const visible = items.filter((i) => categoryFilter === 'All' || i.category === categoryFilter);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMenuItem(deleteTarget.id);
      toast.success('Item deleted.');
    } catch {
      toast.error('Could not delete item.');
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) return <Loading fullPage label="Loading menu…" />;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Menu</h1>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + Add item
        </button>
      </div>

      <div className="toolbar">
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon="📋" title="No menu items yet" description="Add your first item to get started." />
      ) : (
        <div className="admin-menu-grid">
          {visible.map((item) => (
            <div key={item.id} className="admin-menu-card">
              {item.imageUrl && <img src={item.imageUrl} alt={item.name} />}
              <div className="admin-menu-card-body">
                <div className="admin-menu-card-title-row">
                  <strong>{item.name}</strong>
                  <span>{formatLKR(item.price)}</span>
                </div>
                <p>{item.description}</p>
                <span className="category-chip">{item.category}</span>
                {(item.badges?.length > 0 || item.autoBadges?.length > 0) && (
                  <div className="admin-menu-card-badges">
                    {(item.badges || []).map((id) => {
                      const b = BADGE_BY_ID[id];
                      if (!b) return null;
                      return (
                        <span key={id} className="menu-badge" style={{ '--badge-color': b.color }}>
                          {b.emoji} {b.label}
                        </span>
                      );
                    })}
                    {(item.autoBadges || [])
                      .filter((id) => !(item.badges || []).includes(id))
                      .map((id) => {
                        const b = BADGE_BY_ID[id];
                        if (!b) return null;
                        return (
                          <span key={`auto-${id}`} className="menu-badge" style={{ '--badge-color': b.color, opacity: 0.75 }} title="Awarded automatically from orders">
                            {b.emoji} {b.label} · auto
                          </span>
                        );
                      })}
                  </div>
                )}
                <div className="admin-menu-card-toggles">
                  <label>
                    <input
                      type="checkbox"
                      checked={item.available !== false}
                      onChange={(e) => toggleAvailable(item.id, e.target.checked)}
                    />
                    Available
                  </label>
                  <label>
                    <input type="checkbox" checked={!!item.soldOut} onChange={(e) => toggleSoldOut(item.id, e.target.checked)} />
                    Sold out
                  </label>
                </div>
                <div className="admin-menu-card-actions">
                  <button className="btn btn-small btn-ghost" onClick={() => setEditing(item)}>
                    Edit
                  </button>
                  <button className="btn btn-small btn-danger" onClick={() => setDeleteTarget(item)}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <MenuItemForm
          item={editing === 'new' ? null : editing}
          restaurantId={restaurantId}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this item?"
        message={`"${deleteTarget?.name}" will be permanently removed from the menu.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function MenuItemForm({ item, restaurantId, onClose }) {
  const [form, setForm] = useState(
    item
      ? {
          name: item.name,
          description: item.description,
          price: item.price,
          category: item.category,
          imageUrl: item.imageUrl,
          badges: item.badges || [],
          autoBadgesOff: item.autoBadgesOff || [],
        }
      : emptyForm
  );
  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const toggleBadge = (id) => {
    setForm((f) => {
      const has = f.badges.includes(id);
      return { ...f, badges: has ? f.badges.filter((b) => b !== id) : [...f.badges, id] };
    });
  };

  const toggleAutoBadge = (id) => {
    setForm((f) => {
      const off = f.autoBadgesOff || [];
      return { ...f, autoBadgesOff: off.includes(id) ? off.filter((b) => b !== id) : [...off, id] };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Name is required.');
    const price = Number(form.price);
    if (!Number.isFinite(price) || price < 0) return setError('Enter a valid price.');

    setSubmitting(true);
    try {
      let imageUrl = form.imageUrl;
      if (file) {
        imageUrl = await uploadMenuImage(restaurantId, file);
      }
      if (item) {
        await updateMenuItem(item.id, { ...form, price, imageUrl });
      } else {
        await createMenuItem(restaurantId, { ...form, price, imageUrl });
      }
      toast.success(item ? 'Item updated.' : 'Item added.');
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save item.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{item ? 'Edit item' : 'Add item'}</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Name
            <input value={form.name} onChange={update('name')} required />
          </label>
          <label>
            Description
            <textarea value={form.description} onChange={update('description')} rows={2} />
          </label>
          <label>
            Price (LKR)
            <input type="number" min="0" step="0.01" value={form.price} onChange={update('price')} required />
          </label>
          <label>
            Category
            <input value={form.category} onChange={update('category')} placeholder="e.g. Starters" />
          </label>
          <label>
            Image
            <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          {form.imageUrl && !file && <img src={form.imageUrl} alt="" className="form-image-preview" />}

          <label>Highlight badges</label>
          <div className="badge-picker">
            {BADGE_CATALOG.map((b) => (
              <label key={b.id} className={`badge-picker-option ${form.badges.includes(b.id) ? 'is-selected' : ''}`} style={{ '--badge-color': b.color }}>
                <input type="checkbox" checked={form.badges.includes(b.id)} onChange={() => toggleBadge(b.id)} />
                {b.emoji} {b.label}
              </label>
            ))}
          </div>

          <label>
            Automatic badges
            <span className="form-hint"> — awarded from recent orders. Untick to hide one for this item.</span>
          </label>
          <div className="badge-picker">
            {AUTO_BADGE_IDS.map((id) => {
              const b = BADGE_BY_ID[id];
              const enabled = !(form.autoBadgesOff || []).includes(id);
              const earned = item?.autoBadges?.includes(id);
              return (
                <label key={id} className={`badge-picker-option ${enabled ? 'is-selected' : ''}`} style={{ '--badge-color': b.color }}>
                  <input type="checkbox" checked={enabled} onChange={() => toggleAutoBadge(id)} />
                  {b.emoji} {b.label}
                  {item && enabled && (earned ? ' · earned now' : ' · not earned yet')}
                </label>
              );
            })}
          </div>

          {error && <p className="form-error">{error}</p>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
