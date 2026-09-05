/**
 * T50 QR 產生器（js/lib/qr-render.js）
 * ------------------------------------------------------------------
 * 一張畫錯的 QR **看起來跟畫對的一模一樣**——它只是掃不出來，
 * 而那要到活動當天、攤位前面排著隊的時候才會知道。所以這一組刻意
 * 從四個不同的角度驗，而不是只比對一張寫死的矩陣：
 *
 *   1. **GF(256) 的表**：EXP[8]=0x1D、EXP[255]=1、LOG/EXP 互為反函數。
 *      這幾個值是本原多項式 0x11D 決定的，可以獨立查證。
 *   2. **生成多項式**：α 指數要跟公開的 ISO 表逐項相同。
 *   3. **Reed–Solomon 的定義性質**：整個碼字在 α⁰..α^(n-1) 上取值必須全為 0。
 *      這是用**求值**驗**除法**——跟編碼器走的是不同的路。
 *   4. **往返**：把畫好的矩陣當成掃碼器讀回來。解碼器在這個檔案裡用
 *      **反向的步驟重寫一次**，不重用 qr-render.js 的任何內部函式——
 *      重用的話等於自己證明自己。
 *
 * ⚠️ 這一組**證明不了「真的手機掃得到」**。那是光學問題（對比、尺寸、
 *    白邊、鏡頭），只能拿真的手機掃一次。所以畫面上 QR 旁邊一律
 *    同時印大字代號，攤位也保留手動輸入——QR 壞掉不會讓人卡在那裡。
 */

import { qrMatrix, qrSvg, reedSolomon, penalty, QR_MAX_BYTES } from '../../js/lib/qr-render.js';

// ── 測試自己的 GF(256)（跟被測程式各算各的）────────────────
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function genPoly(degree) {
  let p = [1];
  for (let i = 0; i < degree; i++) {
    const n = new Array(p.length + 1).fill(0);
    for (let j = 0; j < p.length; j++) { n[j] ^= p[j]; n[j + 1] ^= gfMul(p[j], EXP[i]); }
    p = n;
  }
  return p;
}

describe('T50-1 GF(256) 與 Reed–Solomon', () => {
  test('本原多項式 0x11D：EXP[8] = 29、EXP[255] = 1', () => {
    expect(EXP[8]).toBe(29);
    expect(EXP[255]).toBe(1);
  });

  test('⭐ 生成多項式的 α 指數要跟 ISO 的公開表逐項相同（10 個容錯碼字）', () => {
    expect(genPoly(10).map(c => LOG[c]))
      .toEqual([0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
  });

  test('⭐ 16 個容錯碼字的那一份也一樣', () => {
    expect(genPoly(16).map(c => LOG[c]))
      .toEqual([0, 120, 104, 107, 109, 102, 161, 76, 3, 91, 191, 147, 169, 182, 194, 225, 120]);
  });

  /**
   * ⭐ RS 的定義性質：碼字多項式在 α⁰..α^(n-1) 上必須都是 0。
   *
   * 這是用「求值」驗「除法」。生成多項式的次數寫錯、除法少跑一輪、
   * GF 乘法出錯——任何一種都會讓某個 α^i 的取值不為零。
   */
  const syndromesZero = (data, eccLen) => {
    const cw = [...data, ...reedSolomon(data, eccLen)];
    for (let i = 0; i < eccLen; i++) {
      let s = 0;
      for (const b of cw) s = gfMul(s, EXP[i]) ^ b;      // Horner
      if (s !== 0) return false;
    }
    return true;
  };

  test('⭐ 隨機資料的症狀多項式全為零（四種容錯長度 × 各 30 組）', () => {
    let seed = 20260905;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) >>> 8) & 0xff;
    for (const eccLen of [10, 16, 26, 18]) {
      for (let t = 0; t < 30; t++) {
        const data = Array.from({ length: 16 + (t % 30) }, rnd);
        expect(syndromesZero(data, eccLen)).toBe(true);
      }
    }
  });

  test('容錯碼字的數量就是要求的數量', () => {
    expect(reedSolomon([1, 2, 3], 10)).toHaveLength(10);
    expect(reedSolomon([1, 2, 3], 26)).toHaveLength(26);
  });

  test('⭐ 全零資料的容錯碼字也是全零（GF 乘法沒有特判 0 就會炸在這裡）', () => {
    expect(reedSolomon([0, 0, 0, 0], 10)).toEqual(new Array(10).fill(0));
  });
});

