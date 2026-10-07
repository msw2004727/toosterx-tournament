import { el } from '../../core/ui.js';
import { icon } from '../../core/icons.js';
import { EVENT, VENUE_MAPS, CACHE_VERSION } from '../../config.js';
import { venueMapDay, orderedVenueMaps, shouldShowVenueMap, rememberVenueMapDay } from '../../lib/venue-map-policy.js';

/** 每次進入首頁建立一次，資料重繪不會重開；離開首頁清理彈窗。 */
export function createVenueMapPopup() {
  let dialog = null, previousFocus = null, oldOverflow = '', disposed = false;
  // localStorage getter 本身在部分 Safari 設定下也會丟出例外。
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  function close() {
    if (!dialog) return;
    dialog.close(); dialog.remove(); dialog = null;
    document.body.style.overflow = oldOverflow;
    if (previousFocus?.isConnected) previousFocus.focus();
  }
  function open({ automatic = false } = {}) {
    if (disposed || dialog) return;
    const day = venueMapDay(new Date(), EVENT.timezone);
    if (automatic && !shouldShowVenueMap(storage, EVENT.id, day)) return;
    const maps = orderedVenueMaps(VENUE_MAPS, day);
    if (!maps.length) return;
    let index = 0, start = null;
    const image = el('img', { class: 'venue-map__image', draggable: 'false', width: 1536, height: 1024 });
    const caption = el('p', { class: 'venue-map__caption', 'aria-live': 'polite' });
    const dots = maps.map((map, i) => el('button', { class: 'venue-map__dot', type: 'button',
      'aria-label': `查看${map.label}`, onClick: () => show(i) }));
    function show(next) {
      index = (next + maps.length) % maps.length;
      image.src = `${maps[index].src}?v=${CACHE_VERSION}`;
      image.alt = `${EVENT.venueName}：${maps[index].label}`;
      caption.textContent = `${index === 0 ? '今日配置' : '其他日期配置'} · ${maps[index].label} · ${index + 1} / ${maps.length}`;
      dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === index)));
    }
    const stage = el('div', { class: 'venue-map__stage',
      onPointerdown: e => { if (e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0)) {
        start = { id: e.pointerId, x: e.clientX, y: e.clientY };
        try { stage.setPointerCapture(e.pointerId); } catch { /* 已取消的手勢不阻斷其他操作。 */ }
      } },
      onPointerup: e => { if (!start || start.id !== e.pointerId) return;
        const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
        if (Math.abs(dx) >= 40 && Math.abs(dx) > Math.abs(dy) * 1.3) show(index + (dx < 0 ? 1 : -1));
      }, onPointercancel: () => { start = null; }
    }, image);
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
        e.preventDefault(); show(index + (e.key === 'ArrowLeft' ? -1 : 1));
      } }
    }, [
      el('header', { class: 'venue-map__head' }, [
        el('div', {}, [el('p', { class: 'venue-map__eyebrow', text: EVENT.venueName }),
          el('h2', { id: 'venue-map-title', text: '今日場地配置' })]),
        el('button', { class: 'venue-map__close', type: 'button', 'aria-label': '關閉場地配置', onClick: close }, icon('close'))
      ]), stage,
      el('div', { class: 'venue-map__navigation' }, [
        el('button', { class: 'venue-map__arrow', type: 'button', 'aria-label': '上一張場地圖', onClick: () => show(index - 1) }, icon('back')),
        el('div', { class: 'venue-map__dots' }, dots),
        el('button', { class: 'venue-map__arrow', type: 'button', 'aria-label': '下一張場地圖', onClick: () => show(index + 1) }, icon('forward'))
      ]), caption,
      el('footer', { class: 'venue-map__footer' }, [
        el('label', { class: 'venue-map__remember' }, [hide, el('span', { text: '今日不再顯示' })]),
        el('span', { class: 'venue-map__hint', text: '左右滑動查看另一張' })
      ])
    ]);
    show(0); previousFocus = document.activeElement; oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; document.body.append(dialog); dialog.showModal();
  }
  return { open, dispose() { close(); disposed = true; } };
}
