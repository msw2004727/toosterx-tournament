/**
 * 全站頁首
 * ------------------------------------------------------------------
 * 規格：docs/08 §1.2
 *
 * 為什麼需要它：報名的家長建完隊、關掉瀏覽器，再回來就找不到自己的球隊了
 * （2026-09-03 實地回報）。資料沒有丟——`#/my` 一直都查得到——
 * 但畫面上**沒有任何一條路**通往那裡：公開端每一頁都只有內容，
 * 使用者手上唯一的入口是自己記住的網址。
 *
 * 所以這一列是常駐的，而且永遠有兩個固定去處：
 *   ・左邊「飛達盃」＝ 回首頁
 *   ・右邊「我的」  ＝ 我帶的球隊、我的身分、我的 uid
 *
 * 賽務端（#/staff）有自己的頁首，這一列在那裡會收起來，
 * 否則畫面上會同時出現兩個主題切換。
 *
 * R-UI-001：換節點一律 mount()。
 * R-UI-004：不得用 emoji，一律 icon()。
 */

import { themeSwitch } from './theme.js';
import { icon } from './icons.js';
import { el, mount } from './ui.js';
import { installState, promptInstall, showInstallHelp, onInstallableChange } from './install.js';

/** 這一列在哪些路由收起來（賽務端自己有頁首） */
export const HIDDEN_PREFIXES = ['#/staff'];

export const isHidden = (hash = location.hash) => HIDDEN_PREFIXES.some(p => hash.startsWith(p));

/** 目前這個 hash 算不算「在首頁」——首頁的回首頁鈕要標成 current */
export const atHome = (hash = location.hash) => hash === '' || hash === '#' || hash === '#/';

/** 目前這個 hash 算不算「在我的」 */
export const atMy = (hash = location.hash) => hash === '#/my' || hash.startsWith('#/my?');

/**
 * 常駐的兩個去處。
 *
 * ⚠️ **「我的」不可以拿掉。** 這一列存在的理由就是它：報名的家長建完隊、
 *    關掉瀏覽器再回來，畫面上沒有任何一條路通往 #/my，資料明明還在
 *    卻以為球隊不見了（2026-09-03 實地回報）。
 *    tests/unit/appbar.test.js 有一條案例守著這件事。
 */
export const NAV_LINKS = [
  { href: '#/', iconName: 'home', label: '首頁', isCurrent: atHome },
  { href: '#/my', iconName: 'person', label: '我的', isCurrent: atMy }
];

function navLink({ href, iconName, label, current }) {
  const a = el('a', {
    class: `apphead__link${current ? ' is-current' : ''}`,
    href,
    'data-nav': label
  }, [icon(iconName), el('span', { class: 'apphead__linkText', text: label })]);
  if (current) a.setAttribute('aria-current', 'page');
  return a;
}

/**
 * 安裝鈕。
 *
 * 三種平台三種行為：
 *   ・Android／桌面 Chrome：接到 beforeinstallprompt 才顯示，按下去叫原生對話框
 *   ・iOS Safari：**沒有這個事件**，永遠不會有原生對話框，只能教使用者手動加入
 *   ・已經安裝（standalone）：整顆不畫
 *
 * 沒接到事件就不畫按鈕——畫一顆按了沒反應的鈕比沒有按鈕更糟
 * （跟 #/login 在 SDK 載不到時收掉登入鈕是同一個原則）。
 */
function installButton() {
  const btn = el('button', {
    class: 'apphead__install',
    type: 'button',
    'data-install': '1',
    onClick: async () => {
      const st = installState();
      // 只有 'prompt' 有原生對話框。其餘兩種（iOS、LINE 內建瀏覽器）
      // 呼叫 promptInstall() 會回 'unavailable' 然後**什麼都不做**——
      // 那就是一顆按了沒反應的按鈕。E2E 有一條專門守這件事。
      if (st.mode !== 'prompt') { showInstallHelp(st.mode); return; }
      await promptInstall();
      sync();
    }
  }, [icon('install'), el('span', { class: 'apphead__linkText', text: '安裝' })]);

  function sync() {
    const st = installState();
    btn.hidden = !st.canInstall;
    btn.title = st.mode === 'ios' ? '加到 iPhone 主畫面' : '安裝到裝置';
  }
  sync();

  const off = onInstallableChange(sync);
  btn.destroy = off;
  return btn;
}

/**
 * 掛上頁首。只會被 app.js 呼叫一次；之後靠 hashchange 自己更新。
 * @returns {() => void} 卸載（測試用）
 */
export function mountAppBar(host = document.getElementById('app-header')) {
  if (!host) return () => {};

  // themeSwitch() / installButton() 都會註冊訂閱者。直接 replaceChildren()
  // 把它們拔掉的話，閉包要等到下一次事件才自清，每進出一次 /staff 就多留一份。
  let parts = null;
  const drop = () => {
    parts?.theme?.destroy?.();
    parts?.install?.destroy?.();
    parts = null;
    host.replaceChildren();
  };

  const sync = () => {
    if (isHidden()) { if (parts) drop(); return; }

    // 已經畫過就只更新 current，不要重建——重建會讓主題切換閃一下
    if (parts) {
      for (const [i, def] of NAV_LINKS.entries()) {
        const cur = def.isCurrent();
        parts.links[i].classList.toggle('is-current', cur);
        if (cur) parts.links[i].setAttribute('aria-current', 'page');
        else parts.links[i].removeAttribute('aria-current');
      }
      return;
    }

    const links = NAV_LINKS.map(d => navLink({ ...d, current: d.isCurrent() }));
    const install = installButton();
    const theme = themeSwitch();

    const bar = el('nav', { class: 'apphead', 'aria-label': '全站導覽' });
    // 第一個連結靠左，其餘往右靠：首頁在左、我的與工具在右
    mount(bar, links[0], el('div', { class: 'apphead__spacer' }), install, ...links.slice(1), theme);
    host.replaceChildren(bar);
    parts = { links, install, theme };
  };

  sync();
  window.addEventListener('hashchange', sync);
  return () => { window.removeEventListener('hashchange', sync); drop(); };
}
