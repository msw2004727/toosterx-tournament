/**
 * 民國年（ROC）與西元的轉換
 * ------------------------------------------------------------------
 * 主辦指定未成年球員的生日以**民國年**輸入（家長手上的證件都是民國年，
 * 心算換算最容易填錯的就是這一格）。
 *
 * ⚠️ 規矩：**民國年只存在於畫面上。**
 *    資料庫、引擎、規章比對一律西元 ISO `YYYY-MM-DD`。
 *    存進去的那一刻就轉成西元，讀出來要顯示才轉回民國年。
 *    兩種紀年混在同一個欄位裡，差的是 1911 年，而且不會有任何錯誤訊息——
 *    只會讓一個 105 年出生的孩子被算成 105 歲。
 *
 * 民國元年 = 西元 1912 年，所以 西元 = 民國 + 1911。
 * 民國前（負數年）不處理：這個系統的使用者不會有那種生日。
 */

export const ROC_OFFSET = 1911;

/** 民國年 → 西元年 */
export const rocToAd = rocYear => Number(rocYear) + ROC_OFFSET;

/** 西元年 → 民國年 */
export const adToRoc = adYear => Number(adYear) - ROC_OFFSET;

/**
 * 民國年月日 → 西元 ISO `YYYY-MM-DD`。
 * 任何一格不合法就回 null——寧可讓表單說「請填出生年月日」，
 * 也不要拼出一個看起來像日期的字串存進資料庫。
 *
 * @returns {string|null}
 */
export function rocToIso(y, m, d) {
  const ry = toInt(y), mo = toInt(m), day = toInt(d);
  if (ry == null || mo == null || day == null) return null;
  if (ry < 1 || ry > 200) return null;              // 民國 1–200 年，超出就是打錯
  if (mo < 1 || mo > 12) return null;
  if (day < 1 || day > 31) return null;

  const ad = rocToAd(ry);
  // 2 月 30 日這種「每一格都在範圍內、但日子不存在」的組合要擋掉
  const probe = new Date(Date.UTC(ad, mo - 1, day));
  if (probe.getUTCFullYear() !== ad || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== day) return null;

  return `${String(ad).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 西元 ISO → 民國年月日。格式不對回 null。
 * @returns {{y:number, m:number, d:number}|null}
 */
export function isoToRoc(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? '').trim());
  if (!m) return null;
  const y = adToRoc(+m[1]);
  if (y < 1) return null;                            // 民國前，這裡不處理
  return { y, m: +m[2], d: +m[3] };
}

/** 西元 ISO → `民國 105 年 9 月 1 日`（給人看的） */
export function rocLabel(iso) {
  const r = isoToRoc(iso);
  return r ? `民國 ${r.y} 年 ${r.m} 月 ${r.d} 日` : '';
}

/** 西元 ISO → `105/09/01`（表格裡用，省空間） */
export function rocShort(iso) {
  const r = isoToRoc(iso);
  return r ? `${r.y}/${String(r.m).padStart(2, '0')}/${String(r.d).padStart(2, '0')}` : '';
}

/**
 * 只吃「整數字串」。
 * `Number('')` 是 0、`Number(' 5 ')` 是 5、`Number('5x')` 是 NaN——
 * 空字串變成 0 會讓民國 0 年通過檢查（R-ENG-002 的同一個坑）。
 */
function toInt(v) {
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  return Number(s);
}
