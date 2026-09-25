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
import { prepareModelChanges, removeModelFiles } from '../../services/arModelService';
import ARModelUpload from '../../components/ar/ARModelUpload';
import { Loading, EmptyState, ConfirmDialog } from '../../components/Common';
import { formatLKR } from '../../utils/formatters';
import { BADGE_CATALOG, BADGE_BY_ID } from '../../utils/badges';

const emptyForm = { name: '', description: '', price: '', category: '', imageUrl: '', badges: [] };

export default function MenuPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // item being edited, or 'new'
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [removingIds, setRemovingIds] = useState(() => new Set());

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
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const categories = useMemo(() => ['All', ...new Set(items.map((i) => i.category || 'Uncategorized'))], [items]);
  const visible = items.filter((i) => categoryFilter === 'All' || i.category === categoryFilter);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    // Play the fade/slide-out first, then delete for real — feels instant
    // instead of the row just vanishing the moment realtime catches up.
    setRemovingIds((prev) => new Set(prev).add(target.id));
    setTimeout(async () => {
      try {
        await deleteMenuItem(target.id);
        // Clean up this item's 3D files (best effort; only touches its own folder).
        if (target.modelGlbUrl || target.modelUsdzUrl) {
          removeModelFiles(target.restaurantId, target.id).catch(() => {});
        }
        toast.success('Item deleted.');
      } catch {
        toast.error('Could not delete item.');
        setRemovingIds((prev) => {
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      }
    }, 260);
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
        <div className="admin-menu-grid" key={categoryFilter}>
          {visible.map((item) => (
            <div
              key={item.id}
              className={`admin-menu-card ${removingIds.has(item.id) ? 'is-removing' : ''}`}
            >
              {item.imageUrl && (
                <div className="admin-menu-card-media">
                  <img src={item.imageUrl} alt={item.name} className={item.soldOut ? 'is-sold-out-img' : ''} />
                  {item.soldOut && (
                    <div className="sold-out-stamp">
                      <span>SOLD OUT</span>
                    </div>
                  )}
                </div>
              )}
              <div className="admin-menu-card-body">
                <div className="admin-menu-card-title-row">
                  <strong>{item.name}</strong>
                  <span>{formatLKR(item.price)}</span>
                </div>
                <p>{item.description}</p>
                <span className="category-chip">{item.category}</span>
                {item.badges?.length > 0 && (
                  <div className="admin-menu-card-badges">
                    {item.badges.map((id) => {
                      const b = BADGE_BY_ID[id];
                      if (!b) return null;
                      return (
                        <span key={id} className="menu-badge" style={{ '--badge-color': b.color }}>
                          {b.emoji} {b.label}
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="admin-menu-card-toggles">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={item.available !== false}
                      onChange={(e) => toggleAvailable(item.id, e.target.checked)}
                    />
                    <span className="switch-track" />
                    Available
                  </label>
                  <label className="switch switch-danger">
                    <input type="checkbox" checked={!!item.soldOut} onChange={(e) => toggleSoldOut(item.id, e.target.checked)} />
                    <span className="switch-track" />
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
        }
      : emptyForm
  );
  const [file, setFile] = useState(null);
  const [arChanges, setArChanges] = useState({ glb: {}, usdz: {} });
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const toggleBadge = (id) => {
    setForm((f) => {
      const has = f.badges.includes(id);
      return { ...f, badges: has ? f.badges.filter((b) => b !== id) : [...f.badges, id] };
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
      let itemId = item?.id;
      if (item) {
        await updateMenuItem(item.id, { ...form, price, imageUrl });
      } else {
        itemId = await createMenuItem(restaurantId, { ...form, price, imageUrl });
      }

      // Optional 3D / AR models. The item is already saved at this point, so a
      // model problem is reported without losing the rest of the form.
      const hasModelChanges = ['glb', 'usdz'].some((f) => arChanges[f].file || arChanges[f].remove);
      if (hasModelChanges) {
        try {
          const { patch, toDelete } = await prepareModelChanges(restaurantId, itemId, arChanges);
          if (Object.keys(patch).length) await updateMenuItem(itemId, patch);
          if (toDelete.length) await removeModelFiles(restaurantId, itemId, toDelete).catch(() => {});
        } catch (arErr) {
          toast.error(`Item saved, but the 3D model failed: ${arErr.message || 'upload error'}`);
          setShowSuccess(true);
          setTimeout(onClose, 550);
          return;
        }
      }
      toast.success(item ? 'Item updated.' : 'Item added.');
      setShowSuccess(true);
      setTimeout(onClose, 550);
    } catch (err) {
      setError(err.message || 'Could not save item.');
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        {showSuccess && (
          <div className="save-success-overlay">
            <div className="save-success-check">✓</div>
            <span className="save-success-label">Saved!</span>
          </div>
        )}
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

          <ARModelUpload
            current={{ glb: item?.modelGlbUrl, usdz: item?.modelUsdzUrl }}
            changes={arChanges}
            onChange={(format, value) => setArChanges((c) => ({ ...c, [format]: value }))}
            disabled={submitting}
          />

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
