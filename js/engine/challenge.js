/**
 * 挑戰系統引擎｜Challenge
 * ------------------------------------------------------------------
 * 規格：docs/06-Challenge挑戰系統.md §2、§6、§7
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()、不用隨機（R-ENG-004）。
 * 時間戳與 playerId 由呼叫端給，引擎只負責算。
 *
 * ⭐ 這個系統的核心設計是**成績型態抽象**（§2）：五個攤位共用同一套引擎，
 *    差別只在 `challenges/{id}` 的設定。「新增第六關只要在後台加一筆設定」
 *    是驗收 C08 的要求，所以這裡**一個 challengeId 都不能寫死**。
 *
 * ⚠️ `rankingRule: 'lower'`（時間型，越小越好）目前五關都沒有用到，
 *    但驗收 C09 明文要求。沒有人用的分支最容易寫錯又最不會被發現——
 *    所以每一個排序、比較、取最佳的地方都要同時測兩個方向。
 */

/** 合法的成績型態（§2）。新增型態要同時決定它的預設排序方向。 */
export const SCORE_TYPES = ['points', 'count', 'height', 'speed', 'time', 'distance', 'boolean'];

/** 只有 time 是「越小越好」，其餘都是越大越好。仍以設定的 rankingRule 為準。 */
export const DEFAULT_RANKING = {
  points: 'higher', count: 'higher', height: 'higher', speed: 'higher',
  time: 'lower', distance: 'higher', boolean: 'higher'
};

// ══════════════════════════════════════════════════════════════════
//  數值
// ══════════════════════════════════════════════════════════════════

/**
 * 嚴格取數值。
 *
 * ⚠️ **不可以用 `Number(v)`**（R-ENG-002）：`Number(null)` 是 0、
 *    `Number('')` 也是 0。挑戰成績 0 是合法的（九宮格可能一球都沒進），
 *    所以「沒填」跟「0 分」一定要分得開，否則沒登錄的人會出現在排行榜最後一名。
 */
