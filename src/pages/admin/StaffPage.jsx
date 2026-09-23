import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { inviteStaff, listenStaff, removeStaff, setStaffStatus, updateStaffRole } from '../../services/staffService';
import { Loading, EmptyState, ConfirmDialog, Badge } from '../../components/Common';
import { formatDateTime } from '../../utils/formatters';

const emptyForm = { email: '', name: '', role: 'kitchen' };

export default function StaffPage() {
  const { restaurantId, user } = useAuth();
  const toast = useToast();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteResult, setInviteResult] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  useEffect(() => {
    if (!restaurantId) return;
    const unsub = listenStaff(
      restaurantId,
      (data) => {
        setStaff(data);
        setLoading(false);
      },
      () => {
        toast.error('Could not load staff.');
        setLoading(false);
      }
    );
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.email.trim()) return setError('Email is required.');
    setSubmitting(true);
    try {
      const result = await inviteStaff(form.email.trim(), form.name.trim(), form.role);
      setInviteResult({ ...result, email: form.email });
      toast.success('Staff member added.');
    } catch (err) {
      setError(err.message || 'Could not invite staff.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (member, role) => {
    try {
      await updateStaffRole(member.staffId, role);
      toast.success('Role updated.');
    } catch (err) {
      toast.error(err.message || 'Could not update role.');
    }
  };

  const handleToggleStatus = async (member) => {
    try {
      await setStaffStatus(member.staffId, member.status === 'active' ? 'disabled' : 'active');
      toast.success('Status updated.');
    } catch (err) {
      toast.error(err.message || 'Could not update status.');
    }
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeStaff(removeTarget.staffId);
      toast.success('Staff member removed.');
    } catch (err) {
      toast.error(err.message || 'Could not remove staff member.');
    } finally {
      setRemoveTarget(null);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setForm(emptyForm);
    setInviteResult(null);
    setError('');
  };

  if (loading) return <Loading fullPage label="Loading staff…" />;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Staff</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + Add staff
        </button>
      </div>

      {staff.length === 0 ? (
        <EmptyState icon="🧑‍🍳" title="No staff added yet" />
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}</td>
                  <td>{m.email}</td>
                  <td>
                    {m.role === 'owner' ? (
                      <Badge status="owner" />
                    ) : (
                      <select value={m.role} onChange={(e) => handleRoleChange(m, e.target.value)} disabled={m.userId === user?.uid}>
                        <option value="admin">admin</option>
                        <option value="reception">reception</option>
                        <option value="kitchen">kitchen</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <Badge status={m.status} />
                  </td>
                  <td>{formatDateTime(m.createdAt)}</td>
                  <td className="table-actions">
                    {m.role !== 'owner' && m.userId !== user?.uid && (
                      <>
                        <button className="btn btn-small btn-ghost" onClick={() => handleToggleStatus(m)}>
                          {m.status === 'active' ? 'Disable' : 'Enable'}
                        </button>
                        <button className="btn btn-small btn-danger" onClick={() => setRemoveTarget(m)}>
                          Remove
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

      {showForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {inviteResult ? (
              <div>
                <h3>✅ Staff member added</h3>
                <p>
                  <strong>{inviteResult.email}</strong> now has access.
                </p>
                {inviteResult.created ? (
                  <>
                    <p>Temporary password: <code>{inviteResult.tempPassword}</code></p>
                    <p className="form-hint">Share this securely — they should change it after first login.</p>
                  </>
                ) : (
                  <p>They already had an account and can sign in with their existing password.</p>
                )}
                <div className="modal-actions">
                  <button className="btn btn-primary" onClick={closeForm}>
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInvite}>
                <h3>Add staff member</h3>
                <label>
                  Name
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                </label>
                <label>
                  Role
                  <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    <option value="admin">Admin</option>
                    <option value="reception">Reception/Cashier</option>
                    <option value="kitchen">Kitchen</option>
                  </select>
                </label>
                {error && <p className="form-error">{error}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn btn-ghost" onClick={closeForm} disabled={submitting}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={submitting}>
                    {submitting ? 'Adding…' : 'Add staff'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove this staff member?"
        message={`${removeTarget?.name} will immediately lose access to this restaurant.`}
        confirmLabel="Remove"
        danger
        onConfirm={handleRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
