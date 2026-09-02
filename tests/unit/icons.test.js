/**
 * T30 圖示
 * ------------------------------------------------------------------
 * 規格：docs/08 §2.5
 *
 * 這組測試真正要守的不是「icons.js 會不會壞」，而是**emoji 不會偷偷長回來**。
 * 換掉 emoji 是一次性的工，但只要有人趕時間寫一句 `text: '⚽ 進球'`，
 * 深色主題與跨平台一致性就又破一個洞，而且不會有任何錯誤。
 * 所以下面那條掃描整個前端原始碼的案例才是重點。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES } from '../../js/core/icons.js';

// ⚠️ 不能用 new URL(...).pathname：Windows 上它是 '/D:/kere/...'，
//    交給 fs.readdirSync 會被解成 'D:\D:\kere\...' 而 ENOENT，
//    整個 suite 直接掛掉——而 jest 只會報 "1 failed"，案例數默默少六條。
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** 路徑一律正規化成 '/'，下面的 startsWith('js/') 在 Windows 才成立 */
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'coverage', 'test-results', 'shots'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 前端會被使用者看到的原始碼（測試、腳本、文件不算） */
const UI_FILES = walk(ROOT)
  .filter(p => {
    const r = rel(p);
    return r === 'app.js' || r === 'index.html' || r.startsWith('js/') || r.startsWith('pages/');
  });

describe('T30-1 sprite 本身', () => {
  test('圖示名稱都是 kebab-case，且沒有重複', () => {
    for (const n of ICON_NAMES) expect(n).toMatch(/^[a-z][a-z0-9-]*$/);
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  test('賽務端用得到的圖示都在', () => {
    for (const n of ['goal', 'card', 'sub', 'play', 'pause', 'stop', 'check', 'warn',
                     'close', 'back', 'forward', 'more', 'qr', 'list', 'live', 'undo',
                     'theme-light', 'theme-dark', 'theme-system']) {
      expect(ICON_NAMES).toContain(n);
    }
  });
});

describe('T30-2 程式裡引用的圖示名稱都存在', () => {
  test('⭐ icon(\'xxx\') / iconText(\'xxx\') 的名字打錯會是空白圖示，這裡要抓出來', () => {
    const bad = [];
    for (const f of UI_FILES) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\b(?:icon|iconText)\(\s*'([a-z][a-z0-9-]*)'/g)) {
        if (!ICON_NAMES.includes(m[1])) bad.push(`${rel(f)}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('⭐ EVENT_ICON 對映到的都是真的圖示名稱，不是 emoji', async () => {
    const { EVENT_ICON } = await import('../../js/modules/staff/live-actions.js');
    for (const [type, name] of Object.entries(EVENT_ICON)) {
      expect(typeof name).toBe('string');
      expect(ICON_NAMES).toContain(name);
      expect(type).toBeTruthy();
    }
  });
});

describe('T30-3 ⭐ 前端原始碼不得再出現 emoji', () => {
  /** 把註解換成等長空白，行號才不會跑掉（說明「以前用什麼 emoji」是有價值的） */
  function stripComments(src) {
    const blank = s => s.replace(/[^\n]/g, ' ');
    return src
      .replace(/\/\*[\s\S]*?\*\//g, blank)          // /* 區塊 */
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + blank(m.slice(p1.length)))
      .replace(/<!--[\s\S]*?-->/g, blank);          // HTML 註解
  }

  // 彩色圖形類 emoji：跨平台形狀不一、顏色寫死在字型裡、放大會糊。
  const PICTO = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2B50}\u{23F8}-\u{23FA}]/u;

  // 單色箭頭／方塊：本身沒有跨平台問題，寫在句子裡（例如「Authentication → Sign-in method」）
  // 完全可以。有問題的是拿它當按鈕圖示，那種用法一定是一個很短的字串字面值。
  const GLYPH = /[\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2B05}-\u{2B0D}]/u;

  // ○ 是文字，不是圖示：js/lib/format.js 用它做未滿 13 歲球員的遮蔽名（R-PRIV-001）
  const ALLOW = new Set(['○']);

  test('掃描 app.js / index.html / js/**：不得有彩色 emoji', () => {
    const hits = [];
    for (const f of UI_FILES) {
      const r = rel(f);
      stripComments(fs.readFileSync(f, 'utf8')).split('\n').forEach((line, i) => {
        for (const ch of line) if (PICTO.test(ch)) hits.push(`${r}:${i + 1} ${ch}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test('⭐ 也不得把 ← → ● 這類符號當成按鈕圖示（短字串字面值）', () => {
    const hits = [];
    for (const f of UI_FILES) {
      const r = rel(f);
      const src = stripComments(fs.readFileSync(f, 'utf8'));
      // 只看 4 個字以內的字串字面值——那長度不可能是一句話，只可能是圖示
      for (const m of src.matchAll(/'([^'\n]{0,4})'|"([^"\n]{0,4})"/g)) {
        const v = m[1] ?? m[2] ?? '';
        if ([...v].some(ch => GLYPH.test(ch) && !ALLOW.has(ch))) {
          hits.push(`${r}: ${JSON.stringify(v)}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
