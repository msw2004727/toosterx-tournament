/**
 * 報名圖文教學（彈窗）
 * ------------------------------------------------------------------
 * 內容在 guide-steps.js；這裡只負責畫。
 *
 * 結構（由上到下）：
 *   標題列 ＋ 關閉
 *   流程分頁（成人組／學童組）
 *   進度圖（SVG：五個階段，走到哪一階亮到哪）
 *   截圖 ＋ SVG 標記（圈出要按的地方、編號）
 *   這一步的標題與說明
 *   上一步／下一步（最後一步是「我要建立球隊」）
 *
 * 以手機窄版為主：截圖是 390×560，用 aspect-ratio 撐住，SVG 疊在同一個框裡，
 * 所以縮到 320px 也對得準。桌面只是同一個面板置中而已。
 *
 * 三件容易做錯的：
 *   1. 圖一次只畫目前這一步（17 張圖不會一開彈窗就全部下載），但**預載下一張**，
 *      按下一步才不會白一下。
 *   2. 關閉要冪等：頁面換掉時 router 會再呼叫一次 close()（經 store.hold）。
 *   3. localStorage 每一次存取都要 try/catch（無痕視窗會直接丟例外）。
 */

import { el, mount } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { CACHE_VERSION } from '../../config.js';
import { FLOWS, FLOW_KEYS, SHOT_W, SHOT_H } from './guide-steps.js';

const NS = 'http://www.w3.org/2000/svg';
const SEEN_KEY = 'feda:regGuideSeen';

export const guideImageUrl = name => `/img/tutorial/${name}.png?v=${CACHE_VERSION}`;

/** 這台裝置看過教學了嗎（存不到就當沒看過：多跳一次總比永遠跳不出來好） */
export function guideSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}
export function markGuideSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* 無痕視窗：算了 */ }
}

function svg(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) n.setAttribute(k, String(v));
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}
function svgText(x, y, text, attrs = {}) {
  const t = svg('text', { x, y, ...attrs });
  t.textContent = text;
  return t;
}

/**
 * 打開教學。回傳 close()（冪等）。
 * @param {{flow?:'adult'|'youth', onStart?:Function, onClose?:Function}} o
 */
