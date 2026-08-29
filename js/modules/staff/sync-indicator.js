/**
 * 連線／佇列狀態燈
 * ------------------------------------------------------------------
 * 規格：docs/04-功能規格-賽務裁判端.md §3（常駐右上）、§5.7
 *
 * 三態一律「顏色 ＋ 文字」，不單靠顏色（docs/08 交付檢查表第 4、5 項，
 * 以及色盲可及性）。點下去會展開待送與失敗清單，可以逐筆重試或複製內容。
 */

import { subscribe, list, retry, retryAll, dismiss, exportFailed, summary } from '../../core/sync.js';
import { el, toast, mount } from '../../core/ui.js';

const TEXT = {
  saved:  { dot: '●', label: '已連線' },
  queued: { dot: '●', label: '待同步' },
  failed: { dot: '●', label: '送出失敗' }
};

/**
 * @param {string} scope 目前路由 scope（不用於監聽，但保留給除錯）
 * @returns {{node:HTMLElement, destroy:Function}}
 */
export function syncIndicator() {
  const dot = el('span', { class: 'sync__dot', 'aria-hidden': 'true' });
  const label = el('span', { class: 'sync__label' });
  const count = el('span', { class: 'sync__count num', hidden: true });

  const btn = el('button', {
    class: 'sync', type: 'button', 'aria-live': 'polite',
    onClick: () => togglePanel()
  }, [dot, label, count]);

  const panel = el('div', { class: 'sync-panel', hidden: true });
  const node = el('div', { class: 'sync-wrap' }, [btn, panel]);

  const off = subscribe(s => {
    const t = TEXT[s.level];
    btn.dataset.level = s.level;
    dot.textContent = t.dot;
    label.textContent = s.online ? t.label : '離線';
    const n = s.failed || s.queued;
    count.hidden = n === 0;
    count.textContent = String(n);
    btn.setAttribute('aria-label',
      `${s.online ? '已連線' : '離線'}｜待同步 ${s.queued} 筆，失敗 ${s.failed} 筆`);

    if (s.warnQueue && !btn.dataset.warned) {
      btn.dataset.warned = '1';
      toast('待送筆數偏多，請盡快移動到有訊號的地方。資料都在手機裡，不會遺失。', 'warn');
    }
    if (!s.warnQueue) delete btn.dataset.warned;

    if (!panel.hidden) renderPanel();
  });

  function togglePanel() {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderPanel();
  }

  function renderPanel() {
    const s = summary();
    const rows = list().filter(w => w.state !== 'saved');
    mount(panel,
      el('div', { class: 'sync-panel__head' }, [
        el('strong', { text: s.online ? '已連線' : '離線中' }),
        el('span', { class: 'sync-panel__sub', text: `待同步 ${s.queued}．失敗 ${s.failed}` })
      ]),
      rows.length === 0
        ? el('p', { class: 'sync-panel__empty', text: '所有資料都已同步。' })
        : el('ul', { class: 'sync-panel__list' }, rows.map(rowItem)),
      s.failed > 0 ? el('div', { class: 'sync-panel__actions' }, [
        el('button', { class: 'btn btn--sm btn--primary', type: 'button', onClick: () => retryAll() }, '全部重試'),
        el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: copyFailed }, '複製內容')
      ]) : null
    );
  }

  function rowItem(w) {
    return el('li', { class: `sync-item sync-item--${w.state}` }, [
      el('div', { class: 'sync-item__main' }, [
        el('span', { class: 'sync-item__label', text: w.label }),
        w.state === 'failed'
          ? el('span', { class: 'sync-item__err', text: w.error?.message || '送出失敗' })
          : el('span', { class: 'sync-item__note', text: '已記錄在這支手機，恢復連線會自動送出' })
      ]),
      w.state === 'failed'
        ? el('div', { class: 'sync-item__btns' }, [
            el('button', { class: 'btn btn--sm', type: 'button', onClick: () => retry(w.id) }, '重試'),
            el('button', { class: 'btn btn--sm btn--ghost', type: 'button', onClick: () => dismiss(w.id) }, '放棄')
          ])
        : null
    ].filter(Boolean));
  }

  async function copyFailed() {
    const text = exportFailed();
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製，可以貼給管理員。', 'success');
    } catch {
      // 沒有剪貼簿權限時退而求其次：印出來讓賽務自己選取
      console.info(text);
      toast('這支瀏覽器不允許自動複製，內容已印在開發者工具的主控台。', 'warn');
    }
  }

  return { node, destroy: () => off() };
}
