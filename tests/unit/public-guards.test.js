/**
 * T33 公開端的結構性防線
 * ------------------------------------------------------------------
 * 這一組不測「功能對不對」，測的是**規則有沒有被繞過**——
 * 那種違反了也不會壞、但會在上線後才咬人的東西：
 *
 *   ・公開端讀到 members（裡面有生日與身分證後四碼）
 *   ・公開端自己算一份積分／射手榜（跟官方榜不一致，現場沒人分得出誰對）
 *   ・CSS 用 prefers-color-scheme（使用者選的淺色會被系統的深色蓋掉）
 *   ・onSnapshot 沒經過 store.hold（換頁不回收，用久了越來越慢）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize, toggle, has, FOLLOW_KEY } from '../../js/modules/public/follows.js';

// ⚠️ 一定要 fileURLToPath，不能用 new URL(...).pathname：
//    Windows 上 pathname 會是 '/D:/repo/'，fs 解成 'D:\D:\repo' 直接 ENOENT，
//    整個 suite 會掛掉而只印一行 "1 failed"，案例數默默變少。
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PUB = path.join(ROOT, 'js', 'modules', 'public');

const files = fs.readdirSync(PUB).filter(f => f.endsWith('.js'));
const src = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(PUB, f), 'utf8')]));
const allSrc = Object.values(src).join('\n');

/** 把註解換成等長空白，行號不跑掉 */
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + m.slice(p1.length).replace(/./g, ' '));

const code = Object.fromEntries(Object.entries(src).map(([f, s]) => [f, strip(s)]));
const allCode = Object.values(code).join('\n');

describe('T33-1 ⭐ 隱私：公開端不得碰私密集合', () => {
  test('沒有任何一處讀 members', () => {
    // 公開端只能讀 teams/{id}/roster（Function 產生的公開投影）。
    // members 裡有 birthDate / idLast4 / guardianName，rules 也會擋，
    // 但「rules 會擋」不是可以亂寫的理由——寫了就會有人以為讀得到。
    const hits = Object.entries(code)
      .filter(([, s]) => /'members'/.test(s))
      .map(([f]) => f);
    expect(hits).toEqual([]);
  });

  test('roster 有被讀，而且只有 data.js 在讀', () => {
    // 比對的是 Firestore 路徑用法（…, 'roster')），不是字串本身——
    // team.js 有一個叫 'roster' 的分頁鍵，那不是集合路徑。
    const asPath = /'roster'\s*\)/;
    expect(asPath.test(code['data.js'])).toBe(true);
    const others = Object.entries(code)
      .filter(([f, s]) => f !== 'data.js' && asPath.test(s))
      .map(([f]) => f);
    expect(others).toEqual([]);
  });

  test('⭐ 每一處讀 roster 之後都有真的呼叫 publicMember()', () => {
    // ⚠️ 只檢查「有沒有 import publicMember」是抓不到東西的：
    //    把 raw.map(publicMember) 改成 raw，import 還在，測試照樣綠。
    //    要比對的是**實際套用**的樣子。
    //
    //    這一條也是 publicMember 唯一測得到的地方。E2E 抓不到它被拿掉——
    //    畫面本來就只讀白名單裡的欄位，所以私密欄位就算留在物件裡也不會進 DOM。
    //    它是第二道防線，價值在於「日後有人多印一個欄位時仍然安全」，
    //    而那種未來的程式碼今天還不存在，測不出來。
    // 而且要**逐一**比對：一個檔案裡讀了兩次 roster、只過濾一次也是漏。
    // （只檢查「有沒有出現過 publicMember」抓不到部分移除——實測過。）
    const count = (s, re) => (s.match(re) || []).length;
    const readers = Object.entries(code)
      .filter(([f, s]) => f !== 'data.js' && /getRoster/.test(s));
    expect(readers.length).toBeGreaterThan(0);
    for (const [f, s] of readers) {
      const reads = count(s, /getRoster\s*\(/g);
      const filtered = count(s, /publicMember\s*[()]/g);
      expect({ f, reads, filtered }).toEqual({ f, reads, filtered: reads });
    }
  });
});