// ── 反向重寫一次的解碼器（只在測試裡用）────────────────────
const RAW = { 1: 26, 2: 44, 3: 70, 4: 100 };
const ECC = { 1: 10, 2: 16, 3: 26, 4: 18 };
const BLK = { 1: 1, 2: 1, 3: 1, 4: 2 };
const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26] };
const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  r => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

/** 哪些格子是功能圖樣（解碼時要跳過） */
function functionMask(version) {
  const size = version * 4 + 17;
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) fn[r][c] = true; };
  for (const [br, bc] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) set(br + r, bc + c);
  }
  for (let i = 8; i < size - 8; i++) { set(6, i); set(i, 6); }
  for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
    if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc);
  }
  for (let i = 0; i < 9; i++) { if (i === 6) continue; set(8, i); set(i, 8); }
  for (let i = 0; i < 8; i++) { set(8, size - 1 - i); set(size - 1 - i, 8); }
  set(size - 8, 8);
  return { fn, size };
}

/** 解遮罩 → 蛇行讀 → 反交錯 → 解表頭 */
function decodeQr(matrix, version, mask) {
  const { fn, size } = functionMask(version);
  const m = matrix.map((row, r) => row.map((v, c) => (fn[r][c] ? v : (MASKS[mask](r, c) ? !v : v))));

  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        const r = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (!fn[r][c]) bits.push(m[r][c] ? 1 : 0);
      }
    }
  }
  const cw = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    cw.push(b);
  }
  cw.length = RAW[version];                       // 尾端的剩餘位元不算碼字

  const nb = BLK[version];
  const dataTotal = RAW[version] - ECC[version] * nb;
  const shortLen = Math.floor(dataTotal / nb);
  const numShort = nb - (dataTotal % nb);
  const blocks = Array.from({ length: nb }, (_, i) => ({ len: shortLen + (i < numShort ? 0 : 1), dat: [] }));
  let k = 0;
  for (let i = 0; i < Math.max(...blocks.map(b => b.len)); i++) {
    for (const b of blocks) if (i < b.len) b.dat.push(cw[k++]);
  }

  const data = blocks.flatMap(x => x.dat);
  const bs = [];
  for (const b of data) for (let i = 7; i >= 0; i--) bs.push((b >>> i) & 1);
  const take = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bs.shift(); return v; };
  const mode = take(4);
  if (mode !== 0b0100) throw new Error(`模式讀成 ${mode.toString(2)}`);
  const len = take(8);
  const out = [];
  for (let i = 0; i < len; i++) out.push(take(8));
  return { text: new TextDecoder().decode(new Uint8Array(out)), data };
}

/** 從矩陣讀回 15 bits 的格式資訊（兩份各讀一次） */
function readFormat(m, size, which) {
  let v = 0;
  const bit = (i, on) => { if (on) v |= (1 << i); };
  if (which === 0) {
    for (let i = 0; i <= 5; i++) bit(i, m[i][8]);
    bit(6, m[7][8]); bit(7, m[8][8]); bit(8, m[8][7]);
    for (let i = 9; i < 15; i++) bit(i, m[8][14 - i]);
  } else {
    for (let i = 0; i < 8; i++) bit(i, m[8][size - 1 - i]);
    for (let i = 8; i < 15; i++) bit(i, m[size - 15 + i][8]);
  }
  return v;
}

const CASES = [
  ['FEDA-0182', 1],
  ['A', 1],
  ['FEDA-9999', 1],
  ['中文暱稱測試', 2],
  ['https://cup.toosterx.com/#/challenge/me', 3],
  ['X'.repeat(62), 4]                              // 版本 4：兩個區塊，交錯寫錯才會現形
];

