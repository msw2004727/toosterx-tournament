/**
 * QR 產生（前端顯示用）
 * ------------------------------------------------------------------
 * 規格：docs/08 §前端架構（`js/lib/qr-render.js`）、docs/06 §5.2
 *
 * 純函式：字串 → 布林矩陣。畫成什麼由呼叫端決定（`qrSvg()` 給一份 SVG）。
 *
 * ⚠️ **不裝套件、不從 CDN 載。** 挑戰區整天在戶外用手機網路，
 *    CDN 一慢，玩家的 QR 就畫不出來——而那是他整個下午唯一的身分。
 *    同樣的理由，`scripts/make-icons.mjs` 也只用 Node 內建的 zlib。
 *
 * ## 刻意只做一種組合
 *
 * **Byte 模式 ／ 版本 1–4 ／ 容錯等級 M。** 不是偷懶，是「沒有人用的分支
 * 最容易寫錯又最不會被發現」（挑戰引擎的 #CH2 就是這樣）。
 * 這一種組合裝得下 62 個位元組——`FEDA-0182` 只要 9 個，
 * 就算日後改成塞一整條網址也還有餘裕。真的不夠時再加版本 5 以上，
 * 那時候的表格要一次補齊並補測試。
 *
 * ⚠️ Byte 模式不宣告字元集，掃碼器一律當 UTF-8。中文塞得進去，
 *    但一個字要 3 個位元組，版本 4 只放得下 20 個字。
 *
 * 參考：ISO/IEC 18004。實作結構沿用公開領域的標準寫法（Nayuki 的教學版），
 * 但沒有相依任何程式碼。
 */

// ── 這個組合的四張表（版本 1–4、容錯等級 M）─────────────────

/** 每個版本的總碼字數（含資料與容錯） */
const RAW_CODEWORDS = { 1: 26, 2: 44, 3: 70, 4: 100 };
/** 每個區塊的容錯碼字數 */
const ECC_PER_BLOCK = { 1: 10, 2: 16, 3: 26, 4: 18 };
/** 區塊數。版本 4 開始切成兩塊——少了這件事，長字串的交錯會排錯 */
const NUM_BLOCKS = { 1: 1, 2: 1, 3: 1, 4: 2 };
/** 校準圖樣的中心座標。版本 1 沒有 */
const ALIGN_POS = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] };

/** 資料碼字數 = 總碼字 − 容錯碼字 */
const dataCodewords = v => RAW_CODEWORDS[v] - ECC_PER_BLOCK[v] * NUM_BLOCKS[v];

/** 這個版本裝得下幾個位元組（扣掉 4 bits 模式 + 8 bits 長度） */
const byteCapacity = v => dataCodewords(v) - 2;

const SIZE_OF = v => v * 4 + 17;

/** 容錯等級 M 的格式資訊代碼（L=01 M=00 Q=11 H=10） */
const EC_FORMAT_BITS = 0b00;

// ── GF(256) ────────────────────────────────────────────────
// 本原多項式 0x11D、生成元 α=2。指數表做成兩倍長度，
// 乘法就不必每次取模——這是熱路徑，一張 QR 會走幾百次。

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

/** GF(256) 乘法。0 乘任何數都是 0——不特判的話 LOG[0] 會讓結果錯得很安靜 */
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** 生成多項式：∏(x − α^i)，i = 0..degree−1 */
function generatorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    // 乘上 (x − α^i)
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                       // × x
      next[j + 1] ^= gfMul(poly[j], EXP[i]);    // × α^i
    }
    poly = next;
  }
  return poly;
}

/** Reed–Solomon 容錯碼字：把資料當多項式，除以生成多項式取餘數 */
export function reedSolomon(data, eccLen) {
  const gen = generatorPoly(eccLen);
  const rem = new Array(eccLen).fill(0);
  for (const b of data) {
    const factor = b ^ rem[0];
    rem.shift();
    rem.push(0);
    for (let i = 0; i < eccLen; i++) rem[i] ^= gfMul(gen[i + 1], factor);
  }
  return rem;
}

// ── 編碼 ───────────────────────────────────────────────────

/** 字串 → UTF-8 位元組 */
function utf8Bytes(text) {
  return typeof TextEncoder === 'function'
    ? Array.from(new TextEncoder().encode(text))
    : Array.from(unescape(encodeURIComponent(String(text))), c => c.charCodeAt(0));
}

