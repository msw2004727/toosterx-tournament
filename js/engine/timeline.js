/**
 * 由事件流推算比分
 * ------------------------------------------------------------------
 * 規格：docs/01b §1.8 事件型別表、docs/04 §5.6 一致性檢查
 *
 * 這段邏輯本來只長在 `js/modules/staff/live-actions.js` 裡（賽務端要即時
 * 顯示「事件加總 vs 手動比分」是否一致）。M3.9 之後 Cloud Function 也要用它
 * 對帳，於是搬進引擎——R-ENG-001：同一條規則不可以有第二份實作。
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()、不用隨機（R-ENG-004）。
 */

/**
 * 會改變比分的事件型別。
 *
 * ⚠️ 這一組**包含** own_goal，跟 `awards.js` 的 SCORING_TYPES 是兩回事：
 *    比分要算烏龍球（記給對方），射手榜不能算（那不是他的進球）。
 *    兩邊名字相近但語意不同，不要互相 import。
 */
export const GOAL_EVENT_TYPES = ['goal', 'own_goal', 'penalty_scored'];

/** 有效事件：未作廢 */
export const isLive = e => !!e && e.voided !== true;

/**
 * 由 timeline 推算比分。
 *
 * ⚠️ 烏龍球記給**對方**。這是最容易寫錯的一條：
 *    事件的 side 記的是「踢進球門的球員屬於哪一隊」，但分數要算給對手。
 *
 * @param {Array<object>} events
 * @returns {{home:number, away:number}}
 */
export function scoreFromTimeline(events) {
  const out = { home: 0, away: 0 };
  for (const e of events || []) {
    if (!isLive(e) || !GOAL_EVENT_TYPES.includes(e.type)) continue;
    if (e.side !== 'home' && e.side !== 'away') continue;
    const credit = e.type === 'own_goal'
      ? (e.side === 'home' ? 'away' : 'home')
      : e.side;
    out[credit] += 1;
  }
  return out;
}

/**
 * 事件加總與登錄比分是否一致。
 *
 * 不一致時**警示但不阻擋**——現場以裁判判定為準，差異記在
 * `match.scoreMismatch` 供 Admin 事後檢視（docs/04 §5.6）。
 *
 * ⚠️ 比分用嚴格型別檢查，不可用 `Number(v)`（R-ENG-002）：
 *    `Number(null)` 是 0，會把「沒填比分」判成 0:0 而看起來剛好一致。
 *
 * @returns {{ok:boolean, derived:{home:number,away:number},
 *            entered:{home:number|null,away:number|null}, complete:boolean}}
 */
export function reconcileScore(score, events) {
  const derived = scoreFromTimeline(events);
  const h = strictNum(score?.home);
  const a = strictNum(score?.away);
  const complete = h !== null && a !== null;
  return {
    ok: complete && derived.home === h && derived.away === a,
    derived,
    entered: { home: h, away: a },
    complete
  };
}

/** 只接受真正的數字。與 js/engine/tally.js 的 strictNum 同一條規則（R-ENG-002）。 */
function strictNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
