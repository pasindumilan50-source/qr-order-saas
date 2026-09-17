import { useState } from 'react';
import { createRestaurant } from '../../services/restaurantService';
import { uploadRestaurantLogo } from '../../services/storageService';
import { useToast } from '../../context/ToastContext';

const initial = {
  name: '',
  address: '',
  phone: '',
  email: '',
  ownerName: '',
  ownerEmail: '',
  ownerPassword: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

// Client-side helper only — used to pre-fill a strong temporary password the
// Super Admin can review/edit before submitting. The real, authoritative
// password validation and account creation happens server-side.
function generatePassword() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16) + 'A9';
}

export default function RestaurantForm({ onClose }) {
  const [form, setForm] = useState(initial);
  const [logoFile, setLogoFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const toast = useToast();

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleGeneratePassword = () => setForm((f) => ({ ...f, ownerPassword: generatePassword() }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim() || form.name.trim().length < 2) {
      return setError('Restaurant name must be at least 2 characters.');
    }
    if (!form.ownerEmail.trim() || !EMAIL_RE.test(form.ownerEmail.trim())) {
      return setError('A valid owner email address is required.');
    }
    if (!form.ownerPassword || form.ownerPassword.length < MIN_PASSWORD_LENGTH) {
      return setError(`Owner temporary password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    setSubmitting(true);
    try {
      const created = await createRestaurant(form);

      if (logoFile) {
        try {
          const logoUrl = await uploadRestaurantLogo(created.restaurantId, logoFile);
          // best-effort: update via a direct write is allowed for super admin
          const { updateRestaurantProfile } = await import('../../services/restaurantService');
          await updateRestaurantProfile(created.restaurantId, { logo: logoUrl });
        } catch (uploadErr) {
          toast.warning('Restaurant created, but the logo upload failed. You can add it later from restaurant settings.');
        }
      }

      setResult(created);
      toast.success(`${form.name} created successfully.`);
    } catch (err) {
      setError(err.message || 'Could not create restaurant.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal modal-lg">
        {result ? (
          <div>
            <h3>✅ {form.name} created</h3>
            <p>Restaurant ID: <code>{result.restaurantId}</code></p>
            {result.warning && <p className="form-warning">{result.warning}</p>}
            <p>A new owner account was created for <strong>{result.ownerEmail || form.ownerEmail}</strong>.</p>
            <p>
              Temporary password: <code>{form.ownerPassword}</code>
            </p>
            <p className="form-hint">
              This password is only shown here — it is never sent back by the server. Share it securely with the
              owner now; they should change it after first login.
            </p>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h3>New restaurant</h3>
            <label>
              Restaurant name
              <input value={form.name} onChange={update('name')} required />
            </label>
            <label>
              Logo (optional)
              <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
            </label>
            <label>
              Address
              <input value={form.address} onChange={update('address')} />
            </label>
            <label>
              Phone
              <input value={form.phone} onChange={update('phone')} />
            </label>
            <label>
              Restaurant contact email
              <input type="email" value={form.email} onChange={update('email')} />
            </label>
            <hr />
            <label>
              Owner name
              <input value={form.ownerName} onChange={update('ownerName')} />
            </label>
            <label>
              Owner email (they'll sign in with this)
              <input type="email" value={form.ownerEmail} onChange={update('ownerEmail')} required />
            </label>
            <label>
              Owner temporary password
              <div className="input-with-action">
                <input
                  type="text"
                  value={form.ownerPassword}
                  onChange={update('ownerPassword')}
                  minLength={MIN_PASSWORD_LENGTH}
                  placeholder="At least 8 characters"
                  required
                />
                <button type="button" className="btn btn-ghost" onClick={handleGeneratePassword}>
                  Generate
                </button>
              </div>
              <span className="form-hint">
                No invitation email is sent. Share this password with the owner yourself; they should change it
                after first login.
              </span>
            </label>

            {error && <p className="form-error">{error}</p>}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? 'Creating…' : 'Create restaurant'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
