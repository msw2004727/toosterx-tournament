/**
 * 場次改判的純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/04 §6（管理員 LIVE 介面）、docs/05 §7；競賽規章第十八條第 6 款
 *
 * 「按下去之後那份場次文件會變成什麼樣」都在這裡。不碰 Firestore、
 * 不呼叫 Date.now()（時間戳由呼叫端補 serverTimestamp）。
 *
 * ⭐ 這一組是**比賽當天記錯分時唯一的補救工具**。在此之前，賽務台送出
 *    完賽超過三分鐘就再也改不動了——現場只能請主辦直接改資料庫。
 *
 * 三件不可協商：
 *   1. **改比分一定要重算 result。** `result.winner` 與積分是積分榜的
 *      唯一依據；只改 score 不改 result，積分榜會用舊的勝負算——
 *      畫面顯示 2:1，積分卻記著對手贏。
 *   2. **每一個動作都必填原因。** 這幾條是「一切可修正、一切留痕」裡
 *      最需要留痕的：改的是已經公開出去的結果。
 *   3. **棄賽比分照規章算，不是手填。** 規章第十八條第 6 款是 0:2
 *      （`DEFAULT_WALKOVER`），手填會讓不同場次的判法不一致。
 */

import { DEFAULT_WALKOVER } from '../../engine/tally.js';
import { scoreOf as engineScoreOf, matchResult } from '../../engine/result.js';
import { lastPlayedPeriod } from '../staff/live-actions.js';

/** 已經產生勝負、動它就會動到積分榜的狀態 */
export const DECIDED_STATUSES = ['finished', 'confirmed', 'walkover'];

/** 還沒開打 */
export const NOT_STARTED_STATUSES = ['scheduled', 'checkin', 'ready'];

/** 嚴格取整數比分（引擎的那一份，這裡只是轉手）。⚠️ 不可以用 Number()：Number(null) 是 0（R-ENG-002） */
export const scoreOf = engineScoreOf;

/**
 * 由比分算出 result——**只有引擎的 matchResult 一份**（R-ENG-001）。
 * 賽務端送出完賽也用同一支；兩份實作曾經分岔（驗收 C-01）。
 * PK 只在正規時間平手時才決定勝負。
 */
export function resultOf(score, penaltyScore, opts = {}) {
  return matchResult(score, penaltyScore, opts);
}

// ══════════════════════════════════════════════════════════════
//  能不能做（每一條都要說得出為什麼不能）
// ══════════════════════════════════════════════════════════════

/**
 * 覆核完賽（`finished` → `confirmed`）。
 *
 * ⚠️ 只有 `finished` 覆核得了，而且這跟 `firestore.rules` 的分支 (C)
 *    是同一條界線——畫面放行、規則擋掉就是假成功。
 */
export function canConfirm(match) {
  if (!match) return no('找不到場次。');
  if (match.status === 'confirmed') return no('這一場已經覆核過了。');
  if (match.status !== 'finished') return no(`只有已完賽的場次可以覆核（目前是「${match.status}」）。`);
  return yes();
}

/**
 * 重開已鎖定的場次（退回進行中）。
 *
 * ⚠️ 這會讓積分榜把這一場的分數**收回去**，而且已經解出來的晉級名單
 *    要等這一場重新完賽才會更新（`canResolve` 要求該階段全部完賽）。
 *    畫面上一定要先講這件事。
 */
export function canReopen(match) {
  if (!match) return no('找不到場次。');
  if (!DECIDED_STATUSES.includes(match.status)) {
    return no(`這一場還沒有結果，不需要重開（目前是「${match.status}」）。`);
  }
  return yes();
}

/** 改判比分：已經開打過的場次才有比分可以改 */
export function canOverride(match) {
  if (!match) return no('找不到場次。');
  if (NOT_STARTED_STATUSES.includes(match.status)) {
    return no('這一場還沒開打，請用賽務台記分而不是改判。');
  }
  return yes();
}

/** 判棄賽：還沒有結果、或已經是別的結果都可以改判（規章第十八條第 6 款） */
export function canWalkover(match) {
  if (!match) return no('找不到場次。');
  if (match.status === 'cancelled') return no('已取消的場次不判棄賽。');
  return yes();
}

const yes = () => ({ ok: true, reason: '' });
const no = reason => ({ ok: false, reason });

// ══════════════════════════════════════════════════════════════
//  Patch
// ══════════════════════════════════════════════════════════════

/**
 * 覆核。**只動 status**——`firestore.rules` 的分支 (C) 就只放行這一個欄位，
 * 多帶一個就整筆被擋（雖然 admin 走分支 (A) 全開，但保持一致比較好查）。
 */
export function buildConfirmPatch(uid) {
  return { status: 'confirmed', updatedBy: uid };
}

/**
 * 重開：退回進行中、解鎖、清掉結果與送出紀錄。
 *
 * ⚠️ `lock` 是巢狀 map，`updateDoc` 會**整包取代**——三個欄位都要寫出來，
 *    少列一個就等於把它從文件上刪掉（docs/01b §1.7）。
 *
 * ⚠️ 比分與事件**全部保留**。重開的意思是「這場還沒結束」，不是
 *    「這場沒發生過」；把比分一起清掉的話，賽務要從頭記一次。
 */
