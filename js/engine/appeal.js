/**
 * 申訴（競賽規章第二十條、附件三「競賽申訴書」）
 * ------------------------------------------------------------------
 * 規章原文：
 *   「其他申訴事件，應由領隊或總教練於賽後三十分鐘內用書面提出，並需繳納
 *     保證金新台幣貳仟元整，交由本會紀律委員會處理；如申訴理由不成立時，
 *     保證金不予發還，以本會之判決為終決，不得再有異議。」
 *
 * 系統做的是**登記與留痕**：申訴書仍然是紙本（附件三要親簽），這裡記的是
 * 「誰、代表哪一隊、什麼時候提出、有沒有在 30 分鐘內、保證金收了沒、
 *   紀律委員會怎麼裁決、保證金退了沒」。改判本身走 #/admin/match 既有的動作。
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()（R-ENG-004）——時間全部由呼叫端給。
 */
import { APPEAL_RULES } from './formats.js';

/** 申訴人職稱（規章：領隊或總教練） */
export const APPEAL_ROLES = { leader: '領隊', headCoach: '總教練' };

/** 狀態代碼。顯示文字在 js/lib/format.js 的 APPEAL_STATUS_LABEL（公開端不 import 引擎） */
export const APPEAL_STATUSES = ['filed', 'upheld', 'dismissed'];

/**
 * 賽後 30 分鐘的窗口。
 *
 * `matchEndedAtMs` 是賽務台送出完賽的時間（`scoreSubmittedAt`），不是排定的開賽時間——
 * 延後開打的場次用排定時間算會少掉整段延誤。
 *
 * @returns {{ready:false, reason:string} | {ready:true, minutesAfter:number, deadlineMs:number, withinWindow:boolean}}
 */
export function appealWindow({ matchEndedAtMs, filedAtMs, windowMin = APPEAL_RULES.windowMin }) {
  if (!Number.isFinite(matchEndedAtMs)) {
    return { ready: false, reason: `這一場還沒有送出完賽的時間，算不出賽後 ${windowMin} 分鐘的期限` };
  }
  if (!Number.isFinite(filedAtMs)) return { ready: false, reason: '沒有提出時間' };
  const deadlineMs = matchEndedAtMs + windowMin * 60_000;
  return {
    ready: true,
    minutesAfter: (filedAtMs - matchEndedAtMs) / 60_000,
    deadlineMs,
    withinWindow: filedAtMs <= deadlineMs
  };
}

/**
 * 登記一件申訴。
 *
 * 規章明文的三件事都在這裡擋：申訴人是領隊或總教練、保證金已收、賽後 30 分鐘內。
 * 逾時的申訴規章不受理；主辦要破例受理必須明確帶 `late: true`（畫面上先講後果再確認），
 * 而且文件上會留下 `late: true`——事後查得到這一件是破例。
 *
 * @returns {{appealId:string, doc:object}} 時間戳由呼叫端補（serverTimestamp）
 */
export function buildAppealDoc({
  match, teamId, role, filerName, phone, reason,
  filedAtMs, matchEndedAtMs, depositPaid, late = false, actorUid = null
}) {
  if (!match?.matchId) throw new Error('沒有場次');
  const teamIds = Array.isArray(match.teamIds) && match.teamIds.length
    ? match.teamIds
    : [match.home?.teamId, match.away?.teamId].filter(Boolean);
  if (!teamIds.includes(teamId)) throw new Error('申訴單位必須是這一場的其中一隊');
  if (!APPEAL_ROLES[role]) throw new Error('申訴人必須是領隊或總教練（規章第二十條）');
  const name = String(filerName ?? '').trim();
  if (!name) throw new Error('申訴人姓名必填（申訴書要親簽）');
  const text = String(reason ?? '').trim();
  if (text.length < 5) throw new Error('申訴事由至少 5 個字');
  if (depositPaid !== true) {
    throw new Error(`保證金新台幣 ${APPEAL_RULES.deposit.toLocaleString()} 元要先收到才受理（規章第二十條）`);
  }
  const w = appealWindow({ matchEndedAtMs, filedAtMs });
  if (!w.ready) throw new Error(w.reason);
  if (!w.withinWindow && late !== true) {
    throw new Error(
      `已超過賽後 ${APPEAL_RULES.windowMin} 分鐘（提出時已賽後 ${Math.round(w.minutesAfter)} 分鐘），` +
      '規章不受理。主辦要破例受理，請在畫面上明確確認。'
    );
  }
  const opponentTeamId = teamIds.find(id => id !== teamId) ?? null;
  const appealId = `${match.matchId}-${teamId}`;
  return {
    appealId,
    doc: {
      appealId,
      matchId: match.matchId,
      matchNo: match.matchNo ?? null,
      divisionId: match.divisionId ?? null,
      teamId,
      opponentTeamId,
      filedBy: { role, name, phone: String(phone ?? '').trim() || null },
      filedAtMs,
      matchEndedAtMs,
      minutesAfter: Math.round(w.minutesAfter),
      withinWindow: w.withinWindow,
      late: !w.withinWindow,
      deposit: APPEAL_RULES.deposit,
      depositPaid: true,
      reason: text.slice(0, 2000),
      status: 'filed',
      decision: null,
      createdBy: actorUid
    }
  };
}

/**
 * 紀律委員會的裁決。
 * 保證金的去向**由規章決定，不由畫面選**：成立退還、不成立沒收。
 */
export function buildAppealDecision({ upheld, note, actorUid = null }) {
  if (typeof upheld !== 'boolean') throw new Error('要選申訴成立或不成立');
  const text = String(note ?? '').trim();
  if (!text) throw new Error('裁決意見必填——申訴時要拿得出「依什麼裁定」');
  return {
    status: upheld ? 'upheld' : 'dismissed',
    decision: {
      upheld,
      note: text.slice(0, 2000),
      byUid: actorUid,
      depositReturned: upheld            // 成立退還；不成立不予發還
    }
  };
}

/** 寫到場次文件上給公開端顯示徽章的最小摘要（不含事由與電話） */
export function matchAppealFlag(appeal) {
  if (!appeal) return null;
  return { status: appeal.status, teamId: appeal.teamId ?? null };
}

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { APPEAL_ROLES, APPEAL_STATUSES, appealWindow, buildAppealDoc, buildAppealDecision, matchAppealFlag };
}
