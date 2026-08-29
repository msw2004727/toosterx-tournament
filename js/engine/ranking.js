/**
 * 同分排序｜RankingRule
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §6
 *
 * ⚠️ 最容易寫錯的地方（§6.4），實作對照：
 *   1. 先依 points 分出「同分群」            → orderTied() 第一輪就是 criteria[0]='points'
 *   2. 群只有 2 隊 → 直接比兩隊之間那 1 場    → miniTable() 只取群成員彼此的比賽
 *   3. 群 >= 3 隊 → 迷你積分表                → 同上，群成員決定 miniTable 的範圍
 *   4. 拆出子群後「從步驟 1 重新開始」        → 遞迴時 criteria 從頭跑，
 *      所以剩下 2 隊會用「只有他們兩隊」的新迷你表，不會沿用 3 隊表的數字（T07）
 *   5. 條件用盡仍同分 → hasUnresolvedTie      → 絕不隨機；退回 teamId 字典序只為了讓
 *      重放結果一致（冪等性），並在 trace 標記 unresolved
 *
 * 終止性：只有在「某條件真的把群拆開」時才遞迴，而每個子群都嚴格小於原群；
 * 沒拆開就往下一個條件走。因此不會無限遞迴。
 */

import { tallyMatches, DEFAULT_POINTS } from './tally.js';

/** @typedef {'points'|'headToHeadPoints'|'headToHeadGoalDiff'|'headToHeadGoalsFor'|
 *            'headToHeadWins'|'goalDiff'|'goalsFor'|'goalsAgainstAsc'|'wins'|
 *            'fairPlay'|'seed'|'drawLots'|'manual'} Criterion */

/** FIFA 標準行為分罰分（數值越接近 0 越好） */
export const FAIR_PLAY = { yellow: -1, secondYellow: -3, directRed: -4, yellowThenRed: -5 };

/** 無法由系統判定、必須交給人的條件 */
const HUMAN_CRITERIA = new Set(['manual', 'drawLots']);

/** trace 用的短代碼（§6.5） */
const TRACE_CODE = {
  points: 'pts',
  headToHeadPoints: 'h2h-pts',
  headToHeadGoalDiff: 'h2h-gd',
  headToHeadGoalsFor: 'h2h-gf',
  headToHeadWins: 'h2h-w',
  goalDiff: 'gd',
  goalsFor: 'gf',
  goalsAgainstAsc: 'ga',
  wins: 'w',
  fairPlay: 'fp',
  seed: 'seed'
};

// ══════════════════════════════════════════════════════════════════
//  行為分（§6.3）
// ══════════════════════════════════════════════════════════════════

/**
 * 計算「單一球員、單一場比賽」的行為分。
 *
 * 裁判端只提供 yellow / second_yellow / red 三個選項，
 * 「直接紅」與「黃牌後紅」由此函式從事件序推算——裁判不必自己判斷。
 *
 * @param {Array<{cardType:string, seq?:number, voided?:boolean}>} cards
 *        同一球員在同一場的卡片事件（順序不拘，函式自己依 seq 排）
 * @returns {number} 罰分（0 或負值）
 */
export function fairPlayPoints(cards) {
  const list = sortCards(cards);
  if (!list.length) return 0;

  const redAt = list.findIndex(c => c.cardType === 'red');
  if (redAt >= 0) {
    // 紅牌「之前」是否已有黃牌——用排序後的索引比，不用 seq 的原始值。
    // 這樣即使 seq 缺漏或事後補登造成序號錯亂，也不會把 −5 誤判成 −4。
    const priorYellow = list
      .slice(0, redAt)
      .some(c => c.cardType === 'yellow' || c.cardType === 'second_yellow');
    return priorYellow ? FAIR_PLAY.yellowThenRed : FAIR_PLAY.directRed;
  }

  // 兩黃換紅只計 −3，該球員本場的黃牌不再另計 −1（T14）
  if (list.some(c => c.cardType === 'second_yellow')) return FAIR_PLAY.secondYellow;

  return list.filter(c => c.cardType === 'yellow').length * FAIR_PLAY.yellow;
}

