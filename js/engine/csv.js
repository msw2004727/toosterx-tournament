/**
 * CSV 匯出
 * ------------------------------------------------------------------
 * 規格：docs/06 §7.3（抽獎名單）、§11（活動指標）
 *
 * 純函式：資料列 → 一個字串。誰去下載它、檔名叫什麼由呼叫端決定。
 *
 * ## 三件在 CSV 上很容易錯、而且錯了不會有錯誤訊息的事
 *
 * 1. **公式注入。** 暱稱是玩家自己取的，而 `=1+1`、`+A1`、`-2`、`@SUM(…)`
 *    在 Excel／Google 試算表裡會被當成**公式執行**。主辦打開抽獎名單的
 *    那一刻就中了。所以危險開頭一律前置一個單引號（見 `sanitizeCell`）。
 *    這不是理論上的風險：這個系統的暱稱欄位任何人都填得進去，
 *    而且 `players` 的暱稱連未登入的人都改得動（docs/06 §5.1 的取捨）。
 *
 * 2. **BOM。** 沒有 UTF-8 BOM 的話，Excel 在中文 Windows 上會用 CP950
 *    解讀，「王小明」變成亂碼。主辦不會知道那是編碼問題，只會說「壞了」。
 *
 * 3. **換行與逗號。** 備註欄位裡的一個逗號就會把那一列切成兩欄，
 *    而後面每一欄都往左移一格——看起來像資料錯亂，不像格式問題。
 */

/** UTF-8 BOM。用 fromCharCode 而不是字面上那個看不見的字元——
 *  U+FEFF 肉眼看不出來，被編輯器或工具吃掉時沒有人會發現 */
const BOM = String.fromCharCode(0xFEFF);

/** 會被 Excel 當成公式開頭的字元（含 Tab／CR，那兩個可以夾帶在前面繞過檢查）*/
const FORMULA_LEAD = ['=', '+', '-', '@', '\t', '\r'];

/**
 * 一格的內容 → 安全的 CSV 欄位。
 *
 * ⚠️ **順序不能反**：要先擋公式（加單引號），再做引號逸出。
 *    反過來的話單引號會被算進「需不需要包起來」的判斷裡，
 *    而真正危險的那個 `=` 已經在最前面了。
 */
export function sanitizeCell(v) {
  if (v == null) return '';
  let s = String(v);

  // 公式注入：危險開頭前面加一個單引號。試算表會把它當成「純文字」
  // 而不顯示那個引號；用純文字編輯器打開時看得到，那是可以接受的代價。
  if (s.length && FORMULA_LEAD.includes(s[0])) s = `'${s}`;

  // 逗號、雙引號、換行都要把整格包起來；雙引號本身要變成兩個
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 資料列 → CSV 字串。
 *
 * @param {Array<{key:string,label:string}>} columns 欄位定義（順序就是欄序）
 * @param {Array<object>} rows
 * @param {object} [opts]
 * @param {boolean} [opts.bom=true] 前面加 UTF-8 BOM（Excel 要）
 * @returns {string}
 */
export function toCsv(columns, rows, { bom = true } = {}) {
  if (!Array.isArray(columns) || !columns.length) throw new Error('toCsv：需要欄位定義');

  const head = columns.map(c => sanitizeCell(c.label ?? c.key)).join(',');
  const body = (rows ?? []).map(r => columns.map(c => sanitizeCell(r?.[c.key])).join(','));

  // ⚠️ 行尾用 CRLF：RFC 4180 就是這樣定的，而且舊版 Excel 對純 LF
  //    會把整份檔案讀成一列。這裡刻意不跟 R-SRC-002 一致——
  //    那條規矩管的是**原始碼**，不是產出的資料檔。
  return (bom ? BOM : '') + [head, ...body].join('\r\n') + '\r\n';
}

// ══════════════════════════════════════════════════════════════
//  抽獎名單（docs/06 §7.3）
// ══════════════════════════════════════════════════════════════

export const LUCKY_DRAW_COLUMNS = [
  { key: 'playerId', label: '代號' },
  { key: 'nickname', label: '暱稱' },
  { key: 'entries', label: '抽獎張數' },
  { key: 'completedCount', label: '完成關卡數' },
  { key: 'contact', label: '聯絡方式' },
  { key: 'ageBand', label: '年齡層' },
  { key: 'createdVia', label: '建立方式' }
];

const AGE_LABEL = { kid: '兒童', teen: '青少年', adult: '成人' };

/**
 * 抽獎名單。
 *
 * ⚠️ **只收真的有資格的人**（張數 ≥ 1）。把 0 張的也列進去，主辦得自己
 *    在試算表裡篩一次——而漏篩就等於把沒有資格的人放進抽獎箱。
 *
 * ⚠️ **張數用 `player.luckyDrawEntries`（Function 寫的權威值）**，
 *    不在這裡重算。重算要讀 `config/challengeRewards` 與關卡總數，
 *    跟管線分岔的話「名單上的張數」與「玩家手機上看到的張數」會不一樣，
 *    而那是在抽獎現場才會吵起來的事。
 *
 * 排序：張數多的在前，同張數依代號——**穩定且可重放**，
 * 主辦重匯一次要拿到同一份名單（不然沒辦法比對）。
 */
export function luckyDrawRows(players = []) {
  return players
    .map(p => ({
      playerId: p.playerId ?? '',
      nickname: p.nickname ?? '',
      entries: Number.isInteger(p.luckyDrawEntries) ? p.luckyDrawEntries : 0,
      completedCount: Array.isArray(p.completedChallengeIds) ? p.completedChallengeIds.length : 0,
      // contact 目前一律是空的（表單還沒做，而規則也不放行訪客寫）。
      // 欄位留著是為了讓主辦匯出來的檔案格式從頭到尾一致。
      contact: contactText(p.contact),
      ageBand: AGE_LABEL[p.ageBand] ?? '',
      createdVia: p.createdVia === 'staff' ? '現場代建' : '玩家自建'
    }))
    .filter(r => r.entries > 0)
    .sort((a, b) => (b.entries - a.entries) || String(a.playerId).localeCompare(String(b.playerId)));
}

/** `{phone, lineUserId}` → 一格字串。兩個都沒有就留空 */
function contactText(c) {
  const parts = [c?.phone, c?.lineUserId].filter(v => typeof v === 'string' && v.trim());
  return parts.join(' / ');
}

/**
 * 抽獎名單的摘要——匯出之前先讓主辦看到「這份檔案裡有什麼」。
 *
 * 直接下載一個看不到內容的檔案，錯了要到抽獎現場才發現。
 */
export function luckyDrawSummary(rows = [], challengeTotal = 0) {
  const players = rows.length;
  const entries = rows.reduce((n, r) => n + r.entries, 0);
  // ⚠️ 關卡總數由呼叫端給，**不可以寫死成 5**。這個系統一個 challengeId
  //    都沒有寫死（驗收 C08：新增第六關只要在後台加一筆設定），
  //    在這裡寫死等於「加了第六關之後全破人數永遠是錯的」。
  const allDone = challengeTotal > 0
    ? rows.filter(r => r.completedCount >= challengeTotal).length
    : null;
  return { players, entries, allDone };
}

/** 檔名。日期由呼叫端給——引擎不碰時間（R-ENG-004） */
export function csvFilename(prefix, isoDate) {
  const d = typeof isoDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(isoDate)
    ? isoDate.slice(0, 10) : 'unknown';
  return `${prefix}-${d}.csv`;
}
