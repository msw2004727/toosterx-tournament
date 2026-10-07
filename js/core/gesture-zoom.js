/** Limit browser zoom gestures while keeping single-finger scrolling available. */
export function initGestureZoom(target = document) {
  const blockGesture = event => event.preventDefault();
  const blockPinch = event => {
    if (event.touches.length > 1) event.preventDefault();
  };
  const options = { passive: false, capture: true };
  // Safari exposes native gesture events even when viewport restrictions are ignored.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, blockGesture, options);
  }
  target.addEventListener('touchmove', blockPinch, options);
  return () => {
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      target.removeEventListener(type, blockGesture, options);
    }
    target.removeEventListener('touchmove', blockPinch, options);
  };
}
