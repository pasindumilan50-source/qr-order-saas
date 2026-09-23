import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { getRestaurant, updateRestaurantProfile } from '../../services/restaurantService';
import { uploadRestaurantLogo } from '../../services/storageService';
import {
  getPrinterSettings,
  savePrinterSettings,
} from '../../services/printerService';
import { Loading } from '../../components/Common';

const DEFAULT_PRINTER_FORM = {
  name: 'Kitchen Printer',
  connectionType: 'lan',
  brand: '',
  model: '',
  ipAddress: '',
  port: '9100',
};

export default function SettingsPage() {
  const { restaurantId } = useAuth();
  const toast = useToast();

  const [restaurant, setRestaurant] = useState(null);
  const [form, setForm] = useState({
    name: '',
    address: '',
    phone: '',
    email: '',
  });

  const [printer, setPrinter] = useState(null);
  const [printerForm, setPrinterForm] = useState(DEFAULT_PRINTER_FORM);

  const [logoFile, setLogoFile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPrinter, setSavingPrinter] = useState(false);
  const [error, setError] = useState('');
  const [printerError, setPrinterError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        const [restaurantData, printerData] = await Promise.all([
          getRestaurant(restaurantId),
          getPrinterSettings(restaurantId),
        ]);

        setRestaurant(restaurantData);

        setForm({
          name: restaurantData?.name || '',
          address: restaurantData?.address || '',
          phone: restaurantData?.phone || '',
          email: restaurantData?.email || '',
        });

        setPrinter(printerData);

        if (printerData) {
          setPrinterForm({
            name: printerData.name || 'Kitchen Printer',
            connectionType: printerData.connection_type || 'lan',
            brand: printerData.brand || '',
            model: printerData.model || '',
            ipAddress: printerData.ip_address || '',
            port: String(printerData.port || 9100),
          });
        }
      } catch (err) {
        console.error(err);
        toast.error('Could not load restaurant settings.');
      } finally {
        setLoading(false);
      }
    }

    if (restaurantId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const updatePrinter = (field) => (e) => {
    setPrinterForm((f) => ({
      ...f,
      [field]: e.target.value,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('Restaurant name is required.');
      return;
    }

    setSaving(true);

    try {
      let logo = restaurant?.logo || '';

      if (logoFile) {
        logo = await uploadRestaurantLogo(restaurantId, logoFile);
      }

      await updateRestaurantProfile(restaurantId, {
        ...form,
        logo,
      });

      setRestaurant((r) => ({
        ...r,
        ...form,
        logo,
      }));

      toast.success('Restaurant settings saved.');
      setLogoFile(null);
    } catch (err) {
      setError(err.message || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handlePrinterSubmit = async (e) => {
    e.preventDefault();
    setPrinterError('');

    if (!printerForm.name.trim()) {
      setPrinterError('Printer name is required.');
      return;
    }

    if (!printerForm.brand.trim()) {
      setPrinterError('Printer brand is required.');
      return;
    }

    if (
      printerForm.connectionType !== 'usb' &&
      !printerForm.ipAddress.trim()
    ) {
      setPrinterError('Printer IP address is required.');
      return;
    }

    const port = Number(printerForm.port);

    if (
      printerForm.connectionType !== 'usb' &&
      (!Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      setPrinterError('Printer port must be between 1 and 65535.');
      return;
    }

    setSavingPrinter(true);

    try {
      const saved = await savePrinterSettings(
        restaurantId,
        printerForm
      );

      setPrinter(saved);

      setPrinterForm({
        name: saved.name || 'Kitchen Printer',
        connectionType: saved.connection_type || 'lan',
        brand: saved.brand || '',
        model: saved.model || '',
        ipAddress: saved.ip_address || '',
        port: String(saved.port || 9100),
      });

      toast.success('Kitchen printer settings saved.');
    } catch (err) {
      console.error(err);
      setPrinterError(
        err.message || 'Could not save printer settings.'
      );
    } finally {
      setSavingPrinter(false);
    }
  };

  if (loading) {
    return <Loading fullPage label="Loading settings…" />;
  }

  return (
    <div className="page">
      <h1>Settings</h1>

      <form className="settings-form" onSubmit={handleSubmit}>
        {restaurant?.logo && !logoFile && (
          <img
            src={restaurant.logo}
            alt="Restaurant logo"
            className="form-image-preview"
          />
        )}

        <label>
          Logo
          <input
            type="file"
            accept="image/*"
            onChange={(e) =>
              setLogoFile(e.target.files?.[0] || null)
            }
          />
        </label>

        <label>
          Restaurant name
          <input
            value={form.name}
            onChange={update('name')}
            required
          />
        </label>

        <label>
          Address
          <input
            value={form.address}
            onChange={update('address')}
          />
        </label>

        <label>
          Phone
          <input
            value={form.phone}
            onChange={update('phone')}
          />
        </label>

        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
          />
        </label>

        <label>
          Restaurant status
          <input
            value={restaurant?.status || ''}
            disabled
          />
          <span className="form-hint">
            Only the Super Admin can enable or disable your restaurant.
          </span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <section className="settings-section">
        <h2>Kitchen Printer</h2>

        <p className="form-hint">
          Configure the printer used to print Kitchen Order Tickets (KOT).
          You can change the printer later without changing the restaurant.
        </p>

        {printer && (
          <p className="form-hint">
            Current printer:{' '}
            <strong>{printer.name}</strong>
            {' · '}
            {printer.brand}
            {printer.model ? ` ${printer.model}` : ''}
          </p>
        )}

        <form className="settings-form" onSubmit={handlePrinterSubmit}>
          <label>
            Printer name
            <input
              value={printerForm.name}
              onChange={updatePrinter('name')}
              placeholder="Kitchen Printer"
              required
            />
          </label>

          <label>
            Connection type
            <select
              value={printerForm.connectionType}
              onChange={updatePrinter('connectionType')}
            >
              <option value="lan">LAN / Ethernet</option>
              <option value="wifi">Wi-Fi</option>
              <option value="usb">USB</option>
            </select>
          </label>

          <label>
            Brand
            <select
              value={printerForm.brand}
              onChange={updatePrinter('brand')}
              required
            >
              <option value="">Select printer brand</option>
              <option value="Epson">Epson</option>
              <option value="Xprinter">Xprinter</option>
              <option value="Bixolon">Bixolon</option>
              <option value="Star">Star</option>
              <option value="Rongta">Rongta</option>
              <option value="SNBC">SNBC</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label>
            Model
            <input
              value={printerForm.model}
              onChange={updatePrinter('model')}
              placeholder="e.g. TM-T20III"
            />
          </label>

          {printerForm.connectionType !== 'usb' && (
            <>
              <label>
                IP address
                <input
                  value={printerForm.ipAddress}
                  onChange={updatePrinter('ipAddress')}
                  placeholder="192.168.1.100"
                  inputMode="decimal"
                  required
                />
                <span className="form-hint">
                  Example: 192.168.1.100
                </span>
              </label>

              <label>
                Port
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={printerForm.port}
                  onChange={updatePrinter('port')}
                  placeholder="9100"
                />
                <span className="form-hint">
                  Most ESC/POS network printers use port 9100.
                </span>
              </label>
            </>
          )}

          {printerForm.connectionType === 'usb' && (
            <p className="form-hint">
              USB printers do not require an IP address. The Print Bridge
              running on the restaurant computer will handle the local
              printer connection.
            </p>
          )}

          {printerError && (
            <p className="form-error">{printerError}</p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={savingPrinter}
          >
            {savingPrinter
              ? 'Saving printer…'
              : printer
                ? 'Update printer'
                : 'Save printer'}
          </button>
        </form>
      </section>
    </div>
  );
}