export function buildReopenPatch(uid, events = []) {
  return {
    status: 'live',
    // 退回**最後打過的那一期**（讀 timeline 的 period_start）。寫死 'h2' 的話，
    // 六個都是單節的組別重開後會顯示「下半場」、時鐘從 13 分開始（驗收 D-06）
    period: lastPlayedPeriod(events),
    result: null,
    walkoverSide: null,
    lock: { locked: false, lockedAt: null, lockedBy: null },
    scoreSubmittedAt: null,
    scoreSubmittedBy: null,
    updatedBy: uid
  };
}

/**
 * 改判比分。
 *
 * @param {object} o
 * @param {{home:number, away:number}} o.score
 * @param {{home:number|null, away:number|null}} [o.penaltyScore]
 * @param {object} o.match 現在這一份（要取 revisionCount 與原本的狀態）
 * @param {string} o.uid
 */
export function buildOverridePatch({ score, penaltyScore = null, match, uid }) {
  const h = scoreOf(score?.home);
  const a = scoreOf(score?.away);
  if (h == null || a == null) throw new Error('比分必須是 0 以上的整數');

  const pk = scoreOf(penaltyScore?.home) != null && scoreOf(penaltyScore?.away) != null
    ? { home: penaltyScore.home, away: penaltyScore.away }
    : { home: null, away: null };

  const result = resultOf({ home: h, away: a }, pk);
  // ⚠️ result 一定要跟著重算。只改 score 的話，積分榜會用舊的 winner——
  //    畫面顯示 2:1，積分卻記著對手贏，而且不會有任何錯誤訊息。
  if (!result) throw new Error('算不出勝負，不寫入');

  return {
    score: { home: h, away: a },
    penaltyScore: pk,
    result,
    // 改判之後這一場一定是「有結果」的。原本就是 walkover 的維持 walkover
    // （棄賽的比分是規章判的，改比分不會讓它變回一般完賽）。
    status: match?.status === 'walkover' ? 'walkover' : 'finished',
    // 不是棄賽就把 walkoverSide 清掉：留著的話文件同時宣稱「客隊棄賽」與「1:1 平手」（驗收 D-11）
    walkoverSide: match?.status === 'walkover' ? (match?.walkoverSide ?? null) : null,
    revisionCount: (Number.isInteger(match?.revisionCount) ? match.revisionCount : 0) + 1,
    updatedBy: uid
  };
}

/**
 * 判棄賽（規章第十八條第 6 款：逾時 5 分鐘不出場，以棄權論 0:2）。
 *
 * ⚠️ 比分**由設定算**，不是手填：`DEFAULT_WALKOVER` 是引擎與積分榜
 *    共用的那一份。手填會讓不同場次的判法不一致，而那要到頒獎才看得出來。
 *
 * @param {'home'|'away'} side 棄賽的那一方
 */
export function buildWalkoverPatch({ side, uid, walkover }) {
  if (side !== 'home' && side !== 'away') throw new Error('要指定哪一方棄賽');
  const wo = { ...DEFAULT_WALKOVER, ...(walkover || {}) };

  // walkoverSide 記的是**棄賽的那一方**，對手獲判勝
  const winnerSide = side === 'home' ? 'away' : 'home';
  const score = side === 'home'
    ? { home: wo.scoreAgainst, away: wo.scoreFor }
    : { home: wo.scoreFor, away: wo.scoreAgainst };

  return {
    status: 'walkover',
    walkoverSide: side,
    score,
    penaltyScore: { home: null, away: null },
    period: 'ft',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    result: {
      winner: winnerSide,
      method: 'walkover',
      homePoints: winnerSide === 'home' ? wo.awardPoints : wo.penaltyPoints,
      awayPoints: winnerSide === 'away' ? wo.awardPoints : wo.penaltyPoints
    },
    lock: { locked: true, lockedAt: null, lockedBy: uid },
    updatedBy: uid
  };
}

/**
 * 延期／取消。
 *
 * ⚠️ 不清比分：延期的場次改天要打，取消的場次留著紀錄。
 *    真的要歸零請用改判比分，那條路徑會留下 revisionCount。
 */
export function buildStatusPatch(status, uid) {
  if (status !== 'postponed' && status !== 'cancelled') {
    throw new Error('只能改成 postponed 或 cancelled');
  }
  return {
    status,
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    updatedBy: uid
  };
}

/**
 * 改判之後對積分榜與晉級的影響——**按下去之前就要講**。
 *
 * @returns {string[]} 要顯示給主辦看的後果
 */
export function consequencesOf(match, action) {
  const out = [];
  const wasDecided = DECIDED_STATUSES.includes(match?.status);

  if (action === 'reopen') {
    out.push('積分榜會把這一場的分數收回去。');
    out.push('已經解算出來的晉級名單要等這一場重新完賽才會更新。');
    out.push('比分與事件都保留，賽務不用重記。');
  }
  if (action === 'override' && wasDecided) {
    out.push('積分榜會立刻依新的比分重算，名次可能因此改變。');
    out.push('公開端會馬上看到新的比分。');
  }
  if (action === 'walkover') {
    out.push(`比分依競賽規章第十八條判為 ${DEFAULT_WALKOVER.scoreFor}:${DEFAULT_WALKOVER.scoreAgainst}，不是手填的。`);
    out.push('積分榜會依此重算。');
  }
  if (action === 'confirm') {
    out.push('覆核之後這一場的結果就定案了，仍然可以由管理員重開。');
  }
  if (action === 'postponed' || action === 'cancelled') {
    out.push('比分不會被清掉。這一場會從積分榜的計算中移除。');
  }
  return out;
}
