/**
 * T29 主題三態
 * ------------------------------------------------------------------
 * 規格：docs/10 §7
 *
 * 重點不在「切換會不會動」，而在兩件容易悄悄壞掉的事：
 *   1. 首屏 inline script 與 theme.js 用同一組 KEY 與同一套解析規則
 *      （不一致 → 開頁閃一下白色，而且沒有任何錯誤訊息）
 *   2. tokens.css 的淺色寫在裸 :root
 *      （只寫在 [data-theme="light"] 的話，JS 掛掉就整頁沒有顏色）
 */

import fs from 'node:fs';
import { resolveTheme, normalizePref, THEME_KEY, THEME_PREFS } from '../../js/core/theme.js';

describe('T29-1 偏好解析', () => {
  test('明確選了淺色／深色就不看系統', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  test('system 才跟著系統走', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  test('沒設定過等同 system，而且預設是淺色', () => {
    expect(normalizePref(null)).toBe('system');
    expect(normalizePref('')).toBe('system');
    expect(normalizePref('鬼畫符')).toBe('system');
    expect(resolveTheme(normalizePref(null), false)).toBe('light');
  });

  test('⭐ 不可以把「跟隨系統」變成「淺色」存起來', () => {
    // 兩者不同：前者之後會跟著系統變，後者永遠釘在淺色。
    // 曾經想過用 'light' 當預設值省一個狀態，那會讓使用者再也回不去跟隨系統。
    expect(THEME_PREFS).toEqual(['system', 'light', 'dark']);
    expect(normalizePref('system')).toBe('system');
  });
});

describe('T29-2 首屏 inline script 與模組必須一致', () => {
  const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  test('⭐ index.html 用的 storage key 與 theme.js 相同', () => {
    expect(THEME_KEY).toBe('feda_theme');
    expect(html).toContain(`localStorage.getItem('${THEME_KEY}')`);
  });

  test('⭐ inline script 在 CSS 之前（在後面就會先閃一次淺色）', () => {
    const scriptAt = html.indexOf("localStorage.getItem('feda_theme')");
    const cssAt = html.indexOf('css/tokens.css');
    expect(scriptAt).toBeGreaterThan(-1);
    expect(cssAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(cssAt);
  });

  test('inline script 的解析規則與 resolveTheme 一致（只認 light/dark，其餘看系統）', () => {
    expect(html).toContain("pref === 'light' || pref === 'dark'");
    expect(html).toContain('prefers-color-scheme: dark');
  });
});

describe('T29-3 tokens.css 的結構', () => {
  const css = fs.readFileSync(new URL('../../css/tokens.css', import.meta.url), 'utf8');

  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('⭐ 淺色寫在裸 :root，JS 沒跑也有完整顏色', () => {
    // 逐一檢查每個 :root 區塊：至少要有一個「不帶 [data-theme]」的區塊定義 --bg-root
    const blocks = [...stripped.matchAll(/(:root[^{]*)\{([^}]*)\}/g)];
    const bare = blocks.filter(([, sel, body]) =>
      !sel.includes('[data-theme') && /--bg-root\s*:/.test(body));
    expect(bare.length).toBeGreaterThan(0);
  });

  test('深色用 [data-theme="dark"]，不用 prefers-color-scheme', () => {
    expect(css).toContain(':root[data-theme="dark"]');
    // 系統偏好只由 JS 解析成 data-theme；CSS 若自己也判一次，
    // 使用者選「淺色」時會在深色系統下被 media query 蓋回去。
    expect(css).not.toMatch(/@media\s*\(prefers-color-scheme/);
  });

  test('⭐ 每一個顏色 token 在深淺兩邊都有定義', () => {
    const block = sel => {
      const i = css.indexOf(sel);
      return i < 0 ? '' : css.slice(i, css.indexOf('\n}', i));
    };
    const names = b => new Set([...b.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));

    const light = names(block(':root{\n  color-scheme:light;'));
    const dark = names(block(':root[data-theme="dark"]'));
    expect(light.size).toBeGreaterThan(20);

    const missing = [...light].filter(n => !dark.has(n));
    expect(missing).toEqual([]);   // 少一個就是深色下某處會沿用淺色值
  });

  test('⭐ 沒有寫壞的色碼（曾經打錯一個非 ASCII 數字，畫面照樣「看起來正常」）', () => {
    const hexes = [...css.matchAll(/#[0-9A-Za-z-￿]{3,8}/g)].map(m => m[0]);
    expect(hexes.length).toBeGreaterThan(30);
    for (const h of hexes) {
      expect(h).toMatch(/^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/);
    }
  });
});
