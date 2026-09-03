/**
 * T33 安裝到裝置（PWA）
 * ------------------------------------------------------------------
 * 規格：docs/08 §1.3
 *
 * 這一組守的是三件**壞掉不會報錯**的事：
 *   1. manifest 指到的圖示檔真的存在（不存在的話 Chrome 不給安裝選項，
 *      而且 console 一個字都不會印——2026-09-03 就是這樣，img/ 整個是空的）
 *   2. index.html 的 inline script 有攔 beforeinstallprompt
 *      （那個事件在 app.js 載入前就派發，錯過就再也收不到）
 *   3. 三種環境的判定順序（已安裝 > 有原生對話框 > 內建瀏覽器 > iOS）
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(join(ROOT, p), 'utf8');

// ── 環境替身 ─────────────────────────────────────────────────
// Node 的 globalThis.navigator 是唯讀的 getter，直接指派會靜靜失敗，
// 必須用 defineProperty。第一版用 `globalThis.navigator = {...}`，
// 每一條案例都拿到 'Node.js/24'，卻還是綠的。
function fakeEnv({ ua = 'Mozilla/5.0', platform = 'Win32', touch = 0, standalone = false, deferred = null, installed = false } = {}) {
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: ua, platform, maxTouchPoints: touch, standalone: standalone || undefined },
    configurable: true, writable: true
  });
  globalThis.window = {
    __fedaInstall: { deferred, installed },
    navigator: globalThis.navigator,
    matchMedia: q => ({ matches: standalone && q.includes('standalone'), addEventListener() {} }),
    addEventListener() {}
  };
  return globalThis.window;
}

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36',
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1',
  lineIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Line/14.5.0',
  lineAndroid: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36 Line/14.5.0',
  desktopFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0'
};

let mod;
beforeAll(async () => {
  fakeEnv();
  mod = await import('../../js/core/install.js');
});

describe('T33-1 三種環境的判定', () => {
  test('Android Chrome 接到 beforeinstallprompt → 走原生對話框', () => {
    fakeEnv({ ua: UA.androidChrome, deferred: { prompt() {} } });
    expect(mod.installState()).toMatchObject({ installed: false, canInstall: true, mode: 'prompt' });
  });

  test('iOS Safari 永遠沒有那個事件 → 走教學', () => {
    fakeEnv({ ua: UA.iosSafari, platform: 'iPhone' });
    expect(mod.installState()).toMatchObject({ canInstall: true, mode: 'ios' });
  });

  test('iPadOS 13+ 偽裝成 Mac，要靠觸控點數認出來', () => {
    fakeEnv({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', touch: 5 });
    expect(mod.installState().mode).toBe('ios');
    // 真的 Mac 沒有觸控，不該被當成 iPad
    fakeEnv({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', platform: 'MacIntel', touch: 0 });
    expect(mod.installState().mode).toBe(null);
  });

  test('LINE 內建瀏覽器 → 教使用者改用外部瀏覽器', () => {
    for (const ua of [UA.lineIos, UA.lineAndroid]) {
      fakeEnv({ ua });
      expect(mod.installState().mode).toBe('inapp');
    }
  });

  test('⭐ 已經安裝就什麼都不畫，即使 deferred 還在', () => {
    // 裝完之後 Chrome 不一定會清掉 deferred。這裡如果讓 deferred 先贏，
    // 已安裝的使用者會在 App 裡看到一顆「安裝」，按下去什麼都不會發生。
    fakeEnv({ ua: UA.androidChrome, standalone: true, deferred: { prompt() {} } });
    expect(mod.installState()).toEqual({ installed: true, canInstall: false, mode: null });

    fakeEnv({ ua: UA.iosSafari, platform: 'iPhone', installed: true });
    expect(mod.installState().canInstall).toBe(false);
  });

  test('⭐ 桌面 Firefox 之類裝不了的環境不畫按鈕', () => {
    // 畫一顆按了沒反應的鈕比沒有按鈕更糟（同 #/login 在 SDK 載不到時的處理）
    fakeEnv({ ua: UA.desktopFirefox });
    expect(mod.installState()).toMatchObject({ canInstall: false, mode: null });
  });
});

describe('T33-2 原生對話框只能叫一次', () => {
  test('prompt() 用過就丟掉，第二次回 unavailable', async () => {
    let calls = 0;
    const ev = { prompt: async () => { calls++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) };
    fakeEnv({ ua: UA.androidChrome, deferred: ev });

    expect(await mod.promptInstall()).toBe('accepted');
    expect(calls).toBe(1);
    // 同一個事件再 prompt() 一次會丟 InvalidStateError，所以必須先丟掉
    expect(await mod.promptInstall()).toBe('unavailable');
    expect(calls).toBe(1);
  });

  test('使用者按取消不算已安裝', async () => {
    const ev = { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
    fakeEnv({ ua: UA.androidChrome, deferred: ev });
    expect(await mod.promptInstall()).toBe('dismissed');
    expect(globalThis.window.__fedaInstall.installed).toBe(false);
  });

  test('沒有 deferred 就直接回 unavailable，不會爆', async () => {
    fakeEnv({ ua: UA.iosSafari, platform: 'iPhone' });
    expect(await mod.promptInstall()).toBe('unavailable');
  });
});

describe('T33-3 manifest 與圖示檔', () => {
  const manifest = JSON.parse(read('manifest.json'));

  test('⭐ 每一個圖示檔都真的存在', () => {
    // 2026-09-03：manifest 指到三個檔，img/ 是空的。Chrome 不給安裝選項、
    // 也不印任何錯誤，整整一天沒有人發現 PWA 其實裝不了。
    for (const ic of manifest.icons) {
      const p = join(ROOT, ic.src.replace(/^\//, ''));
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  test('⭐ 圖示的實際尺寸與 manifest 宣告的一致', () => {
    for (const ic of manifest.icons) {
      const buf = fs.readFileSync(join(ROOT, ic.src.replace(/^\//, '')));
      // PNG：8 bytes 簽章 + 4 長度 + 4 'IHDR'，寬高各 4 bytes big-endian
      expect(buf.subarray(12, 16).toString('latin1')).toBe('IHDR');
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      expect(w + 'x' + h).toBe(ic.sizes);
    }
  });

  test('可安裝的最低要求：有 name、start_url、display、≥192px 的圖示', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
    expect(manifest.icons.some(i => parseInt(i.sizes, 10) >= 192)).toBe(true);
  });

  test('⭐ 要有 maskable 圖示，否則 Android 會加一圈白底', () => {
    expect(manifest.icons.some(i => (i.purpose || '').includes('maskable'))).toBe(true);
  });

  test('iOS 不看 manifest，要有 apple-touch-icon', () => {
    const html = read('index.html');
    const m = html.match(/rel="apple-touch-icon"\s+href="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(fs.existsSync(join(ROOT, m[1].replace(/^\//, '')))).toBe(true);
  });
});

describe('T33-4 首屏 inline script 必須攔到事件', () => {
  const html = read('index.html');
  const headEnd = html.indexOf('</head>');
  const beforeModule = html.slice(0, html.indexOf('<script type="module"'));

  test('⭐ beforeinstallprompt 在 app.js 之前就被攔下來', () => {
    // 這個事件在首次繪製前後派發，type=module 等同 defer，那時候 app.js
    // 連載都還沒載。攔截若搬進模組，安裝鈕在多數情況下永遠不會出現。
    //
    // ⚠️ 這裡**不能**用 toContain('beforeinstallprompt')：
    //    'x_beforeinstallprompt' 也含有那個子字串，變異 #P28 就是這樣逃掉的。
    //    事件名必須是完整的一個字串常值。
    const listens = /addEventListener\(\s*'beforeinstallprompt'/;
    expect(beforeModule).toMatch(listens);
    expect(html.search(listens)).toBeGreaterThan(-1);
    expect(html.search(listens)).toBeLessThan(headEnd);
  });

  test('⭐ inline script 與 install.js 用同一個 window 屬性名', () => {
    const src = read('js/core/install.js');
    expect(html).toContain('window.__fedaInstall');
    expect(src).toContain('__fedaInstall');
  });

  test('inline script 存的形狀是 { deferred, installed }', () => {
    expect(html).toMatch(/__fedaInstall\s*=\s*\{\s*deferred:\s*null,\s*installed:\s*false\s*\}/);
  });

  test('preventDefault() 一定要呼叫，不然 Chrome 會自己跳迷你資訊列', () => {
    const inline = html.slice(html.indexOf('beforeinstallprompt'), html.indexOf('appinstalled'));
    expect(inline).toContain('preventDefault');
  });
});
