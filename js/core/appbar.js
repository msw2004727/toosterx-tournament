/**
 * 全站頁首
 * ------------------------------------------------------------------
 * 規格：docs/08 §1.2
 *
 * 為什麼需要它：報名的家長建完隊、關掉瀏覽器，再回來就找不到自己的球隊了
 * （2026-09-03 實地回報）。資料沒有丟——`#/my` 一直都查得到——
 * 但畫面上**沒有任何一條路**通往那裡。
 *
 * 主辦 2026-09-03 指定的版型，**不管什麼身分、在哪一頁都一樣**：
 *
 *   [首頁]                    [安裝] [登入／我的] [☾ ☀ ▣]
 *
 * ・「首頁」永遠是**公開首頁**（賽程、比分、積分榜）。
 *   總管也看得到家長看到的畫面——現場有人回報問題時核對得起來。
 * ・「我的」是**專屬首頁**（`#/my`）：身分、功能區、我的球隊、登出。
 *   還沒登入時這一格顯示「登入」。
 * ・主題只留圖示：文字標籤在窄螢幕會斷行，把頁首撐成兩列。
 *
 * ⚠️ 這一列在賽務端**也要顯示**（改動前是收起來的）。所以賽務首頁自己
 *    那顆主題切換必須拿掉，否則畫面上會有兩個。
 *
 * R-UI-001：換節點一律 mount()。
 * R-UI-004：不得用 emoji，一律 icon()。
 */

import { themeSwitch } from './theme.js';
import { icon } from './icons.js';
import { el, mount } from './ui.js';
import { installState, promptInstall, showInstallHelp, onInstallableChange } from './install.js';

// ⚠️ 這個模組**刻意不 import firebase.js**。
//    那條 import 會把 firebase-config.js 一起拉進來，而它在模組層就讀
//    `location.hostname`——單元測試在 Node 裡連 location 都沒有，
//    整個 suite 會直接 failed to run（而且只會印一行「1 failed」）。
//    登入狀態由 app.js 注入，這一層只管畫。

/** 目前這個 hash 算不算「在首頁」——首頁的按鈕要標成 current */
export const atHome = (hash = location.hash) => hash === '' || hash === '#' || hash === '#/';

/** 目前這個 hash 算不算「在我的」 */
export const atMy = (hash = location.hash) => hash === '#/my' || hash.startsWith('#/my?');

/**
 * 常駐的兩個去處。
 *
 * ⚠️ **右邊那一格不可以拿掉。** 這一列存在的理由就是它：報名的家長
 *    建完隊、關掉瀏覽器再回來，畫面上沒有任何一條路通往 #/my，
 *    資料明明還在卻以為球隊不見了（2026-09-03 實地回報）。
 *    tests/unit/appbar.test.js 有一條案例守著這件事。
 *
 * 第二格的文字與去處依登入狀態而變（未登入 → 登入頁）。
 */
export const NAV_LINKS = [
  { key: 'home', href: '#/', iconName: 'home', label: '首頁', isCurrent: atHome },
  { key: 'me',   href: '#/my', iconName: 'person', label: '我的', isCurrent: atMy }
];

/** 還沒登入時右邊那一格的樣子 */
export const GUEST_ME = { href: '#/login', iconName: 'person', label: '登入' };

/** 依登入狀態解析出右邊那一格 */
export function meLink(signedIn) {
  const base = NAV_LINKS.find(l => l.key === 'me');
  return signedIn ? base : { ...base, ...GUEST_ME };
}

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
 * 三種平台三種行為，而且**只有一種**有 API：
 *   ・Android／桌面 Chrome：接到 beforeinstallprompt 才顯示，按下去叫原生對話框
 *   ・iOS Safari：**沒有這個事件**，永遠不會有，只能教使用者手動加入
 *   ・LINE／FB 內建瀏覽器：沒有，而且**根本裝不了**，教改用外部瀏覽器
 *
 * 沒接到事件時改給「從瀏覽器選單安裝」的步驟——按鈕每一台都在（頁首要長一樣），
 * 但按下去一定有反應。只有真的已經安裝（standalone）才收起來。
 */
function installButton() {
  const btn = el('button', {
    class: 'apphead__install',
    type: 'button',
    'data-install': '1',
    onClick: async () => {
      const st = installState();
      // 只有 'prompt' 有原生對話框。其餘兩種呼叫 promptInstall() 會回
      // 'unavailable' 然後**什麼都不做**——那就是一顆按了沒反應的按鈕。
      if (st.mode !== 'prompt') { showInstallHelp(st.mode); return; }
      await promptInstall();
      sync();
    }
  }, [icon('install'), el('span', { class: 'apphead__linkText', text: '安裝' })]);

  function sync() {
    const st = installState();
    btn.hidden = !st.canInstall;
    btn.title = st.mode === 'ios' ? '加到 iPhone 主畫面' : st.mode === 'inapp' ? '請改用瀏覽器開啟後安裝' : '安裝到裝置';
  }
  sync();

  btn.destroy = onInstallableChange(sync);
  return btn;
}

/**
 * 掛上頁首。只會被 app.js 呼叫一次；之後靠 hashchange 與 auth 自己更新。
 * @returns {() => void} 卸載（測試用）
 */
/**
 * @param {object} [o]
 * @param {() => boolean} [o.isSignedIn]  目前有沒有登入
 * @param {(fn:Function) => Function} [o.onAuthChange] 訂閱登入狀態變化，回傳取消訂閱
 * @param {HTMLElement} [o.host]
 */
export function mountAppBar({
  isSignedIn = () => false,
  onAuthChange = () => () => {},
  host = document.getElementById('app-header')
} = {}) {
  if (!host) return () => {};

  // themeSwitch() / installButton() 都會註冊訂閱者。直接 replaceChildren()
  // 把它們拔掉的話，閉包要等到下一次事件才自清。
  let parts = null;
  const drop = () => {
    parts?.theme?.destroy?.();
    parts?.install?.destroy?.();
    parts = null;
    host.replaceChildren();
  };

  const paint = () => {
    const signedIn = !!isSignedIn();
    const defs = [NAV_LINKS[0], meLink(signedIn)];

    // 已經畫過就只更新那兩顆，不要重建——重建會讓主題切換閃一下
    if (parts && parts.signedIn === signedIn) {
      for (const [i, def] of defs.entries()) {
        const cur = def.isCurrent ? def.isCurrent() : false;
        parts.links[i].classList.toggle('is-current', cur);
        if (cur) parts.links[i].setAttribute('aria-current', 'page');
        else parts.links[i].removeAttribute('aria-current');
      }
      return;
    }
    // 登入狀態變了：只換右邊那一格，主題與安裝鈕留著
    if (parts) {
      const next = navLink({ ...defs[1], current: defs[1].isCurrent ? defs[1].isCurrent() : false });
      parts.links[1].replaceWith(next);
      parts.links[1] = next;
      parts.signedIn = signedIn;
      return;
    }

    const links = defs.map(d => navLink({ ...d, current: d.isCurrent ? d.isCurrent() : false }));
    const install = installButton();
    const theme = themeSwitch();

    const bar = el('nav', { class: 'apphead', 'aria-label': '全站導覽' });
    // 首頁靠左，其餘往右靠
    mount(bar, links[0], el('div', { class: 'apphead__spacer' }), install, links[1], theme);
    host.replaceChildren(bar);
    parts = { links, install, theme, signedIn };
  };

  paint();
  window.addEventListener('hashchange', paint);
  const offAuth = onAuthChange(() => paint());
  return () => {
    window.removeEventListener('hashchange', paint);
    offAuth?.();
    drop();
  };
}
