/**
 * 攤位端的純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/06 §4、§6.2、§10
 *
 * 「送出的東西長什麼樣、能不能送、送出去之後要顯示什麼」都在這裡，
 * 畫面只負責問與畫。不碰 Firestore、不呼叫 Date.now()（時間由呼叫端給）。
 *
 * 演算法在 `js/engine/challenge.js`（純函式，攤位端與 Function 共用，
 * R-ENG-001）——最佳成績與排行榜只能有一份實作。
 */

import { toMillis } from '../../lib/format.js';
import {
  validateScore, sumShots, validateLadder, attemptQuota, pickBest,
  formatScore, isBetter, rankingOf, numOf
} from '../../engine/challenge.js';

/** 送出之後鎖住按鈕的秒數（docs/06 §10：防手殘連按） */
export const SUBMIT_LOCK_MS = 3000;

/** 同一玩家同一關，這段時間內的第二次送出視為重複（docs/06 §10） */
export const DEDUPE_MS = 5000;

/** 攤位可以自己作廢的時間窗（docs/06 §6.3；firestore.rules 也擋同一個數字） */
export const VOID_WINDOW_MS = 10 * 60 * 1000;

/**
 * 這一關要用哪一種輸入介面。
 *
 * ⚠️ 讀不到 `inputMode` 時回 `numpad`（最通用的那一個）而不是丟錯：
 *    攤位在現場最不需要的就是「這一關打不開」。但**成績範圍仍然由
 *    validateScore fail-closed 守著**，所以不會因此收到亂七八糟的值。
 */
export function inputModeOf(challenge) {
  const m = challenge?.inputMode;
  return ['stepper', 'shots', 'ladder', 'numpad'].includes(m) ? m : 'numpad';
}

/**
 * 目前輸入的狀態能不能算出一個成績。
 *
 * 四種介面的輸入形狀不一樣（shots 是每球一個分數、ladder 是選一級、
 * 其餘是一個數字），但**送出的一律是 rawValue ＋ 選填的 detail**。
 *
 * @param {object} o
 * @param {object} o.challenge
 * @param {number|null} o.value  stepper / ladder / numpad 的值
 * @param {Array|null}  o.detail shots 的每球分數
 * @returns {{ok:boolean, rawValue:number|null, detail:Array|null, reason:string}}
 */
export function resolveScore({ challenge, value, detail }) {
  const mode = inputModeOf(challenge);

  if (mode === 'shots') {
    const r = sumShots(detail, challenge);
    if (!r.ok) return { ok: false, rawValue: null, detail: null, reason: r.reason };
    const v = validateScore(r.total, challenge);
    return v.ok
      ? { ok: true, rawValue: r.total, detail: [...detail], reason: '' }
      : { ok: false, rawValue: null, detail: null, reason: v.reason };
  }

  if (mode === 'ladder') {
    const l = validateLadder(value, challenge);
    if (!l.ok) return { ok: false, rawValue: null, detail: null, reason: l.reason };
    const v = validateScore(value, challenge);
    return v.ok
      ? { ok: true, rawValue: value, detail: null, reason: '' }
      : { ok: false, rawValue: null, detail: null, reason: v.reason };
  }

  const v = validateScore(value, challenge);
  return v.ok
    ? { ok: true, rawValue: value, detail: null, reason: '' }
    : { ok: false, rawValue: null, detail: null, reason: v.reason };
}

/**
 * 這一筆該不該被當成重複送出（docs/06 §10）。
 *
 * 現場真的會發生：攤位人員按了送出、畫面還沒跳，又按一次。
 * 兩筆一模一樣的成績會讓「挑戰次數」多一次，而次數是有上限的。
 *
 * @param {Array}  recent  這台裝置剛送出的紀錄 [{playerId, challengeId, rawValue, atMs}]
 * @param {object} next    要送的這一筆
 * @param {number} nowMs   呼叫端給
 */
export function isDuplicate(recent, next, nowMs) {
  if (!Number.isFinite(nowMs)) throw new TypeError('isDuplicate：需要 nowMs');
  return (recent ?? []).some(r =>
    r.playerId === next.playerId &&
    r.challengeId === next.challengeId &&
    numOf(r.rawValue) === numOf(next.rawValue) &&
    Number.isFinite(r.atMs) && nowMs - r.atMs < DEDUPE_MS);
}

/**
 * 送出一筆成績要寫進 Firestore 的文件。
 *
 * ⚠️ `createdAt` 由呼叫端填 `serverTimestamp()`——**不可以填本機時間**：
 *    `firestore.rules` 的 10 分鐘作廢窗是拿 `resource.data.createdAt`
 *    跟 `request.time` 比的，本機時間被調過就會失效（或永遠有效）。
 *
 * ⚠️ `attemptId` 是**決定性的**，不用 add()：離線佇列重送時，
 *    add() 會產生第二筆。同一次送出永遠寫同一個 id。
 */