export function showRegisterGuide({ flow = 'adult', onStart = null, onClose = null } = {}) {
  const state = { flow: FLOW_KEYS.includes(flow) ? flow : 'adult', i: 0, focus: 'next' };
  let closed = false;

  const panel = el('div', { class: 'modal__panel tut__panel' });
  const dlg = el('div', {
    class: 'modal tut', role: 'dialog', 'aria-modal': 'true', 'aria-label': '報名圖文教學',
    dataset: { flow: state.flow }
  }, panel);

  function cur() { return FLOWS[state.flow]; }
  function step() { return cur().steps[state.i]; }
  function total() { return cur().steps.length; }

  function go(i, focus = 'next') {
    const n = total();
    if (i < 0 || i >= n) return;
    state.i = i; state.focus = focus; render();
  }
  function switchFlow(key) {
    if (!FLOWS[key] || key === state.flow) return;
    state.flow = key; state.i = 0; state.focus = 'tab';
    dlg.dataset.flow = key;
    render();
  }

  // ── 標題列 ─────────────────────────────────────────────
  function head() {
    return el('div', { class: 'tut__head' }, [
      el('h2', { class: 'tut__title', id: 'tut-title' }, iconText('list', '報名怎麼做')),
      el('button', {
        class: 'btn btn--icon tut__close', type: 'button', 'aria-label': '關閉教學',
        onClick: () => close()
      }, icon('close'))
    ]);
  }

  // ── 流程分頁 ───────────────────────────────────────────
  function tabs() {
    return el('div', { class: 'tut__tabs', role: 'tablist', 'aria-label': '報名流程' }, FLOW_KEYS.map(k => {
      const f = FLOWS[k];
      const on = k === state.flow;
      return el('button', {
        class: `tut__tab${on ? ' is-on' : ''}`, type: 'button', role: 'tab',
        'aria-selected': on ? 'true' : 'false', dataset: { flow: k },
        onClick: () => switchFlow(k)
      }, [
        el('strong', { text: f.label }),
        el('span', { text: f.sub })
      ]);
    }));
  }

  // ── 進度圖（SVG）───────────────────────────────────────
  function strip() {
    const stages = cur().stages;
    const n = stages.length;
    const W = 360, cy = 22, padX = 34;
    const gap = (W - padX * 2) / (n - 1);
    const active = step().stage;
    const kids = [];
    kids.push(svg('line', { x1: padX, y1: cy, x2: W - padX, y2: cy, class: 'tut__rail' }));
    if (active > 0) {
      kids.push(svg('line', { x1: padX, y1: cy, x2: padX + gap * active, y2: cy, class: 'tut__rail tut__rail--done' }));
    }
    stages.forEach((label, i) => {
      const cx = padX + gap * i;
      const cls = i < active ? 'done' : i === active ? 'active' : 'todo';
      if (cls === 'active') kids.push(svg('circle', { cx, cy, r: 18, class: 'tut__halo' }));
      kids.push(svg('circle', { cx, cy, r: 13, class: `tut__node tut__node--${cls}` }));
      kids.push(svgText(cx, cy + 4.5, cls === 'done' ? '' : String(i + 1), { class: `tut__num tut__num--${cls}`, 'text-anchor': 'middle' }));
      if (cls === 'done') {
        kids.push(svg('path', { d: `M${cx - 5} ${cy} l3.5 3.5 l6.5 -7`, class: 'tut__tick' }));
      }
      kids.push(svgText(cx, cy + 34, label, { class: `tut__label tut__label--${cls}`, 'text-anchor': 'middle' }));
    });
    return svg('svg', {
      class: 'tut__strip', viewBox: `0 0 ${W} 64`, role: 'img',
      'aria-label': `第 ${active + 1} 階段：${stages[active]}（共 ${n} 階段）`
    }, kids);
  }

  // ── 截圖 ＋ 標記 ────────────────────────────────────────
  function overlay(marks) {
    const kids = marks.map((m, idx) => {
      const g = svg('g', { class: 'tut__mark' });
      g.append(
        svg('rect', { x: m.x - 7, y: m.y - 7, width: m.w + 14, height: m.h + 14, rx: 14, class: 'tut__markHalo' }),
        svg('rect', { x: m.x - 4, y: m.y - 4, width: m.w + 8, height: m.h + 8, rx: 11, class: 'tut__markBox' })
      );
      // 編號放右上角外側；貼到邊就往內收，貼到頂就放到下面
      let bx = m.x + m.w + 4, by = m.y - 4;
      if (bx > SHOT_W - 16) bx = m.x + m.w - 12;
      if (by < 16) by = m.y + m.h + 4;
      g.append(
        svg('circle', { cx: bx, cy: by, r: 14, class: 'tut__badge' }),
        svgText(bx, by + 5, String(idx + 1), { class: 'tut__badgeNum', 'text-anchor': 'middle' })
      );
      return g;
    });
    return svg('svg', { class: 'tut__overlay', viewBox: `0 0 ${SHOT_W} ${SHOT_H}`, 'aria-hidden': 'true' }, kids);
  }

  function shot() {
    const s = step();
    return el('div', { class: 'tut__shot' }, [
      el('img', {
        class: 'tut__img', src: guideImageUrl(s.img), alt: s.title,
        width: String(SHOT_W), height: String(SHOT_H), decoding: 'async', draggable: 'false'
      }),
      overlay(s.marks || [])
    ]);
  }

  function body() {
    const s = step();
    return el('div', { class: 'tut__body' }, [
      s.who ? el('span', { class: 'tut__who', text: s.who }) : null,
      shot(),
      el('h3', { class: 'tut__stepTitle', text: s.title }),
      el('p', { class: 'tut__stepDesc', text: s.desc })
    ].filter(Boolean));
  }

  // ── 上一步／下一步 ──────────────────────────────────────
  function foot() {
    const last = state.i === total() - 1;
    return el('div', { class: 'tut__foot' }, [
      el('button', {
        class: 'btn btn--ghost tut__prev', type: 'button', disabled: state.i === 0, dataset: { act: 'prev' },
        onClick: () => go(state.i - 1, 'prev')
      }, iconText('back', '上一步')),
      el('span', { class: 'tut__count num', 'aria-live': 'polite', text: `${state.i + 1} / ${total()}` }),
      last
        ? (onStart
            ? el('button', { class: 'btn btn--primary tut__next', type: 'button', dataset: { act: 'start' }, onClick: () => { close(); onStart(); } },
                iconText('team', '我要建立球隊'))
            : el('button', { class: 'btn btn--primary tut__next', type: 'button', dataset: { act: 'done' }, onClick: () => close() }, '知道了'))
        : el('button', { class: 'btn btn--primary tut__next', type: 'button', dataset: { act: 'next' }, onClick: () => go(state.i + 1, 'next') },
            iconText('forward', '下一步', { trailing: true }))
    ]);
  }

  function render() {
    mount(panel, head(), tabs(), strip(), body(), foot());
    preloadNext();
    const target = state.focus === 'tab'
      ? panel.querySelector('.tut__tab.is-on')
      : state.focus === 'prev' && state.i > 0
        ? panel.querySelector('[data-act="prev"]')
        : panel.querySelector('.tut__next');
    target?.focus({ preventScroll: true });
    panel.querySelector('.tut__body')?.scrollTo?.({ top: 0 });
  }

  const preloaded = new Set();
  function preloadNext() {
    const next = cur().steps[state.i + 1];
    if (!next || preloaded.has(next.img)) return;
    preloaded.add(next.img);
    const im = new Image();
    im.src = guideImageUrl(next.img);
  }

  // ── 鍵盤與手勢 ─────────────────────────────────────────
  const onKey = e => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowRight') { go(state.i + 1, 'next'); }
    if (e.key === 'ArrowLeft') { go(state.i - 1, 'prev'); }
  };
  let touchX = null;
  const onTouchStart = e => { touchX = e.touches?.[0]?.clientX ?? null; };
  const onTouchEnd = e => {
    if (touchX == null) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? touchX) - touchX;
    touchX = null;
    if (Math.abs(dx) < 48) return;
    go(dx < 0 ? state.i + 1 : state.i - 1, dx < 0 ? 'next' : 'prev');
  };

  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    dlg.remove();
    markGuideSeen();
    onClose?.();
  }

  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  panel.addEventListener('touchstart', onTouchStart, { passive: true });
  panel.addEventListener('touchend', onTouchEnd, { passive: true });
  document.addEventListener('keydown', onKey);
  document.body.append(dlg);
  render();
  return close;
}
