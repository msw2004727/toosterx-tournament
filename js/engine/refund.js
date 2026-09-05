/**
 * 退費機制與取消辦法（競賽規章第二十七條）
 * ------------------------------------------------------------------
 * 規章原文：
 *   「報名後如因故無法參加，請主動聯繫主辦單位申請取消，退費標準依據申請提出之時間點而定：
 *     ・活動日前 15 天內取消恕不接受退費申請。但容許將名額轉讓給他人
 *       （請於活動前 3 天通知主辦單位變更參加者資料）。
 *     ・特殊情況處理：若活動因不可抗力之因素……主辦單位宣布取消活動，將全額退費，不收取任何手續費。」
 *
 * 規章只寫了「15 天內不退」與「不可抗力全退」，**沒有寫**15 天以前退幾成——所以這裡
 * 15 天以前算「可退、建議全額」，金額讓主辦改，改了要寫原因（規章沒寫的事情不要升成規則）。
 *
 * 流程：隊長在球隊頁「申請取消」→ 主辦在報名審核頁處理 → 球隊變 withdrawn，退費金額與依據留在文件上。
 * 純函式：時間由呼叫端給（R-ENG-004）。
 */
import { REFUND_RULES, REGISTRATION_LIMITS } from './formats.js';
import { isYouthDivision } from './eligibility.js';

const DAY = 86_400_000;

/** 規章第十三條的報名費：學童三組 5,000、其餘 6,000（依組別設定判斷，不寫死代碼） */
export function feeOf(division) {
  return isYouthDivision(division) ? REGISTRATION_LIMITS.fee.youth : REGISTRATION_LIMITS.fee.adult;
}

/**
 * 依申請時間判斷退不退。
 * `eventDateIso` 是活動日（台北時區的當天 00:00 起算），例如 '2026-10-09'。
 */
export function refundPolicy({ requestedAtMs, eventDateIso, forceMajeure = false, rules = REFUND_RULES }) {
  if (forceMajeure === true) {
    return {
      ready: true, refundable: true, ratio: 1, rule: 'forceMajeure',
      text: '主辦因不可抗力宣布取消活動：全額退費，不收手續費（規章第二十七條）'
    };
  }
  const eventMs = Date.parse(`${eventDateIso}T00:00:00+08:00`);
  if (!Number.isFinite(eventMs)) return { ready: false, reason: '沒有活動日期，算不出退費期限' };
  if (!Number.isFinite(requestedAtMs)) return { ready: false, reason: '沒有申請時間' };

  const daysBefore = Math.floor((eventMs - requestedAtMs) / DAY);
  const cutoffMs = eventMs - rules.noRefundWithinDays * DAY;        // 從這一刻起不退
  const transferDeadlineMs = eventMs - rules.transferNoticeDays * DAY;
  if (requestedAtMs >= cutoffMs) {
    return {
      ready: true, refundable: false, ratio: 0, rule: 'within15', daysBefore, cutoffMs, transferDeadlineMs,
      text: `活動日前 ${rules.noRefundWithinDays} 天內取消不退費；可將名額轉讓給他人` +
            `（活動前 ${rules.transferNoticeDays} 天通知主辦變更參加者資料）`
    };
  }
  return {
    ready: true, refundable: true, ratio: 1, rule: 'before15', daysBefore, cutoffMs, transferDeadlineMs,
    text: `活動日前 ${rules.noRefundWithinDays} 天以前取消：可退費（規章第二十七條；規章沒有寫比例，建議全額）`
  };
}

/** 規章算出來的建議金額；主辦可以另外給 override（0 以上的整數） */
export function refundAmount({ fee, policy, override = null }) {
  if (override != null) {
    if (!Number.isInteger(override) || override < 0) throw new Error('退費金額要是 0 以上的整數');
    return override;
  }
  if (!policy?.ready) throw new Error(policy?.reason || '退費規則算不出來');
  return Math.round((Number(fee) || 0) * policy.ratio);
}

/** 隊長的取消申請（寫在球隊文件的 cancelRequest 上；時間戳由呼叫端補） */
export function buildCancelRequest({ reason, actorUid = null }) {
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('請寫取消的原因，主辦處理時要看');
  return { reason: text.slice(0, 500), byUid: actorUid, status: 'requested' };
}

/**
 * 主辦處理取消：球隊變 withdrawn，退費依據與金額留在文件上。
 * 金額跟規章算出來的不一樣時**一定要寫原因**——事後查得到為什麼多退或少退。
 */
export function buildWithdrawPatch({ team, fee, policy, amount, note, forceMajeure = false, actorUid = null }) {
  if (!policy?.ready) throw new Error(policy?.reason || '退費規則算不出來');
  if (!Number.isInteger(amount) || amount < 0) throw new Error('退費金額要是 0 以上的整數');
  const suggested = refundAmount({ fee, policy });
  const noteText = String(note ?? '').trim();
  if (amount !== suggested && !noteText) throw new Error('退費金額跟規章算出來的不一樣，請寫原因');
  return {
    status: 'withdrawn',
    refund: {
      rule: policy.rule,
      refundable: policy.refundable,
      ratio: policy.ratio,
      fee: Number(fee) || 0,
      suggested,
      amount,
      forceMajeure: forceMajeure === true,
      note: noteText || null,
      byUid: actorUid
    },
    cancelRequest: team?.cancelRequest ? { ...team.cancelRequest, status: 'processed' } : null
  };
}

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { feeOf, refundPolicy, refundAmount, buildCancelRequest, buildWithdrawPatch };
}
