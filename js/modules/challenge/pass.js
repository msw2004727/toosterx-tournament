/**
 * Game Pass 在這支手機上的快取
 * ------------------------------------------------------------------
 * 規格：docs/06 §5.1（2026-09-06 主辦修訂：挑戰卡綁 LINE 帳號、由系統配發）
 *
 * 身分的權威是伺服器上的 users/{uid}.gamePassId。這裡只是把配到的代號存在
 * localStorage：離線、或還沒登入完成時也畫得出 QR。換裝置用同一個 LINE 帳號登入就是同一張。
 *
 * ⚠️ **localStorage 每一次存取都要 try/catch。** 無痕視窗、把網站資料
 *    設成封鎖、iOS 的某些情況——`localStorage` 這個屬性本身就會丟例外，
 *    不是回傳 null。沒接住的話整頁白掉，而玩家只會看到一片空白。
 *
 * ⚠️ 這裡是**唯一**碰 `Math.random()` 的地方（配號）。引擎保持純函式
 *    （R-ENG-004），亂數留在畫面層——跟 `admin/standing-actions.js` 的
 *    `newSeed()` 同一個道理。
 */

import { normalizePlayerId } from '../../engine/challenge.js';

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
          contactMasked: typeof o?.contactMasked === 'string' ? o.contactMasked : null
        }
      : null;
  } catch {
    return null;
  }
}

/** 存起來。存不進去**不算失敗**——ID 還是有效的，只是下次要自己輸入 */
export function savePass({ playerId, nickname = null, contactMasked = null }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ playerId, nickname, contactMasked }));
    return true;
  } catch {
    return false;
  }
}

export function clearPass() {
  try { localStorage.removeItem(KEY); } catch { /* 清不掉就算了 */ }
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