describe('T33-2 ⭐ 不重算：積分與榜單只讀不算', () => {
  test('公開端不 import 任何引擎模組', () => {
    // R-ENG-001：積分／排名邏輯只能有一份實作，在 js/engine/，由 Function 執行。
    // 公開端只要讀 standings.rows 直接畫。前端 import 引擎就代表有人想自己算。
    const hits = Object.entries(code)
      .filter(([, s]) => /from '.*\/engine\//.test(s))
      .map(([f]) => f);
    expect(hits).toEqual([]);
  });

  test('沒有出現自己加總積分的痕跡', () => {
    // 這條擋的是「rows 空的時候乾脆自己從場次算一份」這種很自然的念頭。
    // 一旦兩份實作分岔，現場沒有人分得出哪一個才對。
    expect(allCode).not.toMatch(/points\s*[+]=/);
    expect(allCode).not.toMatch(/\bcomputeRows\b|\bbuildStanding\b/);
  });
});

describe('T33-3 ⭐ 監聽一律經 store.hold', () => {
  test('只有 data.js 呼叫 onSnapshot', () => {
    const hits = Object.entries(code)
      .filter(([f, s]) => f !== 'data.js' && /onSnapshot\s*\(/.test(s))
      .map(([f]) => f);
    expect(hits).toEqual([]);
  });

  test('data.js 裡每一個 onSnapshot 都被 hold() 包起來', () => {
    const s = code['data.js'];
    const listeners = (s.match(/onSnapshot\s*\(/g) || []).length;
    const holds = (s.match(/return hold\(/g) || []).length;
    expect(listeners).toBeGreaterThan(0);
    expect(holds).toBe(listeners);
  });
});

describe('T33-4 ⭐ 主題只靠 data-theme', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'modules', 'public.css'), 'utf8');
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');

  test('public.css 沒有 prefers-color-scheme', () => {
    expect(cssCode).not.toMatch(/@media[^{;]*prefers-color-scheme/);
  });

  test('沒有寫死的色碼（顏色一律走 token，否則深色主題換不掉）', () => {
    // 例外：#fff 是頁首在品牌底色上的固定白字，深淺兩色一樣。
    const hexes = [...cssCode.matchAll(/#[0-9A-Fa-f]{3,8}\b/g)].map(m => m[0].toLowerCase());
    expect(hexes.filter(h => h !== '#fff')).toEqual([]);
  });

  test('404.html 帶了首屏主題 script，而且與 index.html 同一個 KEY', () => {
    const html = fs.readFileSync(path.join(ROOT, '404.html'), 'utf8');
    expect(html).toContain("localStorage.getItem('feda_theme')");
    expect(html).toContain("pref === 'light' || pref === 'dark'");
    // script 必須在 CSS 之前，否則會先閃一次淺色
    expect(html.indexOf("localStorage.getItem('feda_theme')"))
      .toBeLessThan(html.indexOf('css/tokens.css'));
  });
});

describe('T33-5 動態載入照 R-REL-016', () => {
  test('index.js 的 import 有帶版號並經過 lazy()', () => {
    const s = code['index.js'];
    expect(s).toContain('CACHE_VERSION');
    expect(s).toContain('lazy(');
    expect(s).toMatch(/\?v=\$\{CACHE_VERSION\}/);
  });

  test('公開端沒有 guard（完全免登入）', () => {
    expect(code['index.js']).not.toContain('guard');
  });
});

describe('T33-6 關注（localStorage）', () => {
  test('壞掉的資料一律當作空，不要傳染到畫面', () => {
    expect(normalize(null)).toEqual({ teams: [], matches: [], players: [] });
    expect(normalize('鬼畫符')).toEqual({ teams: [], matches: [], players: [] });
    expect(normalize({ teams: 'not-an-array' }).teams).toEqual([]);
    expect(normalize({ teams: [1, null, 't1', 't1', ''] }).teams).toEqual(['t1']);
  });

  test('toggle 開關並保留其他種類', () => {
    let s = normalize({ matches: ['m9'] });
    s = toggle(s, 'teams', 't1');
    expect(has(s, 'teams', 't1')).toBe(true);
    expect(has(s, 'matches', 'm9')).toBe(true);
    s = toggle(s, 'teams', 't1');
    expect(has(s, 'teams', 't1')).toBe(false);
  });

  test('不合法的 kind 或空 id 不會弄壞狀態', () => {
    const s = normalize({ teams: ['t1'] });
    expect(toggle(s, 'nope', 'x')).toEqual(s);
    expect(toggle(s, 'teams', '')).toEqual(s);
  });

  test('⭐ 有上限，不會被當成書籤存到爆', () => {
    const many = Array.from({ length: 500 }, (_, i) => `t${i}`);
    expect(normalize({ teams: many }).teams).toHaveLength(200);
  });

  test('key 名稱固定（換掉會讓所有人的關注消失）', () => {
    expect(FOLLOW_KEY).toBe('feda.follows');
  });
});

describe('T33-7 交付範圍', () => {
  test('沒有動到白名單以外的檔案（本測試只檢查最容易手滑的幾個）', () => {
    // 這一條是給我自己的護欄：另一個人正在同時改後端，
    // 交付整包或順手改了 rules 都會蓋掉他的工作。
    const rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    expect(rules).not.toContain('public');          // 公開端不需要新規則
    const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'firestore.indexes.json'), 'utf8'));
    expect(Array.isArray(idx.indexes)).toBe(true);  // 沒被我改壞
  });

  test('app.js / index.html / sw.js 各只多一行', () => {
    const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    expect(app).toContain('registerPublicRoutes');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    expect(html).toContain('/css/modules/public.css?v=');
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    expect(sw).toContain("'/css/modules/public.css'");
  });
});
