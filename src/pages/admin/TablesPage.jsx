import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { createTable, deleteTable, listenTables, setTableStatus, updateTableNumber } from '../../services/tableService';
import { Loading, EmptyState, ConfirmDialog } from '../../components/Common';

export default function TablesPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newTableNumber, setNewTableNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenTables(
      restaurantId,
      (data) => {
        setTables(data);
        setLoading(false);
      },
      () => {
        toast.error('Could not load tables.');
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTableNumber.trim()) return;
    setCreating(true);
    try {
      await createTable(restaurantId, newTableNumber.trim());
      setNewTableNumber('');
      toast.success('Table created.');
    } catch (err) {
      toast.error(err.message || 'Could not create table.');
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (table) => {
    try {
      await updateTableNumber(table.id, restaurantId, editValue);
      toast.success('Table updated.');
    } catch (err) {
      toast.error(err.message || 'Could not update table.');
    } finally {
      setEditingId(null);
    }
  };

  const handleStatus = async (table, status) => {
    try {
      await setTableStatus(table.id, status);
    } catch {
      toast.error('Could not update table status.');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteTable(deleteTarget.id);
      toast.success('Table deleted.');
    } catch {
      toast.error('Could not delete table.');
    } finally {
      setDeleteTarget(null);
    }
  };

  if (loading) return <Loading fullPage label="Loading tables…" />;

  return (
    <div className="page">
      <h1>Tables</h1>

      <form className="inline-form" onSubmit={handleCreate}>
        <input
          placeholder="New table number (e.g. 12)"
          value={newTableNumber}
          onChange={(e) => setNewTableNumber(e.target.value)}
        />
        <button className="btn btn-primary" disabled={creating}>
          {creating ? 'Adding…' : 'Add table'}
        </button>
      </form>

      {tables.length === 0 ? (
        <EmptyState icon="🪑" title="No tables yet" description="Add a table to generate its QR code." />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Table</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tables.map((t) => (
                <tr key={t.id}>
                  <td>
                    {editingId === t.id ? (
                      <input value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                    ) : (
                      `Table ${t.tableNumber}`
                    )}
                  </td>
                  <td>
                    <select value={t.status} onChange={(e) => handleStatus(t, e.target.value)}>
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </td>
                  <td className="table-actions">
                    {editingId === t.id ? (
                      <>
                        <button className="btn btn-small btn-primary" onClick={() => handleRename(t)}>
                          Save
                        </button>
                        <button className="btn btn-small btn-ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="btn btn-small btn-ghost"
                          onClick={() => {
                            setEditingId(t.id);
                            setEditValue(String(t.tableNumber));
                          }}
                        >
                          Rename
                        </button>
                        <button className="btn btn-small btn-danger" onClick={() => setDeleteTarget(t)}>
                          Delete
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this table?"
        message={`Table ${deleteTarget?.tableNumber} and its QR code will stop working immediately.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
