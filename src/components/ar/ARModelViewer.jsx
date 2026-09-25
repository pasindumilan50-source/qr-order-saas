import { useEffect, useRef, useState } from 'react';
import { isAppleDevice } from '../../utils/arSupport';

const LOAD_TIMEOUT_MS = 30000;
// Default when the admin hasn't set a size for this dish. Most uploaded
// models (scans, downloaded assets) aren't authored at real-world scale, so
// AR can place them far too big or too small — we normalize to roughly this
// size unless the item has its own value.
const DEFAULT_SIZE_M = 0.15;

// Resize a just-loaded model so it appears at a sensible real-world size in
// AR. `targetM` comes from the item's own "Real-world size" field when the
// admin set one, else the app default — either way this works regardless of
// the units/scale the model was originally modelled or scanned at.
function autoScale(el, targetM) {
  try {
    el.scale = '1 1 1';
    const dims = el.getDimensions();
    const maxDim = Math.max(dims.x, dims.y, dims.z);
    if (!Number.isFinite(maxDim) || maxDim <= 0) return;
    const factor = targetM / maxDim;
    // Only step in when the model is clearly off (>2x too big/small) — a
    // model that's already close to the target is left exactly as authored.
    if (factor < 0.5 || factor > 2) {
      el.scale = `${factor} ${factor} ${factor}`;
    }
  } catch {
    // getDimensions() can be unavailable briefly right after 'load'; the
    // model still displays, just at its original scale.
  }
}

// Full-screen 3D viewer. This file (and the ~1 MB @google/model-viewer library)
// is only downloaded when a customer taps "View in 3D / AR" — see ARButton.
export default function ARModelViewer({ item, onClose }) {
  const ref = useRef(null);
  const [libReady, setLibReady] = useState(false);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [attempt, setAttempt] = useState(0);

  const glb = item.modelGlbUrl;
  const usdz = item.modelUsdzUrl;
  const apple = isAppleDevice();
  const usdzOnly = !glb && !!usdz;

  // Load the web component on demand.
  useEffect(() => {
    if (usdzOnly) return undefined;
    let cancelled = false;
    import('@google/model-viewer')
      .then(() => !cancelled && setLibReady(true))
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [usdzOnly]);

  // Wire load/error events + a network timeout.
  useEffect(() => {
    const el = ref.current;
    if (!libReady || !el) return undefined;
    setStatus('loading');
    const onLoad = () => {
      setStatus('ready');
      const targetM = item.modelSizeCm ? item.modelSizeCm / 100 : DEFAULT_SIZE_M;
      autoScale(el, targetM);
      el.cameraOrbit = '0deg 75deg 40%';
      el.jumpCameraToGoal();
    };
    const onError = () => setStatus('error');
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    const timer = setTimeout(() => setStatus((s) => (s === 'loading' ? 'error' : s)), LOAD_TIMEOUT_MS);
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
      clearTimeout(timer);
    };
  }, [libReady, attempt]);

  // Close on Escape + lock background scroll.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="ar-overlay" role="dialog" aria-modal="true" aria-label={`${item.name} in 3D`}>
      <div className="ar-topbar">
        <strong className="ar-title">{item.name}</strong>
        <button type="button" className="ar-close" onClick={onClose} aria-label="Close 3D view">
          ✕
        </button>
      </div>

      <div className="ar-stage">
        {usdzOnly ? (
          // iPhone/iPad with only a USDZ file: open Apple's AR Quick Look directly.
          <div className="ar-usdz-only">
            <p>Tap below to see this dish on your table in AR.</p>
            {apple ? (
              <a rel="ar" href={usdz} className="ar-quicklook">
                {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span aria-hidden="true">🍽️</span>}
                <span>View in AR</span>
              </a>
            ) : (
              <p className="ar-note">AR for this dish is available on iPhone and iPad.</p>
            )}
          </div>
        ) : (
          libReady && (
            <model-viewer
              key={attempt}
              ref={ref}
              class="ar-model"
              src={glb}
              ios-src={usdz || undefined}
              poster={item.imageUrl || undefined}
              alt={`3D model of ${item.name}`}
              camera-controls=""
              auto-rotate=""
              touch-action="pan-y"
              shadow-intensity="1"
              exposure="1"
              ar=""
              ar-modes="webxr scene-viewer quick-look"
              ar-scale="fixed"
              loading="eager"
            >
              {/* model-viewer only shows this button on devices/browsers that can actually launch AR. */}
              <button slot="ar-button" type="button" className="ar-launch">
                View in AR
              </button>
            </model-viewer>
          )
        )}

        {!usdzOnly && status === 'loading' && (
          <div className="ar-loading" aria-live="polite">
            <div className="ar-spinner" />
            <span>Loading 3D model…</span>
          </div>
        )}

        {!usdzOnly && status === 'error' && (
          <div className="ar-error" role="alert">
            <p>3D model couldn&apos;t be loaded. Please try again.</p>
            <button
              type="button"
              className="ar-retry"
              onClick={() => {
                setStatus('loading');
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {!usdzOnly && status === 'ready' && <p className="ar-hint">Drag to rotate · Pinch to zoom</p>}
    </div>
  );
}