export function buildAttempt({
  challenge, playerId, playerNickname = null, rawValue, detail = null,
  attemptNo = null, staffUid, source = 'free', boothDeviceId = null, atMs
}) {
  if (!challenge?.challengeId) throw new Error('buildAttempt：缺少關卡設定');
  if (!playerId) throw new Error('buildAttempt：缺少 playerId');
  if (!staffUid) throw new Error('buildAttempt：缺少 staffUid');
  if (numOf(rawValue) == null) throw new Error('buildAttempt：rawValue 必須是數字');
  if (!Number.isFinite(atMs)) throw new TypeError('buildAttempt：需要 atMs（呼叫端提供時間）');

  const attemptId = `${playerId}__${challenge.challengeId}__${atMs}`;
  return {
    attemptId,
    doc: {
      attemptId,
      challengeId: challenge.challengeId,
      playerId,
      playerNickname,
      attemptNo,
      rawValue,
      displayValue: formatScore(rawValue, challenge),
      detail,
      isBest: false,            // 由 Function 判定（onAttemptWritten）
      source,
      staffUid,
      boothDeviceId,
      voided: false,
      voidReason: null
      // createdAt 由呼叫端補 serverTimestamp()
    }
  };
}

/**
 * 送出成功之後畫面要說什麼（docs/06 §4.3）。
 *
 * 「個人最佳！」這句話**要在送出當下就算得出來**——等 Function 回寫
 * 排行榜再顯示的話，離線時就永遠不會出現，而攤位最需要立刻的回饋。
 *
 * @returns {{isPersonalBest:boolean, headline:string, sub:string, best:string}}
 */
export function submitFeedback({ challenge, attempts, rawValue, nickname }) {
  const prev = pickBest(attempts, challenge);
  const ranking = rankingOf(challenge);
  const isPersonalBest = prev.value == null || isBetter(rawValue, prev.value, ranking);
  const bestValue = isPersonalBest ? rawValue : prev.value;

  return {
    isPersonalBest,
    headline: `${nickname || ''} ${formatScore(rawValue, challenge)}`.trim(),
    sub: isPersonalBest ? '個人最佳' : `本次 ${formatScore(rawValue, challenge)}`,
    best: `最佳 ${formatScore(bestValue, challenge)}`
  };
}

/**
 * 這位玩家在這一關還能不能挑戰。
 *
 * ⚠️ 超過上限**不是硬擋**：畫面顯示「已達次數上限（3/3）」，但仍然
 *    讓工作人員以「加場」送出（`source: 'staff'`）。規格明文寫著
 *    「現場彈性比嚴格限制重要」（docs/06 §6.2）。
 */
export function quotaState(attempts, challenge) {
  const q = attemptQuota(attempts, challenge);
  return {
    ...q,
    // 下一次是第幾次（attemptNo 從 1 開始）
    nextAttemptNo: q.used + 1,
    // 超過上限時要用哪一種來源送出——留痕看得出這是加場
    source: q.exhausted ? 'staff' : 'free',
    note: q.exhausted
      ? `已達本關次數上限（${q.used}/${q.max}）。仍可由工作人員加場送出，會記錄在稽核裡。`
      : ''
  };
}

/**
 * 這一筆現在還作廢得掉嗎（docs/06 §6.3）。
 *
 * 三個條件都要成立，而且**跟 `firestore.rules` 同一組**：
 * 自己送出的、10 分鐘內、還沒被作廢。畫面上顯示得到、規則卻擋掉，
 * 對攤位人員來說就是系統壞了。
 *
 * ⚠️ `createdAt` 還沒同步時（離線送出）回 false 並說明原因——
 *    伺服器認可的送出時間還不存在，硬畫一顆倒數中的作廢鈕就是假成功
 *    （跟賽務端的三分鐘自撤回同一條規矩）。
 */
export function canVoid(attempt, { uid, nowMs }) {
  if (!attempt) return { ok: false, reason: '找不到這筆紀錄。' };
  if (attempt.voided === true) return { ok: false, reason: '這筆已經作廢了。' };
  if (attempt.staffUid !== uid) return { ok: false, reason: '只能作廢自己送出的紀錄，其餘請找管理員。' };

  const created = toMillis(attempt.createdAt);
  if (created == null) return { ok: false, reason: '還在等伺服器確認送出時間，稍候再試。' };
  if (!Number.isFinite(nowMs)) throw new TypeError('canVoid：需要 nowMs');

  const left = created + VOID_WINDOW_MS - nowMs;
  if (left <= 0) return { ok: false, reason: '超過 10 分鐘了，請找管理員處理。' };
  return { ok: true, reason: '', leftMs: left };
}

/**
 * Firestore Timestamp / Date / 數字 / ISO 字串 → 毫秒。
 *
 * ⚠️ 直接用 `js/lib/format.js` 那一份，**不要在這裡再寫一次**：
 *    第一版自己寫了一個，漏掉字串那一路——真的 Firestore 回 Timestamp
 *    物件所以看不出來，但任何拿到序列化時間的路徑都會回 null，
 *    然後作廢鈕永遠顯示「還在等伺服器確認」（E2E 抓到的）。
 */
export { toMillis as msOf } from '../../lib/format.js';

/**
 * 這個攤位人員負責哪幾關。
 *
 * ⚠️ 管理員以上不受 `challengeIds` 限制（跟 rules 的 `assignedChallenge()`
 *    一致），否則主辦自己進不了任何攤位頁。
 */
export function myChallenges(challenges, { challengeIds, isAdmin }) {
  const list = (challenges ?? []).filter(c => c?.challengeId);
  if (isAdmin) return list;
  const mine = new Set(challengeIds ?? []);
  return list.filter(c => mine.has(c.challengeId));
}
