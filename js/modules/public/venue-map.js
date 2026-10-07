import { el } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { EVENT, VENUE_MAPS, CACHE_VERSION } from '../../config.js';
import { venueMapDay, orderedVenueMaps, shouldShowVenueMap, rememberVenueMapDay } from '../../lib/venue-map-policy.js';

/** 每次進入首頁建立一次，資料重繪不會重開；離開首頁清理彈窗。 */
export function createVenueMapPopup() {
  let dialog = null, previousFocus = null, oldOverflow = '', disposed = false, stopCarousel = null;
  // localStorage getter 本身在部分 Safari 設定下也會丟出例外。
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  function close() {
    if (!dialog) return;
    stopCarousel?.(); stopCarousel = null;
    dialog.close(); dialog.remove(); dialog = null;
    document.body.style.overflow = oldOverflow;
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function open({ automatic = false } = {}) {
    if (disposed || dialog) return;
    const day = venueMapDay(new Date(), EVENT.timezone);
    if (automatic && !shouldShowVenueMap(storage, EVENT.id, day)) return;
    let maps = orderedVenueMaps(VENUE_MAPS, new Date());
    if (!maps.length) return;
    let index = 0, start = null, animation = null, settleTimer = null, queued = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const caption = el('p', { class: 'venue-map__caption', 'aria-live': 'polite' });
    const dots = maps.map((map, i) => el('button', { class: 'venue-map__dot', type: 'button',
      'aria-label': `查看${map.label}`, onClick: () => { if (i !== index) move(i > index ? 1 : -1); } }));
    const slides = [-1, 0, 1].map(offset => el('div', { class: 'venue-map__slide',
      'aria-hidden': String(offset !== 0) }, el('img', { class: 'venue-map__image',
      draggable: 'false', width: 1536, height: 1024, decoding: 'async' })));
    const track = el('div', { class: 'venue-map__track', onTransitionend: e => {
      if (e.target === track && e.propertyName === 'transform') finish();
    } }, slides);
    const offset = px => track.style.setProperty('--venue-offset', `${px}px`);
    const wrap = i => (i + maps.length) % maps.length;
    function paint() {
      // 前後各保留一張鄰圖；切換完成後無動畫歸位，不露白也不反向滑回。
      track.classList.add('is-resetting');
      slides.forEach((slide, slot) => {
        const map = maps[wrap(index + slot - 1)], image = slide.firstElementChild;
        image.src = `${map.src}?v=${CACHE_VERSION}`;
        image.alt = slot === 1 ? `${EVENT.venueName}：${map.label}` : '';
      });
      offset(0);
      caption.textContent = `${index === 0 ? '今日配置' : '其他日期配置'} · ${maps[index].label} · ${index + 1} / ${maps.length}`;
      dots.forEach((dot, i) => { dot.setAttribute('aria-pressed', String(i === index));
        dot.setAttribute('aria-label', `查看${maps[i].label}`); });
      void track.offsetWidth;
      track.classList.remove('is-resetting');
    }
    function finish() {
      if (!animation) return;
      const completed = animation; animation = null;
      clearTimeout(settleTimer); settleTimer = null;
      index = wrap(index + completed.step);
      if (completed.order) { maps = completed.order; index = 0; }
      paint();
      if (queued) { const step = Math.sign(queued); queued -= step; move(step); }
    }
    function move(step, order = null) {
      if (animation) { queued += step; return; }
      animation = { step, order };
      track.classList.remove('is-dragging');
      void track.offsetWidth;
      offset(-step * stage.clientWidth);
      if (reducedMotion.matches) finish();
      else settleTimer = setTimeout(finish, 420); // 背景分頁／Safari 未送 transitionend 時仍能完成。
    }
    function release(e, cancelled = false) {
      if (!start || start.id !== e.pointerId) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const elapsed = Math.max(1, performance.now() - start.time);
      const horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
      const commit = !cancelled && horizontal && (Math.abs(dx) >= Math.min(100, stage.clientWidth * .22)
        || (Math.abs(dx) >= 16 && Math.abs(dx) / elapsed > .5));
      start = null;
      move(commit ? (dx < 0 ? 1 : -1) : 0);
    }
    const stage = el('div', { class: 'venue-map__stage',
      onPointerdown: e => { if (!animation && e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)) {
        start = { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() };
        track.classList.add('is-dragging');
        try { stage.setPointerCapture(e.pointerId); } catch { /* 已取消的手勢不阻斷其他操作。 */ }
      } },
      onPointermove: e => { if (!start || start.id !== e.pointerId) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y;
        if (Math.abs(dx) > Math.abs(dy)) offset(Math.max(-stage.clientWidth, Math.min(stage.clientWidth, dx)));
      },
      onPointerup: e => release(e), onPointercancel: e => release(e, true)
    }, track);
    function updateOrder() {
      if (animation || start) return;
      const next = orderedVenueMaps(VENUE_MAPS, new Date());
      if (next.every((map, i) => map.id === maps[i].id)) return;
      if (maps[index].id === next[0].id) { maps = next; index = 0; paint(); }
      else move(1, next);
    }
    const orderTimer = setInterval(updateOrder, 1000);
    const resize = () => { start = null; queued = 0; track.classList.remove('is-dragging');
      if (animation) finish(); else paint(); };
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', updateOrder);
    stopCarousel = () => { clearInterval(orderTimer); clearTimeout(settleTimer);
      window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', updateOrder); };
    const hide = el('input', { type: 'checkbox', onChange: () =>
      rememberVenueMapDay(storage, EVENT.id, venueMapDay(new Date(), EVENT.timezone), hide.checked) });
    hide.checked = !shouldShowVenueMap(storage, EVENT.id, day);
    dialog = el('dialog', { class: 'venue-map', 'aria-labelledby': 'venue-map-title',
      onCancel: e => { e.preventDefault(); close(); },
      onClick: e => { if (e.target === dialog) {
        const r = dialog.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
      } },
      onKeydown: e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1);
      } }
    }, [
      el('header', { class: 'venue-map__head' }, [
        el('div', {}, [el('p', { class: 'venue-map__eyebrow', text: EVENT.venueName }),
          el('h2', { id: 'venue-map-title', text: '今日場地配置' })]),
        el('button', { class: 'venue-map__close', type: 'button', 'aria-label': '關閉場地配置', onClick: close }, icon('close'))
      ]), stage,
      el('div', { class: 'venue-map__navigation' }, [
        el('button', { class: 'venue-map__arrow', type: 'button', 'aria-label': '上一張場地圖', onClick: () => move(-1) }, icon('back')),
        el('div', { class: 'venue-map__dots' }, dots),
        el('button', { class: 'venue-map__arrow', type: 'button', 'aria-label': '下一張場地圖', onClick: () => move(1) }, icon('forward'))
      ]), caption,
      el('footer', { class: 'venue-map__footer' }, [
        el('label', { class: 'venue-map__remember' }, [hide, el('span', { text: '今日不再顯示' })]),
        el('span', { class: 'venue-map__hint', text: '左右滑動查看另一張' })
      ])
    ]);
    paint(); previousFocus = document.activeElement; oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; document.body.append(dialog); dialog.showModal();
  }
  return { open, close, dispose() { close(); disposed = true; } };
}

// The header and homepage share one popup, including daily visibility preferences.
let sharedPopup;
export function venueMapPopup() {
  return sharedPopup ??= createVenueMapPopup();
}