/** 挑一個裝得下的版本。裝不下就丟錯——**不要默默截斷**，那會產生一張掃得出錯誤內容的 QR */
function pickVersion(byteLen) {
  for (const v of [1, 2, 3, 4]) if (byteLen <= byteCapacity(v)) return v;
  throw new Error(`QR：${byteLen} 個位元組太長了（這一版最多 ${byteCapacity(4)}）`);
}

/** 資料碼字：模式 + 長度 + 內容 + 終止符 + 補滿 */
function buildCodewords(bytes, version) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };

  push(0b0100, 4);            // Byte 模式
  push(bytes.length, 8);      // 版本 1–9 的長度欄位是 8 bits
  for (const b of bytes) push(b, 8);

  const capacityBits = dataCodewords(version) * 8;
  // 終止符最多 4 個 0，但剩不到 4 bits 時就少放幾個
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  // 補滿用 0xEC / 0x11 交替，這是規格指定的，不是隨便挑的
  for (let i = 0; out.length < dataCodewords(version); i++) out.push(i % 2 === 0 ? 0xec : 0x11);
  return out;
}

/**
 * 切區塊 → 各自算容錯 → 交錯。
 *
 * ⚠️ 交錯不是「資料全部接完再接容錯」，而是**逐欄取**：
 *    先取每個區塊的第 1 個資料碼字、再第 2 個…，容錯也一樣。
 *    版本 1–3 只有一個區塊，寫錯了看不出來——版本 4 才會現形。
 */
function interleave(data, version) {
  const numBlocks = NUM_BLOCKS[version];
  const eccLen = ECC_PER_BLOCK[version];
  const shortLen = Math.floor(dataCodewords(version) / numBlocks);
  const numShort = numBlocks - (dataCodewords(version) % numBlocks);

  const blocks = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    blocks.push({ dat, ecc: reedSolomon(dat, eccLen) });
  }

  const out = [];
  const maxData = Math.max(...blocks.map(b => b.dat.length));
  for (let i = 0; i < maxData; i++) {
    for (const b of blocks) if (i < b.dat.length) out.push(b.dat[i]);
  }
  for (let i = 0; i < eccLen; i++) for (const b of blocks) out.push(b.ecc[i]);
  return out;
}

// ── 版面 ───────────────────────────────────────────────────

const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1]
];

