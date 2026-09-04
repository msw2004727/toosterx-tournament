/**
 * 報名開關
 * ------------------------------------------------------------------
 * 規格：docs/10 §2.3、R-REG-002、R-ENG-005
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()（現在時間由呼叫端傳）。
 *
 * ⚠️ **這裡的判斷必須跟 `firestore.rules` 的 `regOpen()` 完全一致。**
 *    畫面說「開放中」、送出卻被規則擋掉，對報名的家長來說就是系統壞了；
 *    反過來畫面說「已截止」但規則放行，主辦會以為關掉了其實沒有。
 *    rules 那一段是：
 *      exists && open == true
 *        && (opensAt == null || now >= opensAt)
 *        && (closesAt == null || now <= closesAt)
 */

/** Firestore Timestamp / Date / ISO / 毫秒 → 毫秒；解析不出來回 null */
export function toMs(v) {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * 現在到底開不開放。
 *
 * **開放條件是 AND**：主辦手動開關 **且** 現在在起訖區間內。
 * 少任何一邊，主辦就沒辦法提前關閉或延長（docs/10 §2.3）。
 *
 * 讀不到設定一律當**關閉**（R-ENG-005 fail-closed）——「沒設定就當開著」
 * 會讓一個還沒準備好的賽事在上線當天就開始收報名。
 *
 * @returns {{open:boolean, reason:string, closesAt:number|null, opensAt:number|null}}
 */
export function registrationState(cfg, nowMs = 0) {
  if (!cfg) return { open: false, reason: '報名設定還沒建立，請聯絡主辦。', closesAt: null, opensAt: null };
  const opensAt = toMs(cfg.opensAt);
  const closesAt = toMs(cfg.closesAt);

  if (cfg.open !== true) return { open: false, reason: '報名尚未開放。', closesAt, opensAt };
  if (opensAt != null && nowMs < opensAt) return { open: false, reason: '報名還沒開始。', closesAt, opensAt };
  if (closesAt != null && nowMs > closesAt) return { open: false, reason: '報名已經截止。', closesAt, opensAt };
  return { open: true, reason: '', closesAt, opensAt };
}

/**
 * 主辦按下儲存之前該看到的提醒。
 *
 * 全部是 `warn`，**沒有一條會擋住儲存**：這些都是「你可能不是故意的」，
 * 不是規章明文。系統不該替主辦訂一條規章沒有的規則
 * （跟報名審核的 error／warn 界線同一個道理）。
 *
 * @param {object} o
 * @param {number|null} o.opensAt  毫秒
 * @param {number|null} o.closesAt 毫秒
 * @param {number} o.nowMs
 * @param {string|null} [o.firstMatchDate] 最早的比賽日 `YYYY-MM-DD`
 * @param {string|null} [o.rehearsalDate]  彩排日 `YYYY-MM-DD`
 * @returns {Array<{code:string, text:string}>}
 */
export function checkRegistrationDates({ opensAt, closesAt, nowMs, firstMatchDate = null, rehearsalDate = null }) {
  const out = [];
  const add = (code, text) => out.push({ code, text });
  const dayMs = iso => (iso ? Date.parse(`${iso}T00:00:00+08:00`) : null);

  if (opensAt != null && closesAt != null && closesAt <= opensAt) {
    // 這一條最嚴重：起訖顛倒的話，AND 永遠不成立，報名頁會一直說「還沒開始」
    add('REVERSED', '截止時間早於或等於開始時間，這樣報名永遠不會開放。');
  }
  if (closesAt != null && closesAt < nowMs) {
    add('PAST', '截止時間已經過了，現在是關閉狀態。');
  }
  const first = dayMs(firstMatchDate);
  if (closesAt != null && first != null && closesAt > first) {
    add('AFTER_MATCH', '截止時間晚於第一個比賽日，比賽當天還收得到報名。');
  }
  const reh = dayMs(rehearsalDate);
  if (closesAt != null && reh != null && closesAt > reh) {
    // 彩排要用定案的名單跑，10/8 才截止的話彩排時名單還沒定
    add('AFTER_REHEARSAL', '截止時間晚於彩排日，彩排時名單還不會定案。');
  }
  return out;
}

/**
 * 組出要寫進 `config/registration` 的內容。
 *
 * ⚠️ 只回傳這一頁管得到的四個欄位。人數上限與費用不在這裡——
 *    那些照規章第十二條（權威在 `js/engine/formats.js` 的
 *    `REGISTRATION_LIMITS`，R-REG-001）。讓主辦在這裡改人數上限，
 *    等於讓系統可以跟規章不一致。
 *
 * 時間戳由呼叫端轉成 Firestore Timestamp（R-ENG-004）。
 */
export function buildRegistrationPatch({ open, opensAt, closesAt, maxTeamsPerAccount }) {
  if (typeof open !== 'boolean') throw new Error('報名開關只能是 true 或 false');
  const n = maxTeamsPerAccount;
  if (n != null && (!Number.isInteger(n) || n < 1)) {
    throw new Error('每個帳號可建立的球隊數必須是 1 以上的整數');
  }
  return {
    open,
    // null 是有意義的值（「不限制」），所以照實寫進去，不要略過
    opensAt: opensAt == null ? null : new Date(opensAt),
    closesAt: closesAt == null ? null : new Date(closesAt),
    ...(n == null ? {} : { maxTeamsPerAccount: n })
  };
}