/**
 * 卡片時序排序。
 * 01b §1.8 明訂 clockSec 才是權威，seq 只是「同分鐘排序用」，
 * 兩者都缺時退回陣列原順序（stable sort 保證）。
 */
function sortCards(cards) {
  return (cards || [])
    .filter(c => c && !c.voided && c.cardType)
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      const a = x.c.clockSec ?? x.c.seq;
      const b = y.c.clockSec ?? y.c.seq;
      if (typeof a === 'number' && typeof b === 'number' && a !== b) return a - b;
      return x.i - y.i;
    })
    .map(x => x.c);
}

/**
 * 把多場比賽的卡片事件彙總成各隊的行為分與牌數。
 *
 * ⚠️ 分堆鍵**必須包含 matchId**。§6.3 的 −3／−5 是「同一場、同一球員」的判定；
 *    若把某球員整個賽事的牌合在一起算，
 *    「第一場一張黃 ＋ 第二場兩黃換紅」會從 −4 變成 −3，名次會跟著錯。
 *
 * @param {Array<object>} cardEvents timeline 中 type==='card' 的事件（可跨場）
 * @returns {Map<string, {fairPlayPoints:number, yellow:number, red:number}>} teamId → 統計
 */
export function fairPlayByTeam(cardEvents) {
  const live = (cardEvents || []).filter(c => c && !c.voided && c.cardType);

  // 依「場次 + 隊伍 + 球員」分堆
  const byTeamPlayer = new Map();
  for (const c of live) {
    const team = c.teamId || c.side;
    if (!team) continue;
    const key = [c.matchId ?? '?', team, c.playerId ?? 'unknown'].join('|');
    if (!byTeamPlayer.has(key)) byTeamPlayer.set(key, { team, cards: [] });
    byTeamPlayer.get(key).cards.push(c);
  }

  const out = new Map();
  const bump = t => {
    if (!out.has(t)) out.set(t, { fairPlayPoints: 0, yellow: 0, red: 0 });
    return out.get(t);
  };

  for (const { team, cards } of byTeamPlayer.values()) {
    const st = bump(team);
    st.fairPlayPoints += fairPlayPoints(cards);
    // 牌面張數照實記（給公開端顯示），與罰分的合併計算無關
    st.yellow += cards.filter(c => c.cardType === 'yellow').length;
    st.red += cards.filter(c => c.cardType === 'red' || c.cardType === 'second_yellow').length;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  排序（§6.4）
// ══════════════════════════════════════════════════════════════════

/**
 * 依 RankingRule 對同一小組的積分列排序。
 *
 * @param {Array<object>} rows     standing rows（已含 points/goalDiff/... 統計）
 * @param {Array<object>} matches  該小組所有已完賽場次（供 head-to-head 使用）
 * @param {{criteria: Criterion[], points?: object}} rule
 * @param {object} [opts] 透傳給 tallyMatches（walkover / mercyRule 等），
 *                        讓迷你對戰表與全組積分榜用同一套判定
 * @returns {{rows: Array<object>, hasUnresolvedTie: boolean}}
 *          rows 為新陣列，每列附上 rank 與 tieBreakTrace，原物件不被修改
 */
export function rankRows(rows, matches, rule, opts = {}) {
  const criteria = rule?.criteria?.length ? rule.criteria : ['points'];
  const points = { ...DEFAULT_POINTS, ...(rule?.points || {}) };

  // 複製一份，並把待裁定旗標初始化成 false——
  // 前端會寫 `row.hasUnresolvedTie === false`，留 undefined 會踩空
  const work = rows.map(r => ({ ...r, tieBreakTrace: [], hasUnresolvedTie: false, tiedWith: [] }));

  const ctx = { matches: matches || [], criteria, points, opts };
  const result = orderTied(work, ctx, 0);

  result.ordered.forEach((r, i) => { r.rank = i + 1; });
  return { rows: result.ordered, hasUnresolvedTie: result.unresolved };
}

/**
 * 對一個同分群排序。
 * @param {Array<object>} group 待排序的列
 * @param {object} ctx
 * @param {number} startAt 從第幾個條件開始（只有「同一群往下一個條件」時才會 > 0）
 */
function orderTied(group, ctx, startAt) {
  if (group.length <= 1) return { ordered: group, unresolved: false };

  const ids = group.map(r => r.teamId);

  for (let i = startAt; i < ctx.criteria.length; i++) {
    const c = ctx.criteria[i];

    // manual / drawLots：系統不猜，交給主辦（§6.4 步驟 4）
    if (HUMAN_CRITERIA.has(c)) {
      const ordered = [...group].sort(byTeamId);
      for (const r of ordered) {
        r.tieBreakTrace.push(`unresolved@${c}`);
        r.hasUnresolvedTie = true;
        r.tiedWith = ids.filter(id => id !== r.teamId);
      }
      return { ordered, unresolved: true };
    }

    const values = criterionValues(c, group, ctx);
    if (!values) continue;                       // 這個條件在此情境下算不出來，往下一個

    const code = TRACE_CODE[c] || c;
    const isH2H = c.startsWith('headToHead');
    // 對戰關係要標明「跟誰比」，現場才解釋得清楚（§6.5）
    const scopeFor = r => !isH2H ? ''
      : ids.length === 2 ? `(vs ${ids.find(id => id !== r.teamId)})`
      : `(群 ${ids.join('/')})`;

    // 每個「有算過」的條件都留痕，包含沒分出高下的那些——
    // 現場被質疑名次時，要能證明「這一層我們比過了，是平的」（§6.5）
    for (const r of group) trace(r, `${code}=${fmt(values.get(r.teamId))}${scopeFor(r)}`);

    const buckets = splitByValue(group, values);

    // 沒拆開 → 這個條件分不出高下，換下一個條件（群不變，所以 startAt = i + 1）
    if (buckets.length <= 1) continue;

    const ordered = [];
    let unresolved = false;

    for (const bucket of buckets) {
      if (bucket.length === 1) {
        bucket[0].tieBreakTrace.push(`decided@${c}`);
        ordered.push(bucket[0]);
        continue;
      }
      // ⭐ 子群「從步驟 1 重新開始」：criteria 從 0 再跑一次。
      //    剩下 2 隊時，miniTable 會只用他們兩隊之間那場，不沿用大群的數字（T07）
      const sub = orderTied(bucket, ctx, 0);
      ordered.push(...sub.ordered);
      unresolved = unresolved || sub.unresolved;
    }

    return { ordered, unresolved };
  }

  // 條件用盡仍同分：不隨機。依 teamId 排出一個穩定順序，並標記待裁定（T08）
  const ordered = [...group].sort(byTeamId);
  for (const r of ordered) {
    r.tieBreakTrace.push('unresolved@exhausted');
    r.hasUnresolvedTie = true;
    r.tiedWith = ids.filter(id => id !== r.teamId);
  }
  return { ordered, unresolved: true };
}

/**
 * 算出群內每隊在某條件下的比較值。回傳 null 代表此條件不適用。
 * 一律「數值大者為優」，需要反向的條件（失球、種子序）在這裡先取負。
 */
function criterionValues(c, group, ctx) {
  const ids = group.map(r => r.teamId);
  const out = new Map();

  if (c.startsWith('headToHead')) {
    const mini = miniTable(ids, ctx);
    for (const r of group) {
      const s = mini.get(r.teamId);
      if (!s) return null;
      out.set(r.teamId,
        c === 'headToHeadPoints'   ? s.points   :
        c === 'headToHeadGoalDiff' ? s.goalDiff :
        c === 'headToHeadGoalsFor' ? s.goalsFor :
        c === 'headToHeadWins'     ? s.win      : null);
    }
    return out;
  }

  // seed 只有在「每一列都有種子序」時才適用；缺一個就整條件跳過，
  // 否則沒有種子的隊伍會被當成最後一名，是憑空造出來的排序。
  if (c === 'seed') {
    if (group.some(r => typeof r.seed !== 'number')) return null;
    for (const r of group) out.set(r.teamId, -r.seed);
    return out;
  }

  // 其餘統計欄位一律來自 computeRows()，必定存在；
  // 萬一呼叫端自己組 rows 而漏欄位，以 0 代入，不要靜默跳過整個條件
  for (const r of group) {
    const v =
      c === 'points'         ? num(r.points) :
      c === 'goalDiff'       ? num(r.goalDiff) :
      c === 'goalsFor'       ? num(r.goalsFor) :
      c === 'goalsAgainstAsc'? -num(r.goalsAgainst) :     // 失球少者優先
      c === 'wins'           ? num(r.win) :
      c === 'fairPlay'       ? num(r.fairPlayPoints) :    // 罰分是負值，大者（罰得少）優先
      null;
    if (v === null) return null;                          // 未知的條件名稱，跳過
    out.set(r.teamId, v);
  }
  return out;
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * 迷你對戰表：只取「群成員彼此之間」的比賽。
 * 這是 §6.4 的核心——範圍由當前群決定，所以遞迴到 2 隊時自然只剩那一場。
 */
function miniTable(ids, ctx) {
  return tallyMatches(ids, ctx.matches, {
    ...ctx.opts,
    points: ctx.points,
    onlyBetweenTeams: true,
    // 迷你表不套用整隊退賽的作廢邏輯：呼叫端傳進來的 matches 已經篩過了
    withdrawnTeamIds: []
  }).stats;
}

/** 依比較值由大到小分堆，回傳 [[最優的那些], [次優的那些], ...] */
function splitByValue(group, values) {
  const uniq = [...new Set(group.map(r => values.get(r.teamId)))].sort((a, b) => b - a);
  return uniq.map(v => group.filter(r => values.get(r.teamId) === v));
}

const byTeamId = (a, b) => String(a.teamId).localeCompare(String(b.teamId));
const fmt = v => String(v);

/** 寫入 trace，但同一句話不重複記（遞迴回到 points 時會重算一次） */
function trace(row, entry) {
  if (row.tieBreakTrace.at(-1) !== entry) row.tieBreakTrace.push(entry);
}

// ══════════════════════════════════════════════════════════════════
//  人工裁定（§10「兩隊同分無法判定」）
// ══════════════════════════════════════════════════════════════════

/**
 * 套用 Admin 手動指定的名次。被指定的隊伍釘在該名次，其餘依原順序遞補。
 *
 * 主辦一旦裁定，該同分群就不再是「待裁定」——
 * 因此會清掉被裁定隊伍（以及與其同群者）的 hasUnresolvedTie，
 * 否則晉級解算會永遠被 `hasUnresolvedTie` 擋住（§7.2）。
 *
 * @param {Array<object>} rows      rankRows() 的輸出
 * @param {Array<{teamId:string, rank:number}>} pins
 * @returns {Array<object>} 新排序後的 rows（rank 已重編、被釘住的列 locked=true）
 */
export function applyManualRanking(rows, pins = []) {
  const pinBy = new Map(pins.map(p => [p.teamId, p.rank]));

  // 被裁定的隊伍，以及跟他們同群的隊伍，都算已解決
  const settled = new Set(pinBy.keys());
  for (const r of rows) {
    if (!pinBy.has(r.teamId)) continue;
    for (const other of r.tiedWith || []) settled.add(other);
  }

  const clean = r => ({
    ...r,
    hasUnresolvedTie: settled.has(r.teamId) ? false : (r.hasUnresolvedTie ?? false),
    tiedWith: settled.has(r.teamId) ? [] : (r.tiedWith ?? [])
  });

  const slots = new Array(rows.length).fill(null);
  for (const r of rows) {
    const want = pinBy.get(r.teamId);
    if (want >= 1 && want <= rows.length && slots[want - 1] === null) {
      slots[want - 1] = { ...clean(r), rank: want, locked: true };
    }
  }
  const taken = new Set(slots.filter(Boolean).map(s => s.teamId));
  const rest = rows.filter(r => !taken.has(r.teamId));
  let k = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === null) slots[i] = { ...clean(rest[k++]), rank: i + 1, locked: false };
  }
  return slots;
}

/** 從既有的 standing 取出人工釘選，供重算時沿用（§10「Admin 手動拖曳排序」） */
export function manualPinsOf(standing) {
  return (standing?.rows || [])
    .filter(r => r.locked === true && typeof r.rank === 'number')
    .map(r => ({ teamId: r.teamId, rank: r.rank }));
}
