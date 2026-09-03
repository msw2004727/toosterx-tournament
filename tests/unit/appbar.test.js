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
import { NAV_LINKS, HIDDEN_PREFIXES, atHome, atMy, isHidden } from '../../js/core/appbar.js';

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

describe('T34-3 賽務端不畫這一列', () => {
  test('⭐ #/staff 底下收起來（否則會有兩個主題切換）', () => {
    expect(isHidden('#/staff')).toBe(true);
    expect(isHidden('#/staff/live/m-001')).toBe(true);
  });

  test('公開端與報名端都要畫', () => {
    for (const h of ['#/', '#/my', '#/register', '#/team/t-1/manage', '#/schedule']) {
      expect(isHidden(h)).toBe(false);
    }
  });

  test('收起來的清單只有賽務端', () => {
    expect(HIDDEN_PREFIXES).toEqual(['#/staff']);
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
