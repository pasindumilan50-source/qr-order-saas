import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { getRestaurant, updateRestaurantProfile, updateRestaurantHero } from '../../services/restaurantService';
import { uploadRestaurantLogo, uploadHeroImage, uploadPromoImage } from '../../services/storageService';
import {
  listenHeroSlides,
  addHeroSlide,
  deleteHeroSlide,
  listenPromotions,
  addPromotion,
  updatePromotion,
  deletePromotion,
} from '../../services/homeContentService';
import {
  getPrinterSettings,
  savePrinterSettings,
} from '../../services/printerService';
import { Loading } from '../../components/Common';
import ThemeSettings from './ThemeSettings';

const DEFAULT_PRINTER_FORM = {
  name: 'Kitchen Printer',
  connectionType: 'lan',
  brand: '',
  model: '',
  ipAddress: '',
  port: '9100',
};

const DEFAULT_HERO_FORM = {
  heroLabel: '',
  heroHeading: '',
  heroDescription: '',
  heroButtonText: '',
  heroFontFamily: '',
  heroFontSize: '',
  heroFontWeight: '',
};

const FONT_FAMILY_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'Georgia, serif', label: 'Elegant Serif (Georgia)' },
  { value: '"Times New Roman", serif', label: 'Classic Serif (Times New Roman)' },
  { value: 'Arial, sans-serif', label: 'Clean Sans (Arial)' },
  { value: '"Helvetica Neue", sans-serif', label: 'Modern Sans (Helvetica)' },
];
const FONT_SIZE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '28px', label: 'Small' },
  { value: '34px', label: 'Medium' },
  { value: '40px', label: 'Large' },
  { value: '48px', label: 'Extra large' },
];
const FONT_WEIGHT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: '400', label: 'Normal' },
  { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' },
  { value: '700', label: 'Bold' },
];

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

  const [heroForm, setHeroForm] = useState(DEFAULT_HERO_FORM);
  const [savingHero, setSavingHero] = useState(false);
  const [heroError, setHeroError] = useState('');

  const [heroSlides, setHeroSlides] = useState([]);
  const [newSlideFile, setNewSlideFile] = useState(null);
  const [uploadingSlide, setUploadingSlide] = useState(false);
  const [slideError, setSlideError] = useState('');

  const [promotions, setPromotions] = useState([]);
  const [newPromoFile, setNewPromoFile] = useState(null);
  const [newPromoText, setNewPromoText] = useState('');
  const [savingPromo, setSavingPromo] = useState(false);
  const [promoError, setPromoError] = useState('');

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

        setHeroForm({
          heroLabel: restaurantData?.heroLabel || '',
          heroHeading: restaurantData?.heroHeading || '',
          heroDescription: restaurantData?.heroDescription || '',
          heroButtonText: restaurantData?.heroButtonText || '',
          heroFontFamily: restaurantData?.heroFontFamily || '',
          heroFontSize: restaurantData?.heroFontSize || '',
          heroFontWeight: restaurantData?.heroFontWeight || '',
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

  useEffect(() => {
    if (!restaurantId) return;
    const unsubSlides = listenHeroSlides(restaurantId, setHeroSlides, () =>
      toast.error('Could not load hero images.')
    );
    // Promotions here show every promotion, active or not — staff need to
    // see disabled ones to re-enable them (the customer Home page filters
    // to isActive on its own).
    const unsubPromos = listenPromotions(restaurantId, setPromotions, () =>
      toast.error('Could not load promotions.')
    );
    return () => {
      unsubSlides();
      unsubPromos();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  const update = (field) => (e) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const updateHero = (field) => (e) => {
    setHeroForm((f) => ({ ...f, [field]: e.target.value }));
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

  const handleHeroSubmit = async (e) => {
    e.preventDefault();
    setHeroError('');
    setSavingHero(true);
    try {
      await updateRestaurantHero(restaurantId, heroForm);
      setRestaurant((r) => (r ? { ...r, ...heroForm } : r));
      toast.success('Hero section saved.');
    } catch (err) {
      setHeroError(err.message || 'Could not save hero settings.');
    } finally {
      setSavingHero(false);
    }
  };

  const handleAddSlide = async () => {
    if (!newSlideFile) return;
    setSlideError('');
    setUploadingSlide(true);
    try {
      const url = await uploadHeroImage(restaurantId, newSlideFile);
      await addHeroSlide(restaurantId, url, heroSlides.length);
      setNewSlideFile(null);
    } catch (err) {
      setSlideError(err.message || 'Could not add hero image.');
    } finally {
      setUploadingSlide(false);
    }
  };

  const handleDeleteSlide = async (slideId) => {
    try {
      await deleteHeroSlide(slideId);
    } catch (err) {
      toast.error(err.message || 'Could not remove that image.');
    }
  };

  const handleAddPromotion = async () => {
    if (!newPromoText.trim()) {
      setPromoError('Promotion text is required.');
      return;
    }
    setPromoError('');
    setSavingPromo(true);
    try {
      let imageUrl = '';
      if (newPromoFile) imageUrl = await uploadPromoImage(restaurantId, newPromoFile);
      await addPromotion(restaurantId, { imageUrl, text: newPromoText.trim() }, promotions.length);
      setNewPromoFile(null);
      setNewPromoText('');
    } catch (err) {
      setPromoError(err.message || 'Could not add promotion.');
    } finally {
      setSavingPromo(false);
    }
  };

  const handleTogglePromoActive = async (promo) => {
    try {
      await updatePromotion(promo.id, { isActive: !promo.isActive });
    } catch (err) {
      toast.error(err.message || 'Could not update that promotion.');
    }
  };

  const handleDeletePromotion = async (promoId) => {
    try {
      await deletePromotion(promoId);
    } catch (err) {
      toast.error(err.message || 'Could not delete that promotion.');
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
        <h2>Home Page — Hero</h2>
        <p className="form-hint">
          This is the banner customers see first when they scan your QR code. Leave anything blank to use the
          default.
        </p>

        <form className="settings-form" onSubmit={handleHeroSubmit}>
          <label>
            Small label
            <input value={heroForm.heroLabel} onChange={updateHero('heroLabel')} placeholder="Good Food" maxLength={60} />
          </label>
          <label>
            Main heading
            <input
              value={heroForm.heroHeading}
              onChange={updateHero('heroHeading')}
              placeholder="Good Food. Good Mood."
              maxLength={120}
            />
          </label>
          <label>
            Description
            <textarea
              value={heroForm.heroDescription}
              onChange={updateHero('heroDescription')}
              placeholder="Fresh ingredients and unforgettable experiences."
              maxLength={240}
              rows={2}
            />
          </label>
          <label>
            Button text
            <input
              value={heroForm.heroButtonText}
              onChange={updateHero('heroButtonText')}
              placeholder="View Menu"
              maxLength={40}
            />
          </label>
          <label>
            Heading font
            <select value={heroForm.heroFontFamily} onChange={updateHero('heroFontFamily')}>
              {FONT_FAMILY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Heading size
            <select value={heroForm.heroFontSize} onChange={updateHero('heroFontSize')}>
              {FONT_SIZE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Heading weight
            <select value={heroForm.heroFontWeight} onChange={updateHero('heroFontWeight')}>
              {FONT_WEIGHT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {heroError && <p className="form-error">{heroError}</p>}

          <button type="submit" className="btn btn-primary" disabled={savingHero}>
            {savingHero ? 'Saving…' : 'Save hero text'}
          </button>
        </form>

        <div className="hero-slides-manager">
          <p className="form-hint">Hero images — up to 4. Shown as an automatic slideshow when you have more than one.</p>
          <div className="hero-slides-grid">
            {heroSlides.map((slide) => (
              <div className="hero-slide-thumb" key={slide.id}>
                <img src={slide.imageUrl} alt="" />
                <button
                  type="button"
                  className="hero-slide-remove"
                  aria-label="Remove image"
                  onClick={() => handleDeleteSlide(slide.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {heroSlides.length < 4 ? (
            <div className="input-with-action">
              <input type="file" accept="image/*" onChange={(e) => setNewSlideFile(e.target.files?.[0] || null)} />
              <button type="button" className="btn btn-small btn-primary" onClick={handleAddSlide} disabled={!newSlideFile || uploadingSlide}>
                {uploadingSlide ? 'Uploading…' : 'Add image'}
              </button>
            </div>
          ) : (
            <p className="form-hint">You've reached the 4-image limit — remove one to add another.</p>
          )}
          {slideError && <p className="form-error">{slideError}</p>}
        </div>
      </section>

      <section className="settings-section">
        <h2>Home Page — Featured Items</h2>
        <p className="form-hint">
          Popular Items, Fast Moving, Chef's Choice, Best Sellers and Recommended are powered by the same
          "Highlight badges" you already set per item on the <strong>Menu</strong> page — tag an item there and it
          appears in the matching section automatically.
        </p>
      </section>

      <section className="settings-section">
        <h2>Home Page — Promotions</h2>
        <p className="form-hint">Shown as a swipeable carousel on the customer Home page. Only active promotions are shown to customers.</p>

        <div className="promo-list">
          {promotions.length === 0 && <p className="form-hint">No promotions yet.</p>}
          {promotions.map((promo) => (
            <div className="promo-row" key={promo.id}>
              {promo.imageUrl ? (
                <img src={promo.imageUrl} alt="" className="promo-row-media" />
              ) : (
                <div className="promo-row-media promo-row-media--empty">No image</div>
              )}
              <div className="promo-row-body">
                <span>{promo.text}</span>
                <label className="promo-row-toggle">
                  <input type="checkbox" checked={promo.isActive} onChange={() => handleTogglePromoActive(promo)} />
                  Active
                </label>
              </div>
              <button type="button" className="btn btn-small btn-ghost" onClick={() => handleDeletePromotion(promo.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>

        <div className="promo-add-form">
          <label>
            Promotion text
            <input
              value={newPromoText}
              onChange={(e) => setNewPromoText(e.target.value)}
              placeholder="20% OFF Weekend"
              maxLength={120}
            />
          </label>
          <label>
            Image (optional)
            <input type="file" accept="image/*" onChange={(e) => setNewPromoFile(e.target.files?.[0] || null)} />
          </label>
          {promoError && <p className="form-error">{promoError}</p>}
          <button type="button" className="btn btn-primary" onClick={handleAddPromotion} disabled={savingPromo}>
            {savingPromo ? 'Adding…' : 'Add promotion'}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Customer Theme</h2>
        <p className="form-hint">
          Choose the colors customers see when they scan your QR code. Pick a preset, or set your own background
          and accent. Text, buttons and cards adjust automatically so everything stays readable. This only
          changes the customer ordering page, not this dashboard.
        </p>
        <ThemeSettings restaurantId={restaurantId} />
      </section>

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