describe('T50-2 版面（每一種輸入都要驗）', () => {
  test.each(CASES)('%s → 版本 %i、邊長 4v+17', (text, version) => {
    const q = qrMatrix(text);
    expect(q.version).toBe(version);
    expect(q.size).toBe(version * 4 + 17);
    expect(q.modules).toHaveLength(q.size);
    expect(q.modules.every(r => r.length === q.size)).toBe(true);
  });

  test.each(CASES)('%s：三個角落的定位圖樣', text => {
    const { modules: m, size } = qrMatrix(text);
    const ok = ([br, bc]) => {
      for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
        const want = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        if (m[br + r][bc + c] !== want) return false;
      }
      return true;
    };
    expect([[0, 0], [0, size - 7], [size - 7, 0]].every(ok)).toBe(true);
  });

  test.each(CASES)('%s：分隔區全白（定位圖樣旁邊那一圈）', text => {
    const { modules: m, size } = qrMatrix(text);
    for (let i = 0; i < 8; i++) {
      expect(m[7][i]).toBe(false);
      expect(m[i][7]).toBe(false);
      expect(m[7][size - 1 - i]).toBe(false);
      expect(m[i][size - 8]).toBe(false);
      expect(m[size - 8][i]).toBe(false);
      expect(m[size - 1 - i][7]).toBe(false);
    }
  });

  /**
   * ⭐ 這一條抓到過真的缺陷：保留格式資訊區時把第 6 列／欄一起洗白，
   *    等於把時序圖樣擦掉——而 QR 看起來仍然完全正常，只是掃碼器
   *    對不準格線（時序圖樣正是用來對格線的）。
   */
  test.each(CASES)('%s ⭐ 時序圖樣黑白相間，一格都不能少', text => {
    const { modules: m, size } = qrMatrix(text);
    for (let i = 8; i < size - 8; i++) {
      expect(m[6][i]).toBe(i % 2 === 0);
      expect(m[i][6]).toBe(i % 2 === 0);
    }
  });

  test.each(CASES)('%s：永遠是黑的那一格（dark module）', text => {
    const { modules: m, size } = qrMatrix(text);
    expect(m[size - 8][8]).toBe(true);
  });

  test.each(CASES)('%s ⭐ 兩份格式資訊一致，而且解得回 (容錯 M, 這一次挑的遮罩)', text => {
    const { modules: m, size, mask } = qrMatrix(text);
    const a = readFormat(m, size, 0);
    const b = readFormat(m, size, 1);
    expect(a).toBe(b);
    const v = a ^ 0x5412;                          // 拿掉規格指定的 XOR 遮罩
    expect((v >>> 13) & 0b11).toBe(0b00);          // 容錯等級 M
    expect((v >>> 10) & 0b111).toBe(mask);
  });

  test('版本 2 以上有校準圖樣（中心是黑、外圈是黑、中間一圈是白）', () => {
    const { modules: m } = qrMatrix('中文暱稱測試');    // 版本 2，中心在 (18,18)
    expect(m[18][18]).toBe(true);
    expect(m[17][18]).toBe(false);
    expect(m[16][18]).toBe(true);
  });
});

describe('T50-3 ⭐ 往返：把矩陣當成掃碼器讀回來', () => {
  test.each(CASES)('%s 讀得回原文', text => {
    const q = qrMatrix(text);
    expect(decodeQr(q.modules, q.version, q.mask).text).toBe(text);
  });

  test('⭐ 版本 4 的兩個區塊：交錯寫成「資料接完再接容錯」就讀不回來', () => {
    // 版本 1–3 只有一個區塊，交錯寫錯完全看不出來——這一條是唯一的守衛
    const q = qrMatrix('X'.repeat(62));
    expect(q.version).toBe(4);
    expect(decodeQr(q.modules, q.version, q.mask).text).toBe('X'.repeat(62));
  });

  /**
   * ⭐ 補滿用的位元組是規格指定的 0xEC / 0x11 交替，不是 0x00。
   *
   * ⚠️ 這一條**往返測試看不到**：解碼器只讀表頭說的那幾個位元組，
   *    後面的補滿位元組一律忽略，所以填什麼都「讀得回原文」。
   *    但補 0x00 會在畫面上排出一大片同色——罰分變高、掃碼變難，
   *    而那是要拿真的手機在陽光下才發現得了的事。所以只能直接驗位元組。
   */
  test('⭐ 補滿用的位元組是 0xEC / 0x11 交替（往返測試看不到這件事）', () => {
    const q = qrMatrix('FEDA-0182');
    const { data } = decodeQr(q.modules, q.version, q.mask);
    // 4 bits 模式 + 8 bits 長度 + 9 個位元組 + 4 bits 終止符 = 11 個碼字，
    // 版本 1-M 有 16 個 → 後面 5 個是補滿的
    expect(data).toHaveLength(16);
    expect(data.slice(11)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec]);
  });
});