export function numOf(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 顯示用字串。排行榜、我的頁面、攤位回饋一律走這一支——
 * 三個地方各自組一次的話，小數位遲早會不一致。
 */
export function formatScore(rawValue, challenge) {
  const n = numOf(rawValue);
  if (n == null) return '—';
  const d = Number.isInteger(challenge?.decimals) ? Math.max(0, Math.min(3, challenge.decimals)) : 0;
  return `${n.toFixed(d)}${challenge?.unit ?? ''}`;
}

/** 這一關的排序方向。設定沒寫就依成績型態推，再不行一律當 higher。 */
export function rankingOf(challenge) {
  const r = challenge?.rankingRule;
  if (r === 'higher' || r === 'lower') return r;
  return DEFAULT_RANKING[challenge?.scoreType] ?? 'higher';
}

/** a 是不是比 b 好。兩邊都要有值才比得出來。 */
export function isBetter(a, b, ranking = 'higher') {
  const x = numOf(a);
  const y = numOf(b);
  if (x == null) return false;
  if (y == null) return true;
  return ranking === 'lower' ? x < y : x > y;
}

// ══════════════════════════════════════════════════════════════════
//  成績驗證
// ══════════════════════════════════════════════════════════════════

/**
 * 成績合不合法。
 *
 * ⚠️ 這裡的界線**必須跟 `firestore.rules` 的 `validChallengeScore()` 一致**：
 *    `v is number && v >= c.minValue && v <= c.maxValue`。
 *    畫面說可以送、規則擋下來，對攤位工作人員來說就是系統壞了。
 *    `tests/unit/challenge.test.js` 逐字比對那一行。
 *
 * @returns {{ok:boolean, reason:string}}
 */
export function validateScore(rawValue, challenge) {
  const n = numOf(rawValue);
  if (n == null) return { ok: false, reason: '還沒有輸入成績。' };
  if (!challenge) return { ok: false, reason: '讀不到關卡設定，不能送出。' };

  const min = numOf(challenge.minValue);
  const max = numOf(challenge.maxValue);
  // 缺設定一律 fail-closed（R-ENG-005）：沒有上下限就等於沒有防呆，
  // 一個手滑的 8500 km/h 會永遠掛在排行榜第一名
  if (min == null || max == null) {
    return { ok: false, reason: '關卡沒有設定成績範圍，不能送出。' };
  }
  if (n < min || n > max) {
    return { ok: false, reason: `成績要在 ${min}–${max} ${challenge.unit ?? ''}之間。` };
  }
  return { ok: true, reason: '' };
}

/**
 * `shots` 型態（九宮格、停球王）：每球一個分數，加總為成績。
 *
 * 每球的細項要存進 `attempt.detail`，事後才分析得出「哪一格最難」（§4.2）。
 *
 * @returns {{ok:boolean, total:number|null, reason:string}}
 */
export function sumShots(detail, challenge) {
  if (!Array.isArray(detail)) return { ok: false, total: null, reason: '還沒有輸入每球的成績。' };
  const count = Number.isInteger(challenge?.shotCount) ? challenge.shotCount : null;
  if (count == null) return { ok: false, total: null, reason: '關卡沒有設定球數。' };
  if (detail.length !== count) {
    return { ok: false, total: null, reason: `要輸入 ${count} 球，目前 ${detail.length} 球。` };
  }
  const options = Array.isArray(challenge.shotOptions) ? challenge.shotOptions : null;
  let total = 0;
  for (const v of detail) {
    const n = numOf(v);
    if (n == null) return { ok: false, total: null, reason: '有一球還沒有選。' };
    if (options && !options.includes(n)) {
      return { ok: false, total: null, reason: `每球只能是 ${options.join('、')}。` };
    }
    total += n;
  }
  return { ok: true, total, reason: '' };
}

/**
 * `ladder` 型態（頭球）：點選達成的最高一級。
 * 沒有通過任何一級是合法的——那是 `minValue`，不是「沒成績」。
 */
export function validateLadder(rawValue, challenge) {
  const n = numOf(rawValue);
  const steps = Array.isArray(challenge?.ladderSteps) ? challenge.ladderSteps : null;
  if (!steps?.length) return { ok: false, reason: '關卡沒有設定高度階梯。' };
  if (n == null) return { ok: false, reason: '還沒有選高度。' };
  if (!steps.includes(n)) return { ok: false, reason: '不是階梯上的高度。' };
  return { ok: true, reason: '' };
}

// ══════════════════════════════════════════════════════════════════
//  最佳成績
// ══════════════════════════════════════════════════════════════════

/** 作廢的紀錄一律不算。作廢之後排行榜要自動退回次佳（驗收 C07）。 */
const live = list => (Array.isArray(list) ? list : []).filter(a => a && a.voided !== true);

/**
 * 時間戳（毫秒）。相容 Firestore Timestamp、Date、數字、ISO 字串。
 *
 * ⚠️ **字串那一路不能漏**：真的 Firestore 回的是 Timestamp 物件，
 *    所以漏掉也看不出來；但任何拿到序列化時間的路徑（替身 SDK、
 *    從 JSON 還原的資料、匯出再匯入）都會回 null，然後那一筆就被
 *    當成「還沒同步」排到最後面。`js/lib/format.js` 的 toMillis
 *    是同一套判斷——引擎不能 import lib（會循環），只能各留一份。
 */
export function attemptMs(a) {
  const v = a?.attemptAt ?? a?.createdAt;
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6);
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * 一位玩家在一關的「計分成績」。
 *
 * `rankBy` 決定怎麼算（§6.2）：
 *   best  取最佳一次（預設）
 *   first 取第一次   —— 想鼓勵「一次定生死」的關卡
 *   last  取最後一次
 *   sum   累加        —— 例如「總共進幾球」
 *
 * ⚠️ 同成績時**較早達成的排前面**（§5.3）。這件事在 pickBest 就要決定，
 *    不能留到排行榜排序——那時候已經丟掉是哪一次了。
 *
 * @returns {{value:number|null, attempt:object|null, count:number}}
 */
export function pickBest(attempts, challenge) {
  const list = live(attempts);
  if (!list.length) return { value: null, attempt: null, count: 0 };

  const rankBy = challenge?.attemptPolicy?.rankBy ?? 'best';
  const ranking = rankingOf(challenge);
  const byTime = [...list].sort((a, b) => {
    const ta = attemptMs(a);
    const tb = attemptMs(b);
    // 還沒同步的（時間戳是 null）排最後：它在伺服器上還不存在
    if (ta == null && tb == null) return String(a.attemptId).localeCompare(String(b.attemptId));
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });

  if (rankBy === 'first') return { value: numOf(byTime[0].rawValue), attempt: byTime[0], count: list.length };
  if (rankBy === 'last') {
    const a = byTime[byTime.length - 1];
    return { value: numOf(a.rawValue), attempt: a, count: list.length };
  }
  if (rankBy === 'sum') {
    let total = 0;
    for (const a of byTime) total += numOf(a.rawValue) ?? 0;
    return { value: total, attempt: byTime[byTime.length - 1], count: list.length };
  }

  // best：逐一比較，平手時**不換**——byTime 已經是時間順序，
  // 所以先達成的那一次會留下來
  let bestAttempt = null;
  for (const a of byTime) {
    if (numOf(a.rawValue) == null) continue;
    if (bestAttempt == null || isBetter(a.rawValue, bestAttempt.rawValue, ranking)) bestAttempt = a;
  }
  return { value: numOf(bestAttempt?.rawValue), attempt: bestAttempt, count: list.length };
}

/**
 * 哪幾筆要標成 `isBest`（§6.1 步驟 ②）。
 * 回傳需要**改動**的那幾筆，沒變的不回傳——不必要的寫入會白白觸發下游重算。
 *
 * @returns {Array<{attemptId:string, isBest:boolean}>}
 */
export function diffBestFlags(attempts, challenge) {
  const { attempt } = pickBest(attempts, challenge);
  const winner = attempt?.attemptId ?? null;
  const out = [];
  for (const a of (Array.isArray(attempts) ? attempts : [])) {
    if (!a?.attemptId) continue;
    // 作廢的一律不是 best
    const should = a.voided !== true && a.attemptId === winner;
    if ((a.isBest === true) !== should) out.push({ attemptId: a.attemptId, isBest: should });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  次數限制
// ══════════════════════════════════════════════════════════════════

/**
 * 這位玩家在這一關還能不能挑戰（§6.2）。
 *
 * ⚠️ 超過上限時**不是硬擋**：攤位端顯示「已達次數上限（3/3）」，
 *    但允許工作人員以「加場」覆寫（`source:'staff'`，記錄稽核）。
 *    現場彈性比嚴格限制重要——規格明文這樣寫。
 *
 * @returns {{used:number, max:number|null, exhausted:boolean, text:string}}
 */
export function attemptQuota(attempts, challenge) {
  const used = live(attempts).length;
  const raw = challenge?.attemptPolicy?.maxAttemptsPerPlayer;
  const max = Number.isInteger(raw) && raw > 0 ? raw : null;   // null = 不限
  const exhausted = max != null && used >= max;
  return {
    used, max, exhausted,
    text: max == null ? `已挑戰 ${used} 次` : `已挑戰 ${used} / ${max} 次`
  };
}

// ══════════════════════════════════════════════════════════════════
//  排行榜
// ══════════════════════════════════════════════════════════════════

/**
 * 一關的排行榜（§5.3）。
 *
 * @param {object} o
 * @param {Array}  o.attempts  這一關的全部成績（含作廢，內部會濾掉）
 * @param {object} o.challenge
 * @param {Object<string,object>} o.players playerId → 玩家（要暱稱）
 * @param {number} o.topN 取前幾名，預設 50
 * @returns {{rows:Array, totalPlayers:number}}
 *
 * 排序：成績（依 rankingRule）→ 同成績較早達成的排前（§5.3）
 * 名次：**逐一遞增**，不做並列。規格的示意圖裡第 3、4 名都是「3 次」
 * 但名次是 3 與 4——因為同分已經用時間分出先後了。
 */
export function buildLeaderboard({ attempts = [], challenge, players = {}, topN = 50 } = {}) {
  const ranking = rankingOf(challenge);

  // 依玩家分堆
  const byPlayer = new Map();
  for (const a of live(attempts)) {
    if (!a?.playerId) continue;
    if (!byPlayer.has(a.playerId)) byPlayer.set(a.playerId, []);
    byPlayer.get(a.playerId).push(a);
  }

  const rows = [];
  for (const [playerId, list] of byPlayer) {
    const { value, attempt, count } = pickBest(list, challenge);
    if (value == null) continue;
    const p = players[playerId] ?? {};
    rows.push({
      playerId,
      nickname: p.nickname ?? null,
      ageBand: p.ageBand ?? null,
      linkedTeamId: p.linkedTeamId ?? null,
      value,
      displayValue: formatScore(value, challenge),
      attempts: count,
      attemptAt: attemptMs(attempt)
    });
  }

  rows.sort((a, b) => {
    if (a.value !== b.value) return ranking === 'lower' ? a.value - b.value : b.value - a.value;
    // 同成績依較早達成排前。時間未知的排後面——不能讓一筆還沒同步的
    // 紀錄插到已經確定的成績前面
    const ta = a.attemptAt;
    const tb = b.attemptAt;
    if (ta == null && tb == null) return String(a.playerId).localeCompare(String(b.playerId));
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  });

  rows.forEach((r, i) => { r.rank = i + 1; });
  return { rows: rows.slice(0, Math.max(1, topN)), totalPlayers: rows.length };
}

/**
 * 我在這張榜上第幾名。
 * 不在前 50 時畫面底部仍要固定顯示自己那一列（§5.3），所以要算完整名次。
 */
export function myRank(rows, playerId) {
  const hit = (rows ?? []).find(r => r.playerId === playerId);
  return hit ?? null;
}

// ══════════════════════════════════════════════════════════════════
//  抽獎資格
// ══════════════════════════════════════════════════════════════════

/**
 * 抽獎張數（§7.1）。
 *
 * ⚠️ 規則是設定檔（`config/challengeRewards`），不可以寫死。
 *    讀不到設定時回 0 而不是猜一個預設值——多發的抽獎券收不回來。
 *
 * @param {object} o
 * @param {string[]} o.completedChallengeIds 玩家完成的關卡
 * @param {number} o.challengeTotal 全部有幾關（決定「全破」）
 * @param {object} o.rewards config/challengeRewards
 * @returns {{entries:number, fromCompletion:number, bonus:number, allComplete:boolean}}
 */
export function drawEntries({ completedChallengeIds = [], challengeTotal = 0, rewards } = {}) {
  const zero = { entries: 0, fromCompletion: 0, bonus: 0, allComplete: false };
  if (!rewards) return zero;

  const per = numOf(rewards.entriesPerCompletion) ?? 0;
  const bonusAll = numOf(rewards.bonusAllComplete) ?? 0;
  const cap = numOf(rewards.maxEntriesPerPlayer);

  const done = new Set(completedChallengeIds.filter(Boolean)).size;
  const allComplete = challengeTotal > 0 && done >= challengeTotal;

  const fromCompletion = done * per;
  const bonus = allComplete ? bonusAll : 0;
  let entries = fromCompletion + bonus;
  if (cap != null) entries = Math.min(entries, cap);

  return { entries, fromCompletion, bonus, allComplete };
}

/**
 * 送出這一筆之後，玩家的完成關卡清單要怎麼變（§6.1 步驟 ③）。
 * 只在「首次完成該關」時才增加——重複挑戰不會多給抽獎券。
 *
 * @returns {string[]|null} 需要更新時回新清單，不需要時回 null
 */
export function nextCompleted(completedChallengeIds, challengeId) {
  if (!challengeId) return null;
  const cur = Array.isArray(completedChallengeIds) ? completedChallengeIds : [];
  if (cur.includes(challengeId)) return null;
  return [...cur, challengeId];
}

// ══════════════════════════════════════════════════════════════════
//  玩家識別碼
// ══════════════════════════════════════════════════════════════════

/** `FEDA-0182`。編號由呼叫端給（引擎不產生亂數，R-ENG-004）。 */
export function formatPlayerId(n, prefix = 'FEDA') {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('formatPlayerId：n 必須是非負整數');
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** 使用者手動輸入的 ID → 正規化。大小寫、缺前綴、多餘空白都要接得住。 */
export function normalizePlayerId(input, prefix = 'FEDA') {
  const s = String(input ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  const digits = s.startsWith(`${prefix}-`) ? s.slice(prefix.length + 1)
    : s.startsWith(prefix) ? s.slice(prefix.length)
    : s;
  if (!/^\d{1,6}$/.test(digits)) return null;
  return `${prefix}-${digits.padStart(4, '0')}`;
}

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCORE_TYPES, DEFAULT_RANKING,
    numOf, formatScore, rankingOf, isBetter,
    validateScore, sumShots, validateLadder,
    attemptMs, pickBest, diffBestFlags, attemptQuota,
    buildLeaderboard, myRank,
    drawEntries, nextCompleted,
    formatPlayerId, normalizePlayerId
  };
}
