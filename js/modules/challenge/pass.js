/**
 * Game Pass 的身分（免註冊）
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.1
 *
 * 玩家不註冊、不留手機、不登入 LINE。他的身分就是一組
 * `FEDA-0182`，存在自己手機的 localStorage 裡，換裝置時用 ID 找回。
 *
 * ⚠️ **localStorage 每一次存取都要 try/catch。** 無痕視窗、把網站資料
 *    設成封鎖、iOS 的某些情況——`localStorage` 這個屬性本身就會丟例外，
 *    不是回傳 null。沒接住的話整頁白掉，而玩家只會看到一片空白。
 *
 * ⚠️ 這裡是**唯一**碰 `Math.random()` 的地方（配號）。引擎保持純函式
 *    （R-ENG-004），亂數留在畫面層——跟 `admin/standing-actions.js` 的
 *    `newSeed()` 同一個道理。
 */

import { formatPlayerId, normalizePlayerId } from '../../engine/challenge.js';

const KEY = 'feda:gamePass';

/**
 * 讀回這台裝置上的 Game Pass。
 *
 * 讀不到、壞掉、被清掉一律回 `null`——呼叫端就會把人導去建立頁，
 * 那比顯示一個錯誤訊息有用得多。
 */
export function savedPass() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    const playerId = normalizePlayerId(o?.playerId);
    return playerId
      ? {
          playerId,
          nickname: o?.nickname ?? null,
          // 聯絡憑證：只有建卡的那支手機有；找回的卡沒有（docs/06 §7.2）
          contactKey: typeof o?.contactKey === 'string' && o.contactKey ? o.contactKey : null,
          contactMasked: typeof o?.contactMasked === 'string' ? o.contactMasked : null
        }
      : null;
  } catch {
    return null;
  }
}

/** 存起來。存不進去**不算失敗**——ID 還是有效的，只是下次要自己輸入 */
export function savePass({ playerId, nickname = null, contactKey = null, contactMasked = null }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ playerId, nickname, contactKey, contactMasked }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 填聯絡方式用的憑證（docs/06 §7.2）：建卡時在這支手機上產生，只把 sha256 送上去。
 * players 文件任何人都讀得到、代號掃得完——沒有這一層，知道代號的人就改得動別人的電話。
 */
export function newContactKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

export function clearPass() {
  try { localStorage.removeItem(KEY); } catch { /* 清不掉就算了 */ }
}

/**
 * 產生一組還沒有人用的候選編號。
 *
 * ⚠️ **這裡不保證唯一。** 唯一性由 `firestore.rules` 守：`players` 只放行
 *    `create`，撞到已經存在的文件會變成 `update` 而被擋下（fail-closed）。
 *    所以呼叫端拿到 `permission-denied` 就換一組再試，不要把它當成失敗。
 *
 * 為什麼不做一份計數器：計數器要讓「任何人都寫得動」才行（玩家沒有登入），
 * 那等於開一個誰都能把號碼燒光的入口。四位數有一萬組，現場幾百人的規模
 * 撞號機率很低，而且撞了也只是重試一次。
 */
export function newPlayerId() {
  return formatPlayerId(Math.floor(Math.random() * 10000));
}

/** 使用者手動輸入的 ID → 正規化（大小寫、缺前綴、多餘空白都接得住） */
export const parsePlayerId = normalizePlayerId;

/**
 * 暱稱檢查。
 *
 * 規則跟 `firestore.rules` 一致（1–12 個字）——前端擋一次只是為了給好的
 * 訊息，真正的邊界在規則那邊。兩邊分岔的方向是「畫面說可以、送出被擋」。
 */
export function checkNickname(input) {
  const s = String(input ?? '').trim();
  if (!s) return { ok: false, reason: '請取一個暱稱' };
  if (s.length > 12) return { ok: false, reason: '暱稱最多 12 個字' };
  return { ok: true, nickname: s };
}

/** 年齡層。**選填**——總榜不分齡，但日後要分獎品時補問不回來 */
export const AGE_BANDS = [
  { value: 'kid', label: '兒童' },
  { value: 'teen', label: '青少年' },
  { value: 'adult', label: '成人' }
];
