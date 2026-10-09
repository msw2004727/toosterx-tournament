/** Two fingers own the canvas. One finger keeps native page scrolling. */
export function attachBracketGestures(scroll, tree, saved) {
  const listeners = [];
  let scale = 1, fit = 1, x = 0, y = 0, width = 0, height = 0, vw = 0, vh = 0;
  let changed = false, initialized = false, frame = 0, gesture = null, mouse = null, suppress = false;
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const clamp = value => Math.max(fit * .35, Math.min(Math.max(5, fit * 12), value));
  function paint() {
    frame = 0;
    tree.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`;
    scroll.dataset.scale = String(scale); scroll.dataset.panX = String(x); scroll.dataset.panY = String(y);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  function resize() {
    const oldScale = scale, oldFit = fit, cx = (vw / 2 - x) / scale, cy = (vh / 2 - y) / scale;
    width = tree.offsetWidth; height = tree.offsetHeight;
    vw = scroll.clientWidth; vh = scroll.clientHeight;
    fit = Math.min(1, vw / width, vh / (height + 36));
    if (!initialized) {
      initialized = true; changed = saved?.changed === true;
      scale = changed ? clamp(fit * saved.zoom) : fit;
      x = changed ? saved.x : (vw - width * scale) / 2;
      y = changed ? saved.y : 18 * scale;
    } else if (!changed) { scale = fit; x = (vw - width * scale) / 2; y = 18 * scale; }
    else { scale = clamp(oldScale * fit / oldFit); x = vw / 2 - cx * scale; y = vh / 2 - cy * scale; }
    tree.style.width = `${width}px`; schedule();
  }
  const pair = touches => {
    const [a, b] = touches, r = scroll.getBoundingClientRect();
    return { distance: Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)),
      x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top };
  };
  function start(touches) {
    const p = pair(touches);
    gesture = { ids: [touches[0].identifier, touches[1].identifier], distance: p.distance, scale,
      worldX: (p.x - x) / scale, worldY: (p.y - y) / scale };
    suppress = true;
  }
  const inside = e => [...e.touches].filter(t => scroll.contains(t.target));
  on(scroll, 'touchstart', e => {
    const touches = inside(e);
    if (touches.length < 2) { gesture = null; suppress = false; return; }
    e.preventDefault(); start(touches);
  }, { passive: false });
  on(scroll, 'touchmove', e => {
    const touches = inside(e);
    if (touches.length < 2) return;
    e.preventDefault();
    const selected = gesture?.ids.map(id => touches.find(t => t.identifier === id));
    if (!selected || selected.some(t => !t)) start(touches);
    const p = pair(gesture.ids.map(id => touches.find(t => t.identifier === id)));
    scale = clamp(gesture.scale * p.distance / gesture.distance);
    x = p.x - gesture.worldX * scale; y = p.y - gesture.worldY * scale;
    changed = true; schedule();
  }, { passive: false });
  const endTouch = e => { const touches = inside(e); if (touches.length < 2) gesture = null; else start(touches); };
  on(scroll, 'touchend', endTouch); on(scroll, 'touchcancel', endTouch);
  on(scroll, 'pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    suppress = false; mouse = { id: e.pointerId, clientX: e.clientX, clientY: e.clientY, x, y };
  });
  on(scroll, 'pointermove', e => {
    if (!mouse || mouse.id !== e.pointerId) return;
    const dx = e.clientX - mouse.clientX, dy = e.clientY - mouse.clientY;
    if (!suppress && Math.hypot(dx, dy) < 6) return;
    suppress = true; changed = true; x = mouse.x + dx; y = mouse.y + dy;
    if (!scroll.hasPointerCapture(e.pointerId)) scroll.setPointerCapture(e.pointerId);
    e.preventDefault(); scroll.classList.add('is-dragging'); schedule();
  });
  const endMouse = e => {
    if (mouse?.id !== e.pointerId) return;
    mouse = null; scroll.classList.remove('is-dragging');
    if (scroll.hasPointerCapture(e.pointerId)) scroll.releasePointerCapture(e.pointerId);
  };
  on(window, 'pointerup', endMouse); on(window, 'pointercancel', endMouse); on(scroll, 'lostpointercapture', endMouse);
  on(scroll, 'click', e => { if (suppress && e.detail !== 0) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  on(scroll, 'wheel', e => {
    e.preventDefault(); changed = true;
    if (e.ctrlKey || e.metaKey) {
      const r = scroll.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const worldX = (px - x) / scale, worldY = (py - y) / scale;
      scale = clamp(scale * Math.exp(-e.deltaY * .01)); x = px - worldX * scale; y = py - worldY * scale;
    } else { x -= e.deltaX; y -= e.deltaY; }
    schedule();
  }, { passive: false });
  on(scroll, 'keydown', e => {
    if (e.target !== scroll || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); changed = true;
    x += e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0;
    y += e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0; schedule();
  });
  const observer = new ResizeObserver(resize); observer.observe(scroll); observer.observe(tree); resize(); cancelAnimationFrame(frame); paint();
  return {
    state: () => ({ changed, zoom: scale / fit, x, y }),
    disconnect: () => { observer.disconnect(); cancelAnimationFrame(frame); listeners.splice(0).forEach(off => off()); gesture = mouse = null; }
  };
}