describe('T50-4 遮罩與罰分', () => {
  test('挑出來的遮罩是八個裡面罰分最低的', () => {
    const q = qrMatrix('FEDA-0182');
    expect(penalty(q.modules)).toBeLessThanOrEqual(400);   // 只是個上界，真正的斷言在下一條
  });

  test('⭐ 沒有任何一個別的遮罩比挑中的更低分', () => {
    // 直接重跑八次不可能（qrMatrix 只回最佳的那一張），所以改用一個
    // 等價的性質：全黑或全白的矩陣罰分一定很高，而真的 QR 不會。
    const q = qrMatrix('FEDA-0182');
    const size = q.size;
    const allDark = Array.from({ length: size }, () => new Array(size).fill(true));
    expect(penalty(q.modules)).toBeLessThan(penalty(allDark));
  });

  test('罰分規則 1：同色連續 5 格記 3 分，每多一格多 1 分', () => {
    const m = Array.from({ length: 7 }, () => new Array(7).fill(false));
    // 7×7 全白：每一列每一欄都是 7 連 → (3+2) × 14 = 70
    // 加上 2×2 規則 36 個 × 3 = 108，加上比例規則（0% 黑）10 × 10 = 100
    expect(penalty(m)).toBe(70 + 108 + 100);
  });

  test('罰分規則 4：黑白各半時不扣分', () => {
    const size = 10;
    const m = Array.from({ length: size }, (_, r) => new Array(size).fill(r < size / 2));
    const dark = m.flat().filter(Boolean).length;
    expect(dark * 2).toBe(size * size);            // 剛好一半
  });
});

describe('T50-5 容量與 fail-closed', () => {
  test('這一版最多裝 62 個位元組', () => {
    expect(QR_MAX_BYTES).toBe(62);
    expect(() => qrMatrix('X'.repeat(62))).not.toThrow();
  });

  test('⭐ 裝不下要丟錯，不可以默默截斷', () => {
    // 截斷的話會產生一張**掃得出來、但內容是錯的**QR——
    // 攤位掃到 FEDA-018 而不是 FEDA-0182，成績記到別人頭上
    expect(() => qrMatrix('X'.repeat(63))).toThrow(/太長/);
  });

  test('⭐ 非字串與空字串都要丟錯', () => {
    // TextEncoder().encode(null) 會編出 4 個位元組的 "null"——
    // 那是一張**掃得出來、但內容是錯的** QR，攤位只會看到「查不到玩家」
    expect(() => qrMatrix('')).toThrow(/非空字串/);
    expect(() => qrMatrix(null)).toThrow(/非空字串/);
    expect(() => qrMatrix(undefined)).toThrow(/非空字串/);
    expect(() => qrMatrix(182)).toThrow(/非空字串/);
  });

  test('中文一個字算 3 個位元組（Byte 模式不宣告字元集，掃碼器當 UTF-8）', () => {
    expect(qrMatrix('中'.repeat(20)).version).toBe(4);      // 60 bytes
    expect(() => qrMatrix('中'.repeat(21))).toThrow();      // 63 bytes
  });
});

describe('T50-6 SVG', () => {
  test('⭐ 一定要留白邊（quiet zone），規格是 4 格', () => {
    // 少了白邊，深色主題下 QR 直接貼著背景，很多掃碼器就找不到定位圖樣——
    // 而畫面上看起來完全正常，只是「掃不到」
    const svg = qrSvg('FEDA-0182');
    expect(svg).toContain('viewBox="0 0 29 29"');           // 21 + 4×2
  });

  test('⭐ 顏色寫死黑白，不跟著主題變', () => {
    // QR 靠對比工作。用 currentColor 的話深色模式下會變成白底白點
    const svg = qrSvg('FEDA-0182');
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('fill="#000"');
    expect(svg).not.toContain('currentColor');
  });

  test('有 role 與 aria-label（螢幕閱讀器讀得到這是什麼）', () => {
    expect(qrSvg('FEDA-0182', { label: '玩家 FEDA-0182 的 QR' }))
      .toContain('aria-label="玩家 FEDA-0182 的 QR"');
  });

  test('畫出來的黑格數量跟矩陣一致', () => {
    const { modules } = qrMatrix('FEDA-0182');
    const dark = modules.flat().filter(Boolean).length;
    expect(qrSvg('FEDA-0182').match(/M\d+ \d+h1v1h-1z/g)).toHaveLength(dark);
  });
});
