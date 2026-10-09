/** Gesture ownership stays on the crown canvas; native taps and keyboard clicks stay intact. */
export function attachBracketGestures(scroll, tree, shell, controls, saved) {
  const pointers = new Map(), listeners = [];
  let scale = 1, fit = 1, width = 0, height = 0, changed = false, gesture = null, suppress = false;
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const local = point => { const r = scroll.getBoundingClientRect(); return { x: point.x - r.left, y: point.y - r.top }; };
  const clamp = value => Math.max(fit, Math.min(Math.max(3, fit * 4), value));
  const inset = () => Math.max(0, (scroll.clientWidth - width * scale) / 2);
  function paint() {
    tree.style.transform = `scale(${scale})`;
    tree.style.top = `${18 * scale}px`;
    shell.style.width = `${width * scale}px`;
    shell.style.height = `${height * scale}px`;
    controls.label.textContent = `${Math.round(scale * 100)}%`;
    controls.out.disabled = scale <= fit + .001;
    controls.in.disabled = scale >= Math.max(3, fit * 4) - .001;
    scroll.dataset.scale = String(scale);
    scroll.dispatchEvent(new Event('scroll'));
  }
  function zoom(value, point = { x: scroll.clientWidth / 2, y: scroll.clientHeight / 2 }) {
    const x = (scroll.scrollLeft + point.x - inset()) / scale, y = (scroll.scrollTop + point.y) / scale;
    scale = clamp(value); changed = true; paint();
    scroll.scrollLeft = x * scale + inset() - point.x;
    scroll.scrollTop = y * scale - point.y;
  }
  function reset() {
    changed = false; scale = fit; paint(); scroll.scrollLeft = 0; scroll.scrollTop = 0;
  }
  let initialized = false;
  function resize() {
    const oldScale = scale, oldFit = fit;
    const cx = (scroll.scrollLeft + scroll.clientWidth / 2 - inset()) / oldScale;
    const cy = (scroll.scrollTop + scroll.clientHeight / 2) / oldScale;
    width = tree.offsetWidth; height = tree.offsetHeight + 36;
    fit = Math.min(1, scroll.clientWidth / width, scroll.clientHeight / height);
    if (!initialized) {
      initialized = true;
      changed = saved?.changed === true;
      scale = changed ? clamp(fit * saved.zoom) : fit;
      paint(); scroll.scrollLeft = saved?.left || 0; scroll.scrollTop = saved?.top || 0;
    } else if (!changed) reset();
    else {
      scale = clamp(scale * fit / oldFit); paint();
      scroll.scrollLeft = cx * scale + inset() - scroll.clientWidth / 2;
      scroll.scrollTop = cy * scale - scroll.clientHeight / 2;
    }
  }
  function begin() {
    const points = [...pointers.values()];
    if (points.length >= 2) {
      const [a, b] = points, p = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      gesture = { type: 'pinch', distance: Math.hypot(a.x - b.x, a.y - b.y), scale,
        x: (scroll.scrollLeft + p.x - inset()) / scale, y: (scroll.scrollTop + p.y) / scale };
      suppress = true;
    } else if (points.length) gesture = { type: 'pan', ...points[0], left: scroll.scrollLeft, top: scroll.scrollTop };
    else gesture = null;
  }
  on(scroll, 'pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (!pointers.size) suppress = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); begin();
  });
  on(scroll, 'pointermove', e => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...pointers.values()];
    if (gesture.type === 'pinch' && points.length >= 2) {
      const [a, b] = points, p = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, gesture.distance));
      changed = true; paint(); scroll.scrollLeft = gesture.x * scale + inset() - p.x; scroll.scrollTop = gesture.y * scale - p.y;
    } else {
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (!suppress && Math.hypot(dx, dy) < 6) return;
      suppress = true; changed = true;
      scroll.scrollLeft = gesture.left - dx; scroll.scrollTop = gesture.top - dy;
    }
    scroll.classList.add('is-dragging');
    for (const id of pointers.keys()) if (!scroll.hasPointerCapture(id)) scroll.setPointerCapture(id);
    e.preventDefault();
  });
  const end = e => {
    if (!pointers.delete(e.pointerId)) return;
    if (scroll.hasPointerCapture(e.pointerId)) scroll.releasePointerCapture(e.pointerId);
    begin(); if (!pointers.size) scroll.classList.remove('is-dragging');
  };
  on(window, 'pointerup', end); on(window, 'pointercancel', end); on(scroll, 'lostpointercapture', end);
  on(scroll, 'click', e => { if (suppress && e.detail !== 0) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  on(scroll, 'wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault(); zoom(scale * Math.exp(-e.deltaY * .01), local({ x: e.clientX, y: e.clientY }));
  }, { passive: false });
  on(controls.in, 'click', () => zoom(scale * 1.3));
  on(controls.out, 'click', () => zoom(scale / 1.3));
  on(controls.reset, 'click', reset);
  const observer = new ResizeObserver(resize); observer.observe(scroll); observer.observe(tree); resize();
  return {
    state: () => ({ changed, zoom: scale / fit, left: scroll.scrollLeft, top: scroll.scrollTop }),
    disconnect: () => { observer.disconnect(); listeners.splice(0).forEach(off => off()); pointers.clear(); }
  };
}