/** 建立矩陣與「哪些格子是功能圖樣」的遮罩 */
function drawFunctionPatterns(version) {
  const size = SIZE_OF(version);
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));

  const setFn = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    m[r][c] = dark;
    fn[r][c] = true;
  };

  // 三個定位圖樣＋分隔區（分隔區是白的，但也算功能圖樣，不可以被資料佔走）
  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const dark = r >= 0 && r < 7 && c >= 0 && c < 7 ? FINDER[r][c] === 1 : false;
        setFn(br + r, bc + c, dark);
      }
    }
  }

  // 時序圖樣（第 6 列與第 6 欄，黑白相間）
  for (let i = 8; i < size - 8; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // 校準圖樣。跟定位圖樣重疊的位置要跳過——版本 1–4 只有一個，
  // 位置本來就不會撞，但寫成通用的，日後加版本才不用重寫
  const pos = ALIGN_POS[version];
  for (const r of pos) {
    for (const c of pos) {
      const nearFinder = (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
      if (nearFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFn(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // 格式資訊的位置先佔起來（值等挑好遮罩再填）。
  // ⚠️ **第 6 列與第 6 欄要跳過**：那兩格是時序圖樣，不是格式資訊。
  //    不跳的話這裡會把已經畫好的時序模組洗成白色，而 QR 看起來
  //    還是一張正常的 QR——只是掃碼器對不準格線（時序圖樣正是用來對格線的）。
  for (let i = 0; i < 9; i++) {
    if (i === 6) continue;
    setFn(8, i, false);
    setFn(i, 8, false);
  }
  for (let i = 0; i < 8; i++) { setFn(8, size - 1 - i, false); setFn(size - 1 - i, 8, false); }
  // 永遠是黑的那一格
  setFn(size - 8, 8, true);

  return { m, fn, size };
}

/** 格式資訊：5 bits 資料 → BCH(15,5) → 再 XOR 一個固定遮罩 */
function formatBits(mask) {
  const data = (EC_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(m, size, mask) {
  const bits = formatBits(mask);
  const bit = i => ((bits >>> i) & 1) === 1;

  // 第一份：左上角，沿著第 8 欄往下、再沿著第 8 列往左
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);

  // 第二份：右上與左下（掃碼器只要讀得到其中一份就行）
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);

  m[size - 8][8] = true;                       // 永遠是黑的那一格
}

/** 資料位元由右下角開始，兩欄一組蛇行往上／往下。第 6 欄是時序圖樣，整欄跳過 */
function placeData(m, fn, size, codewords) {
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const upward = ((right + 1) & 2) === 0;
        const r = upward ? size - 1 - vert : vert;
        if (fn[r][c] || i >= codewords.length * 8) continue;
        m[r][c] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
  // 剩下的位元（版本 2–4 各有 7 個）留白，規格就是這樣
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

/** 罰分：規格定的四條，分數越低越好 */
export function penalty(m) {
  const size = m.length;
  let score = 0;

  // 規則 1：同色連續 5 格以上
  for (let a = 0; a < 2; a++) {
    for (let i = 0; i < size; i++) {
      let run = 1;
      let prev = a === 0 ? m[i][0] : m[0][i];
      for (let j = 1; j < size; j++) {
        const cur = a === 0 ? m[i][j] : m[j][i];
        if (cur === prev) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        prev = cur; run = 1;
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // 規則 2：2×2 同色
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // 規則 3：像定位圖樣的 1:1:3:1:1 序列（會讓掃碼器誤判方向）
  const P1 = [true, false, true, true, true, false, true, false, false, false, false];
  const P2 = [false, false, false, false, true, false, true, true, true, false, true];
  const at = (a, i, j) => (a === 0 ? m[i][j] : m[j][i]);
  for (let a = 0; a < 2; a++) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j + 11 <= size; j++) {
        let m1 = true, m2 = true;
        for (let k = 0; k < 11; k++) {
          const v = at(a, i, j + k);
          if (v !== P1[k]) m1 = false;
          if (v !== P2[k]) m2 = false;
        }
        if (m1) score += 40;
        if (m2) score += 40;
      }
    }
  }

  // 規則 4：黑色比例離 50% 越遠罰越多
  let dark = 0;
  for (const row of m) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;

  return score;
}

/**
 * 產生 QR 的布林矩陣。
 *
 * @param {string} text 要編碼的內容（UTF-8）
 * @returns {{modules: boolean[][], size: number, version: number, mask: number}}
 */
export function qrMatrix(text) {
  // ⚠️ 一定要擋非字串。`TextEncoder().encode(null)` 會把它變成 4 個位元組的
  //    "null"——產出一張**掃得出來、但內容是 "null"** 的 QR。攤位掃到之後
  //    會去查一個叫 null 的玩家，然後看到「查不到玩家」，沒有人會想到
  //    問題出在 QR 上。
  if (typeof text !== 'string' || !text) throw new Error('QR：內容必須是非空字串');
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  const codewords = interleave(buildCodewords(bytes, version), version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const { m, fn, size } = drawFunctionPatterns(version);
    placeData(m, fn, size, codewords);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (!fn[r][c] && MASKS[mask](r, c)) m[r][c] = !m[r][c];
    }
    drawFormat(m, size, mask);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, m, size, mask };
  }
  return { modules: best.m, size: best.size, version, mask: best.mask };
}

/**
 * 畫成 SVG 字串。
 *
 * ⚠️ **一定要留白邊（quiet zone）**，規格是 4 格。少了它，深色主題下
 *    QR 直接貼著背景，很多掃碼器就找不到定位圖樣了——而畫面上看起來
 *    完全正常，只是「掃不到」。
 *
 * 顏色寫死成黑白：QR 靠對比工作，跟著主題變色會在深色模式下掃不出來。
 */
export function qrSvg(text, { quiet = 4, label = 'QR code' } = {}) {
  const { modules, size } = qrMatrix(text);
  const total = size + quiet * 2;

  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" `
    + `role="img" aria-label="${label}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<path d="${path}" fill="#000"/></svg>`;
}

export const QR_MAX_BYTES = byteCapacity(4);
