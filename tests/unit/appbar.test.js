/**
 * T34 全站頁首
 * ------------------------------------------------------------------
 * 規格：docs/08 §1.2
 *
 * 這一列是 2026-09-03 補的，起因是一個看起來像資料遺失、其實是導覽缺口的
 * 回報：「建立球隊成功後退出瀏覽器再回來就無法找到自己的球隊」。
 * 球隊一直都在 `#/my`，但公開端每一頁都只有內容，沒有任何一條路通往那裡。
 *
 * 所以這一組測試守的是**兩個去處不可以消失**，以及賽務端不可以出現兩個頁首。
 * 畫面本身由 tests/e2e/appbar.spec.js 驗（那裡有真的 DOM）。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NAV_LINKS, GUEST_ME, meLink, atHome, atMy } from '../../js/core/appbar.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(join(ROOT, p), 'utf8');

describe('T34-1 常駐的兩個去處', () => {
  test('⭐ 一定要有一條路回「我的」', () => {
    // 這一列存在的唯一理由。拿掉它，報名的家長就再也找不到自己的球隊——
    // 而且看起來像資料不見了，不像少了一個連結。
    const my = NAV_LINKS.find(l => l.href === '#/my');
    expect(my).toBeDefined();
    expect(my.label).toBe('我的');
  });

  test('⭐ 一定要有一條路回首頁', () => {
    const home = NAV_LINKS.find(l => l.href === '#/');
    expect(home).toBeDefined();
    expect(home.label).toBe('首頁');
  });

  test('首頁排在最前面（版面上靠左，其餘靠右）', () => {
    expect(NAV_LINKS[0].href).toBe('#/');
  });

  test('每一個連結都有圖示，而且不是 emoji（R-UI-004）', () => {
    for (const l of NAV_LINKS) {
      expect(typeof l.iconName).toBe('string');
      expect(l.iconName).toMatch(/^[a-z-]+$/);
      expect(l.label).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  test('連結指到的圖示在 icons.js 裡真的存在', () => {
    const src = read('js/core/icons.js');
    for (const l of NAV_LINKS) {
      expect(src).toMatch(new RegExp(`^\\s+'?${l.iconName}'?:`, 'm'));
    }
  });
});

describe('T34-2 目前位置的判定', () => {
  test('首頁的幾種寫法都算首頁', () => {
    for (const h of ['', '#', '#/']) expect(atHome(h)).toBe(true);
    for (const h of ['#/my', '#/schedule', '#/team/t-1']) expect(atHome(h)).toBe(false);
  });

  test('「我的」帶 query 也算', () => {
    expect(atMy('#/my')).toBe(true);
    expect(atMy('#/my?from=login')).toBe(true);
  });

  test('⭐ 不可以用 startsWith 判「我的」', () => {
    // #/mystats、#/my-team 這種路由現在沒有，但加了之後
    // 頂部會有兩個地方同時反白，而且不會有人發現。
    expect(atMy('#/mystats')).toBe(false);
    expect(atMy('#/my-team')).toBe(false);
  });
});

describe('T34-3 未登入顯示「登入」，登入後顯示「我的」', () => {
  test('⭐ 未登入時右邊那一格是登入，而且指向登入頁', () => {
    // 主辦 2026-09-03 指定。原本永遠顯示「我的」，未登入的人點下去
    // 只會看到「請先登入」——多繞一步，而且看不出來自己還沒登入。
    const me = meLink(false);
    expect(me.label).toBe('登入');
    expect(me.href).toBe('#/login');
  });

  test('⭐ 登入後那一格變成「我的」，指向專屬首頁', () => {
    const me = meLink(true);
    expect(me.label).toBe('我的');
    expect(me.href).toBe('#/my');
  });

  test('兩種狀態都用同一個圖示（位置不變，只有文字與去處變）', () => {
    expect(meLink(true).iconName).toBe(meLink(false).iconName);
    expect(GUEST_ME.iconName).toBe('person');
  });
});

describe('T34-3b 這一列在每一頁都要顯示', () => {
  test('⭐ 賽務端也要有（主辦 2026-09-03：不管什麼層級頂部都一樣）', () => {
    // 改動前 #/staff 底下整列是收起來的。既然要常駐，賽務首頁自己
    // 那顆主題切換就必須拿掉，否則畫面上會有兩個。
    const src = read('js/modules/staff/home.js');
    expect(src).not.toContain('themeSwitch');
  });

  test('appbar 沒有「哪些路由不畫」的清單', () => {
    const src = read('js/core/appbar.js');
    expect(src).not.toMatch(/HIDDEN_PREFIXES/);
  });
});

describe('T34-4 樣式與版面', () => {
  const css = read('css/components.css');

  test('⭐ 窄機（320px）把文字收起來只留圖示', () => {
    // 首頁＋安裝＋我的＋三態主題切換，帶中文標籤在 320px 上排不下，
    // 會把主題切換擠出畫面外。R-UI-006。
    const narrow = css.slice(css.indexOf('@media (max-width:359px)'));
    expect(narrow).toContain('.apphead__linkText');
  });

  test('⭐ 主題切換任何寬度都只有圖示，沒有文字', () => {
    // 主辦 2026-09-03：文字標籤在窄螢幕會斷行，把整條頁首撐成兩列。
    // 標籤仍留在 DOM（title／aria-label），只是視覺上藏起來——
    // 用 display:none 的話螢幕閱讀器也讀不到了。
    const block = css.slice(css.indexOf('.theme-switch__label{'), css.indexOf('.theme-switch__label{') + 200);
    expect(block).toContain('clip-path');
    expect(block).not.toContain('display:none');
    // 不可以只在窄螢幕才藏
    expect(css).not.toMatch(/@media[^{]*\{\s*\.theme-switch__label\{display:none\}/);
  });

  test('文字是用 clip-path 藏起來而不是 display:none（螢幕閱讀器還要讀得到）', () => {
    const block = css.slice(css.indexOf('.apphead{'), css.indexOf('/* 安裝教學'));
    const narrow = block.slice(block.indexOf('@media (max-width:359px)'));
    expect(narrow).toContain('clip-path');
    expect(narrow).not.toMatch(/\.apphead__linkText\{[^}]*display:none/);
  });

  test('R-UI-005：這一段不得出現 prefers-color-scheme', () => {
    const block = css.slice(css.indexOf('.apphead{'));
    expect(block).not.toContain('prefers-color-scheme');
  });
});
