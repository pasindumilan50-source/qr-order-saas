// Customer-UI theme generation.
// Input: a background color (+ optional accent). Output: a complete, readable
// set of CSS custom properties. Contrast is enforced automatically, so the
// owner can pick any color without producing an unreadable page.

const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

export function normalizeHex(v) {
  if (!v) return null;
  let s = String(v).trim();
  if (!s.startsWith('#')) s = `#${s}`;
  if (/^#[0-9a-f]{3}$/i.test(s)) s = `#${[...s.slice(1)].map((c) => c + c).join('')}`;
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null;
}

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) =>
  `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return rgbToHex(...rgb.map((v) => (v + m) * 255));
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

// Nudge `fg` lighter/darker (keeping its hue) until it reaches `min` contrast
// against every color in `against`. Direction follows the first background.
function ensureContrast(fg, against, min) {
  const list = Array.isArray(against) ? against : [against];
  const ok = (c) => list.every((bg) => contrast(c, bg) >= min);
  if (ok(fg)) return fg;
  const [h, s, l0] = hexToHsl(fg);
  const goDarker = luminance(list[0]) > 0.4;
  for (let i = 1; i <= 50; i += 1) {
    const l = clamp(l0 + (goDarker ? -1 : 1) * i * 0.02, 0, 1);
    const c = hslToHex(h, s, l);
    if (ok(c)) return c;
  }
  return goDarker ? '#000000' : '#ffffff';
}

const bestOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

// ---------------------------------------------------------------------------
export function buildTheme({ bg, accent } = {}) {
  const base = normalizeHex(bg);
  if (!base) return null; // no custom theme -> existing default look

  const [h, s, l] = hexToHsl(base);
  const isDark = luminance(base) < 0.18;

  // Text
  const text = ensureContrast(
    isDark ? hslToHex(h, Math.min(s, 0.25), 0.94) : hslToHex(h, Math.min(s, 0.3), 0.11),
    base,
    7
  );

  // Surfaces
  const surface = l > 0.97 ? '#ffffff' : isDark ? mix(base, '#ffffff', 0.09) : mix(base, '#ffffff', 0.6);
  const border = mix(surface, text, isDark ? 0.18 : 0.14);
  const inputBg = isDark ? mix(base, '#ffffff', 0.05) : mix(base, '#ffffff', 0.85);
  const hover = mix(base, text, 0.1);

  // Muted text must stay readable on both the page and the cards.
  let muted = mix(text, surface, 0.38);
  for (let t = 0.38; t >= 0 && !(contrast(muted, surface) >= 4.5 && contrast(muted, base) >= 4.5); t -= 0.06) {
    muted = mix(text, surface, Math.max(t, 0));
  }

  // Accent (auto-derived from the background when not chosen)
  let accentIn = normalizeHex(accent);
  if (!accentIn) {
    accentIn =
      s > 0.15
        ? hslToHex(h, clamp(s + 0.1, 0.35, 0.7), isDark ? 0.62 : 0.28)
        : isDark
          ? '#a5b4fc'
          : '#4f46e5';
  }
  const accentFinal = ensureContrast(accentIn, [surface, base], 3);
  const accentAdjusted = accentFinal !== accentIn;
  const onPrimary = bestOn(accentFinal);
  const primaryDark = mix(accentFinal, '#000000', 0.14);

  // Dark panels (hero, promotions, header chips): always dark, always readable.
  const [ah, as] = hexToHsl(accentFinal);
  let ink = hslToHex(ah, Math.min(as, 0.55), 0.14);
  if (Math.abs(luminance(ink) - luminance(base)) < 0.03) ink = mix(base, '#ffffff', 0.16);
  let inkSoft = mix(ink, accentFinal, 0.3);
  if (contrast(inkSoft, '#f8fafc') < 4.5) inkSoft = ink;

  // Accent buttons that sit ON the dark panels need their own contrast check.
  const heroCtaBg = ensureContrast(accentFinal, ink, 3);
  const heroCtaFg = bestOn(heroCtaBg);

  const vars = {
    '--color-bg': base,
    '--color-surface': surface,
    '--color-border': border,
    '--color-text': text,
    '--color-text-muted': muted,
    '--color-primary': accentFinal,
    '--color-primary-dark': primaryDark,
    '--on-primary': onPrimary,
    '--color-input-bg': inputBg,
    '--color-hover': hover,
    '--menu-ink': ink,
    '--menu-ink-soft': inkSoft,
    '--menu-text-on-ink': '#f8fafc',
    '--menu-text-on-ink-muted': '#c3cad6',
    '--hero-cta-bg': heroCtaBg,
    '--hero-cta-fg': heroCtaFg,
    colorScheme: isDark ? 'dark' : 'light',
  };

  return { vars, isDark, accent: accentFinal, accentAdjusted, background: base };
}

// ---------------------------------------------------------------------------
export const PRESETS = [
  { id: 'classic', name: 'Classic', bg: '#ffffff', accent: '#1f2937' },
  { id: 'warm', name: 'Warm', bg: '#f6efe4', accent: '#8b5e3c' },
  { id: 'elegant', name: 'Elegant', bg: '#fbf8ef', accent: '#1f5c47' },
  { id: 'dark', name: 'Dark', bg: '#1c1c1e', accent: '#f5f5f4' },
  { id: 'forest', name: 'Forest', bg: '#f1ecd9', accent: '#1e4d3a' },
  { id: 'coffee', name: 'Coffee', bg: '#e9dcc9', accent: '#5b3a29' },
  { id: 'modern', name: 'Modern', bg: '#f1f3f7', accent: '#4f46e5' },
  { id: 'luxury', name: 'Luxury', bg: '#0b0b0b', accent: '#d4af37' },
  { id: 'fresh', name: 'Fresh', bg: '#ffffff', accent: '#1d4ed8' },
  { id: 'rose', name: 'Rose', bg: '#fbf3ec', accent: '#b3261e' },
  { id: 'midnight', name: 'Midnight', bg: '#0f1e3d', accent: '#5aa9ff' },
  { id: 'evergreen', name: 'Evergreen', bg: '#14372b', accent: '#e3c16f' },
];

export const BACKGROUND_SWATCHES = [
  { name: 'White', value: '#ffffff' },
  { name: 'Cream', value: '#fbf6ea' },
  { name: 'Beige', value: '#efe3cf' },
  { name: 'Light Green', value: '#e8f3e6' },
  { name: 'Dark Green', value: '#14372b' },
  { name: 'Light Brown', value: '#d9bfa3' },
  { name: 'Dark Brown', value: '#2b1a12' },
  { name: 'Black', value: '#0b0b0b' },
  { name: 'Dark Gray', value: '#1f2124' },
  { name: 'Navy', value: '#0f1e3d' },
];
