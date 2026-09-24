import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';
import { getRestaurant, updateRestaurantTheme } from '../../services/restaurantService';
import { buildTheme, normalizeHex, PRESETS, BACKGROUND_SWATCHES } from '../../utils/theme';

// One saved theme per restaurant (columns on that restaurant's own row).
// Only the customer QR page reads it; the admin UI is never re-themed.
export default function ThemeSettings({ restaurantId }) {
  const toast = useToast();
  const [restaurant, setRestaurant] = useState(null);
  const [bg, setBg] = useState('');
  const [accent, setAccent] = useState(''); // '' = automatic
  const [preset, setPreset] = useState('');
  const [saved, setSaved] = useState({ bg: '', accent: '', preset: '' });
  const [bgText, setBgText] = useState('');
  const [accentText, setAccentText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getRestaurant(restaurantId)
      .then((r) => {
        if (cancelled || !r) return;
        setRestaurant(r);
        setBg(r.themeBg);
        setAccent(r.themeAccent);
        setPreset(r.themePreset);
        setSaved({ bg: r.themeBg, accent: r.themeAccent, preset: r.themePreset });
      })
      .catch((e) => !cancelled && setError(e.message || 'Could not load theme.'));
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  const theme = useMemo(() => buildTheme({ bg, accent }), [bg, accent]);
  const dirty = bg !== saved.bg || accent !== saved.accent || preset !== saved.preset;

  useEffect(() => setBgText(bg), [bg]);
  useEffect(() => setAccentText(accent || theme?.accent || ''), [accent, theme?.accent]);

  const pickPreset = (p) => {
    setBg(p.bg);
    setAccent(p.accent);
    setPreset(p.id);
  };
  const pickBg = (v) => {
    setBg(v);
    setPreset('');
  };
  const pickAccent = (v) => {
    setAccent(v);
    setPreset('');
  };
  const commitText = (raw, setter) => {
    const hex = normalizeHex(raw);
    if (hex) setter(hex);
  };

  const save = async (next = { bg, accent, preset }) => {
    setSaving(true);
    setError('');
    try {
      await updateRestaurantTheme(restaurantId, next);
      setSaved(next);
      toast.success?.(next.bg ? 'Theme saved. Customers will see it right away.' : 'Theme reset to default.');
    } catch (e) {
      setError(e.message || 'Could not save theme.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setBg('');
    setAccent('');
    setPreset('');
    save({ bg: '', accent: '', preset: '' });
  };

  const initial = (restaurant?.name || 'R').trim().charAt(0).toUpperCase();
  const previewStyle = theme?.vars;

  return (
    <div className="theme-editor">
      <div>
        <div className="theme-block">
          <h3>Start from a preset</h3>
          <div className="theme-presets">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`theme-preset ${preset === p.id ? 'selected' : ''}`}
                onClick={() => pickPreset(p)}
              >
                <span className="theme-preset-chip" style={{ background: p.bg }}>
                  <i style={{ background: p.accent }} />
                </span>
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="theme-block">
          <h3>Theme background</h3>
          <div className="theme-swatches">
            {BACKGROUND_SWATCHES.map((c) => (
              <button
                type="button"
                key={c.value}
                title={c.name}
                aria-label={c.name}
                className={`theme-swatch ${bg === c.value ? 'selected' : ''}`}
                style={{ background: c.value }}
                onClick={() => pickBg(c.value)}
              />
            ))}
          </div>
          <div className="theme-color-row" style={{ marginTop: 10 }}>
            <input
              type="color"
              aria-label="Custom background color"
              value={bg || '#ffffff'}
              onChange={(e) => pickBg(e.target.value)}
            />
            <input
              type="text"
              value={bgText}
              placeholder="#ffffff"
              maxLength={7}
              onChange={(e) => setBgText(e.target.value)}
              onBlur={() => commitText(bgText, pickBg)}
            />
            <span className="form-hint">Custom color — pick any shade</span>
          </div>
        </div>

        <div className="theme-block">
          <h3>Accent color (buttons &amp; highlights)</h3>
          <div className="theme-color-row">
            <input
              type="color"
              aria-label="Accent color"
              value={accent || theme?.accent || '#4f46e5'}
              onChange={(e) => pickAccent(e.target.value)}
            />
            <input
              type="text"
              value={accentText}
              maxLength={7}
              onChange={(e) => setAccentText(e.target.value)}
              onBlur={() => commitText(accentText, pickAccent)}
            />
            {accent && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => pickAccent('')}>
                Use automatic accent
              </button>
            )}
          </div>
          <span className="form-hint">
            {accent ? 'Custom accent.' : 'Automatic: chosen to match your background.'}
            {theme?.accentAdjusted && ' We slightly adjusted it so buttons and prices stay easy to read.'}
          </span>
        </div>

        {error && <p className="form-error">{error}</p>}

        <div className="theme-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !dirty || (!bg && !saved.bg)}
            onClick={() => save()}
          >
            {saving ? 'Saving…' : 'Save theme'}
          </button>
          <button type="button" className="btn btn-secondary" disabled={saving || (!bg && !saved.bg)} onClick={reset}>
            Reset to default
          </button>
        </div>
        {!bg && <p className="form-hint" style={{ marginTop: 8 }}>No custom theme — customers see the standard light design.</p>}
      </div>

      <div className="theme-preview-col">
        <h3 style={{ fontSize: 14 }}>Live preview</h3>
        <div className="tp-frame">
          <div className="tp" style={previewStyle}>
            <div className="tp-header">
              <span className="tp-logo">
                {restaurant?.logo ? <img src={restaurant.logo} alt="" /> : initial}
              </span>
              <div>
                <div className="tp-name">{restaurant?.name || 'Your Restaurant'}</div>
                <div className="tp-table">Table 5</div>
              </div>
              <span className="tp-cart">Cart · 2</span>
            </div>

            <div className="tp-hero">
              <small>{restaurant?.heroLabel || 'Welcome'}</small>
              <h4>{restaurant?.heroHeading || 'Fresh food, made for you'}</h4>
              <p>{restaurant?.heroDescription || 'Scan, order and enjoy at your table.'}</p>
              <span className="tp-cta">{restaurant?.heroButtonText || 'View menu'}</span>
            </div>

            <div className="tp-h">Popular Items</div>
            <div className="tp-cards">
              {[
                ['Chicken Rice', 'LKR 1,250'],
                ['Garden Salad', 'LKR 890'],
              ].map(([n, pr]) => (
                <div className="tp-card" key={n}>
                  <div className="tp-card-img" />
                  <div className="tp-card-body">
                    <strong>{n}</strong>
                    <span className="tp-price">{pr}</span>
                    <span className="tp-add">+</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="tp-h">Promotions</div>
            <div className="tp-promo">20% off all desserts today</div>

            <div className="tp-btns">
              <span className="tp-btn">Details</span>
              <span className="tp-btn primary">Place order</span>
            </div>
            <p style={{ textAlign: 'center', marginTop: 10, fontSize: 11 }}>Secondary text looks like this</p>
          </div>
        </div>
      </div>
    </div>
  );
}
