import { Component, lazy, Suspense, useState } from 'react';
import { hasViewableModel } from '../../utils/arSupport';

// The viewer (and the model-viewer library) is a separate chunk: nothing 3D is
// downloaded until the customer taps the button.
const ARModelViewer = lazy(() => import('./ARModelViewer'));

// A failing viewer (e.g. the chunk can't be fetched on a bad network) must never
// take the menu down with it: show a small message and let the customer close it.
class ARBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    console.error('AR viewer failed:', err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="ar-overlay" role="alert">
        <div className="ar-error">
          <p>3D model couldn&apos;t be loaded. Please try again.</p>
          <button type="button" className="ar-retry" onClick={this.props.onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }
}

export default function ARButton({ item }) {
  const [open, setOpen] = useState(false);
  if (!hasViewableModel(item)) return null; // no model -> menu behaves exactly as before

  return (
    <>
      <button type="button" className="ar-button" onClick={() => setOpen(true)}>
        <span aria-hidden="true">🧊</span> View in 3D / AR
      </button>
      {open && (
        <ARBoundary onClose={() => setOpen(false)}>
          <Suspense fallback={null}>
            <ARModelViewer item={item} onClose={() => setOpen(false)} />
          </Suspense>
        </ARBoundary>
      )}
    </>
  );
}
