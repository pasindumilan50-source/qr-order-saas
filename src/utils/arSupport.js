// Device helpers for the optional 3D / AR feature.

export function isAppleDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as a Mac but has a touch screen.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

// Should the "View in 3D / AR" button be shown for this menu item on this device?
//  - GLB present  -> yes (interactive 3D everywhere, AR where supported)
//  - USDZ only    -> only on iPhone/iPad, where AR Quick Look can open it
//  - neither      -> no
export function hasViewableModel(item) {
  if (!item) return false;
  if (item.modelGlbUrl) return true;
  return !!item.modelUsdzUrl && isAppleDevice();
}
