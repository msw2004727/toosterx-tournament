/**
 * 公開端純邏輯
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md
 *
 * 這個檔案不碰 DOM、不碰 Firestore、不呼叫 Date.now()（時間由呼叫端給）。
 * 所有「怎麼挑、怎麼排、怎麼分群、能顯示什麼」的判斷集中在這裡，
 * 頁面只負責把結果畫出來——這樣才測得到。
 *
 * ⚠️ 這裡**不做任何積分或名次的計算**（R-ENG-001）。
 *    積分榜的形狀由 js/engine/standing.js 產生、由 Function 寫進 standings/{id}，
 *    公開端只讀 rows 直接畫。一個數字都不重算。
 */

import { toMillis } from '../../lib/format.js';

/* ── 場次狀態 ───────────────────────────────────────────── */

export const LIVE_STATUSES = ['live', 'halftime'];
export const DONE_STATUSES = ['finished', 'confirmed', 'walkover'];
export const UPCOMING_STATUSES = ['scheduled', 'checkin', 'ready'];

export const isLiveMatch = m => LIVE_STATUSES.includes(m?.status);
export const isDoneMatch = m => DONE_STATUSES.includes(m?.status);

/**
 * 這一場的隊伍是否已經確定。
 * 排名階段的場次在分組賽跑完之前是 placeholder（「A組第1名 vs B組第2名」），
 * docs/03 §3.3 要求以斜體＋虛線框呈現，所以畫面需要分得出來。
 */
export function isPlaceholder(m) {
  return !(m?.home?.teamId) || !(m?.away?.teamId);
}

/** 隊伍顯示名：已確定用隊名，未確定用 slot 說明（例：A組第1名） */
export function sideLabel(m, side) {
  const t = m?.[side];
  if (t?.name) return t.name;
  if (t?.displayName) return t.displayName;
  if (t?.slotLabel) return t.slotLabel;
  return '待定';
}

/* ── 排序與分群 ─────────────────────────────────────────── */

/** 依 kickoffAt 升冪，同時間依 venueId（docs/03 §3.3） */
export function sortByKickoff(matches) {
  return [...(matches || [])].sort((a, b) => {
    const ta = toMillis(a?.kickoffAt);
    const tb = toMillis(b?.kickoffAt);
    // 沒有時間的排最後，而不是排最前面——把「資料不全」推到視線外，
    // 不要讓它擋住真正要看的下一場
    if (ta == null && tb == null) return String(a?.matchId).localeCompare(String(b?.matchId));
    if (ta == null) return 1;
    if (tb == null) return -1;
    if (ta !== tb) return ta - tb;
    return String(a?.venueId ?? '').localeCompare(String(b?.venueId ?? ''));
  });
}

/**
 * 以 30 分鐘為一個時段分群（docs/03 §3.3）。
 * 回傳 [{ key, label, matches }]，已依時間排序。
 * @param {number} slotMin 時段長度，預設 30
 */
export function groupBySlot(matches, hhmmOf, slotMin = 30) {
  const sorted = sortByKickoff(matches);
  const out = [];
  const index = new Map();
  const size = Math.max(1, Math.trunc(slotMin)) * 60_000;

  for (const m of sorted) {
    const ms = toMillis(m?.kickoffAt);
    // 沒有時間的自成一群，不要跟任何時段混在一起
    const key = ms == null ? 'unknown' : String(Math.floor(ms / size) * size);
    if (!index.has(key)) {
      const g = { key, label: ms == null ? '時間未定' : hhmmOf(Number(key)), matches: [] };
      index.set(key, g);
      out.push(g);
    }
    index.get(key).matches.push(m);
  }
  return out;
}

/* ── 首頁三區（docs/03 §2.1）───────────────────────────── */

/**
 * 把一批場次分成「現在進行中／接下來／剛結束」。
 * @param {object} o
 * @param {Array}  o.matches
 * @param {number} o.nowMs      呼叫端給（引擎不碰 Date.now）
 * @param {number} [o.upcoming] 接下來取幾場，預設 5
 * @param {number} [o.recent]   剛結束取幾場，預設 5
 *
 * 2026-09-03 拿掉「關注的球隊置頂」：關注按鈕整個移除了（主辦指定），
 * 留著排序等於一段永遠不會被觸發的程式碼。
 */
export function splitHomeSections({ matches, nowMs, upcoming = 5, recent = 5 }) {
  const all = sortByKickoff(matches);

  const live = all.filter(isLiveMatch);

  const next = all
    .filter(m => UPCOMING_STATUSES.includes(m?.status))
    .slice(0, upcoming);

  const done = all
    .filter(isDoneMatch)
    .sort((a, b) => {
      // 剛結束要「最近的在前」。優先用完賽時間，沒有就退回開賽時間。
      const ta = toMillis(a?.scoreSubmittedAt) ?? toMillis(a?.kickoffAt) ?? 0;
      const tb = toMillis(b?.scoreSubmittedAt) ?? toMillis(b?.kickoffAt) ?? 0;
      return tb - ta;
    })
    .filter(m => {
      const t = toMillis(m?.scoreSubmittedAt) ?? toMillis(m?.kickoffAt);
      return t == null || t <= nowMs;
    })
    .slice(0, recent);

  return { live, next, done };
}

/* ── 賽程篩選（docs/03 §3.1）────────────────────────────── */

/**
 * 篩選條件 → 場次清單。條件全部是「空值＝不限」。
 * @param {object} f { date, divisionId, venueId }
 */
export function filterMatches(matches, f = {}) {
  return (matches || []).filter(m => {
    if (f.date && m?.date !== f.date) return false;
    if (f.divisionId && m?.divisionId !== f.divisionId) return false;
    if (f.venueId && m?.venueId !== f.venueId) return false;
    return true;
  });
}

/** 篩選條件 ⇄ 網址 query（docs/03 §3.1：狀態要可分享） */
export function filterToQuery(f = {}) {
  const p = new URLSearchParams();
  if (f.date) p.set('date', f.date);
  if (f.divisionId) p.set('division', f.divisionId);
  if (f.venueId) p.set('venue', f.venueId);
  return p.toString();
}

export function queryToFilter(query) {
  const p = query instanceof URLSearchParams ? query : new URLSearchParams(query || '');
  return {
    date: p.get('date') || null,
    divisionId: p.get('division') || null,
    venueId: p.get('venue') || null
  };
}

/* ── 積分榜（只讀不算）──────────────────────────────────── */

/**
 * 一個 standing 文件 → 畫面需要的形狀。
 *
 * ⚠️ rows 可能是空的（Function 還沒重算完，或種子資料只建了空殼），
 *    這是**正常狀態**，不是錯誤。呼叫端要畫空狀態而不是崩掉。
 * ⚠️ tieBreakTrace 是給 Admin 稽核的，公開端不顯示（docs/03 §6.2 只在展開列給 Admin）。
 */
export function viewStanding(doc, { qualifyCount = 0 } = {}) {
  const rows = Array.isArray(doc?.rows) ? doc.rows : [];
  const phase = standingPhase(rows);
  // ⚠️ 引擎在「條件用盡仍同分」時就會標 hasUnresolvedTie——包括一場都還沒打的時候
  //    （每隊 0 分 0 球，當然全部同分）。那時候對觀眾說「同分條件已用盡，等主辦裁定」
  //    是錯的訊息：分組賽打完之前，同分本來就還沒有意義（驗收反饋 A-5）。
  //    裁定的判斷仍以引擎為準，公開端只在分組賽打完之後才把它顯示出來。
  const complete = phase === 'complete';
  return {
    standingId: doc?.standingId ?? null,
    divisionId: doc?.divisionId ?? null,
    stageId: doc?.stageId ?? null,
    groupId: doc?.groupId ?? null,
    phase,
    hasUnresolvedTie: complete && doc?.hasUnresolvedTie === true,
    isEmpty: rows.length === 0,
    rows: rows.map((r, i) => ({
      rank: r?.rank ?? null,
      teamId: r?.teamId ?? null,
      name: r?.name ?? '',
      played: num(r?.played), win: num(r?.win), draw: num(r?.draw), loss: num(r?.loss),
      goalsFor: num(r?.goalsFor), goalsAgainst: num(r?.goalsAgainst),
      goalDiff: num(r?.goalDiff), points: num(r?.points),
      fairPlayPoints: num(r?.fairPlayPoints),
      form: Array.isArray(r?.form) ? r.form.slice(-5) : [],
      // 晉級區以名次判斷，不是以陣列位置——rows 有可能沒排好或有並列
      qualified: qualifyCount > 0 && Number.isFinite(r?.rank) && r.rank <= qualifyCount,
      // 這一列自己排不出來時要標出來，不可以偷偷給它一個名次；
      // 分組賽還沒打完時名次是暫時的，照引擎給的順序顯示，不畫「—」
      unresolved: r?.rank == null || (complete && r?.hasUnresolvedTie === true),
      order: i
    }))
  };
}

/**
 * 分組賽的進度：'notStarted'（一場都沒打）／'inProgress'／'complete'（每隊都打滿）。
 * 單循環每隊 n−1 場；雙循環會晚一點才判定打完，只影響「暫時排名」那句話多顯示幾場，不影響名次本身。
 */
export function standingPhase(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return 'notStarted';
  const played = list.map(r => num(r?.played));
  if (played.every(p => p === 0)) return 'notStarted';
  if (played.every(p => p >= list.length - 1)) return 'complete';
  return 'inProgress';
}

/**
 * 階段代碼 → 中文。
 * 觀眾看到的不該是 `group`、`knockout` 這種東西。
 * 兒童組不用「淘汰」，用「名次賽」（docs/08 §9 文案鐵則）。
 */
const STAGE_LABEL = {
  group: '分組賽', knockout: '名次賽', placement: '名次賽',
  final: '冠軍賽', semi: '準決賽', third: '季軍賽', league: '循環賽'
};
export function stageLabel(stageId) {
  return STAGE_LABEL[stageId] || String(stageId ?? '');
}

/** standings 文件排序：階段先於小組，A 組在 B 組前面 */
export function sortStandings(docs) {
  return [...(docs || [])].sort((a, b) =>
    String(a?.stageId ?? '').localeCompare(String(b?.stageId ?? '')) ||
    String(a?.groupId ?? '').localeCompare(String(b?.groupId ?? ''))
  );
}

/* ── 公開欄位投影（R-PRIV-001）──────────────────────────── */

/**
 * roster 文件 → 畫面可以用的欄位。**白名單以外一律丟掉。**
 *
 * 為什麼要在前端再擋一次：
 *   roster 是由 Function 產生的公開投影，理論上本來就只有這些欄位
 *   （docs/01b §1.6.1）。但那個 Function 目前還沒上線，種子資料與
 *   日後的手動修補都可能讓私密欄位混進來。這一層的成本是十行程式碼，
 *   換到的是「就算上游漏了，生日與身分證後四碼也到不了 DOM」。
 *
 * ⚠️ displayName 在投影階段就已經依年齡遮蔽過了（未滿 13 歲）。
 *    公開端不再遮一次——重複遮蔽會把「王○明」變成「王○明」以外的東西，
 *    而且前端拿不到出生年月日，本來就無從判斷該不該遮。
 */
export const PUBLIC_MEMBER_FIELDS = [
  'memberId', 'teamId', 'divisionId', 'displayName', 'jerseyNo',
  'position', 'role', 'isCaptain', 'isGoalkeeper', 'photoUrl', 'stats', 'order'
];

const PRIVATE_MEMBER_FIELDS = [
  'name', 'birthDate', 'birthYear', 'idLast4', 'guardianName', 'guardianConsent',
  'contact', 'qrCode', 'eligibility'
];

export function publicMember(doc) {
  const out = {};
  for (const k of PUBLIC_MEMBER_FIELDS) if (doc?.[k] !== undefined) out[k] = doc[k];
  out.stats = {
    apps: num(doc?.stats?.apps), goals: num(doc?.stats?.goals),
    assists: num(doc?.stats?.assists), yellow: num(doc?.stats?.yellow), red: num(doc?.stats?.red)
  };
  return out;
}

/**
 * 哪些組別不對外顯示個人射手榜（docs/03 §9.1：兒童組以參與為主，避免比較壓力）。
 *
 * 判斷依據是 `division.display.scorerBoard === false`——seed 對 u6/u8/u10 就是
 * 這樣寫的。**不可以把 divisionId 寫死**（`if (id === 'u6')`）：飛達盃只是第一個
 * Event，賽制與組別都要能在後台改。
 *
 * `config/featureFlags.youthScorerBoard === true` 時全部解除（主辦可以整場打開）。
 * 讀不到旗標就當成沒開——保守的那一邊。
 *
 * @returns {Set<string>} 不顯示個人榜的 divisionId
 */
export function hiddenScorerDivisions(divisions, featureFlags) {
  if (featureFlags?.youthScorerBoard === true) return new Set();
  return new Set((divisions || [])
    .filter(d => d?.display?.scorerBoard === false && d?.divisionId)
    .map(d => d.divisionId));
}

/**
 * 這份看板有沒有東西可以顯示。
 *
 * ⚠️ **空的看板不算看板。** 種子會建一份三個陣列都是空的 `boards/live`
 *    空殼，而 Cloud Function 只在有比賽結果時才重建它。首頁的規則是
 *    「看板存在就用看板」，於是整天顯示「這個日期沒有待進行的場次」，
 *    而那一天明明排了 35 場（2026-09-05 在 demo 站上看到）。
 *
 *    退回去自己算**永遠不會比較差**：真的沒有場次時，
 *    `splitHomeSections` 算出來也是空的；看板還沒建好時，它算出來才是對的。
 *    看板是效能最佳化，不是功能的前提。
 */
export function hasBoardContent(board) {
  if (!board) return false;
  return ['liveMatches', 'nextMatches', 'justFinished']
    .some(k => Array.isArray(board[k]) && board[k].length > 0);
}

/**
 * 還沒發布賽程的組別。
 *
 * 主辦在 `#/admin/schedule` 排到一半時，公開端不該看到半套賽程——
 * 家長會照著那份跑錯時間。
 *
 * ⚠️ **只有明確的 `false` 才隱藏。** 既有的組別文件根本沒有這個欄位
 *    （這一版之前產生的），把「沒有欄位」當成未發布的話，
 *    這一版一上線，原本看得到的賽程會整個消失。
 *
 * ⚠️ 這**不是安全邊界**：`matches` 的讀取規則是 `allow read: if true`，
 *    未發布的場次仍然讀得到，只是畫面不顯示。真正的邊界在 rules。
 *
 * @returns {Set<string>} 不顯示賽程的 divisionId
 */
export function unpublishedDivisions(divisions) {
  return new Set((divisions || [])
    .filter(d => d?.schedulePublished === false && d?.divisionId)
    .map(d => d.divisionId));
}

/** 濾掉未發布組別的場次 */
export function publishedMatches(matches, divisions) {
  const hidden = unpublishedDivisions(divisions);
  if (!hidden.size) return matches ?? [];
  return (matches ?? []).filter(m => !hidden.has(m?.divisionId));
}

/** 測試用：這份文件有沒有夾帶不該公開的欄位（上游投影壞掉的訊號） */
export function leakedFields(doc) {
  return PRIVATE_MEMBER_FIELDS.filter(k => doc?.[k] !== undefined);
}

/** 名單排序：球員依背號、職員排在後面 */
export function sortRoster(members) {
  const rank = r => (r === 'player' ? 0 : r === 'coach' ? 1 : 2);
  return [...(members || [])].sort((a, b) =>
    rank(a?.role) - rank(b?.role) ||
    (num(a?.jerseyNo, 9999) - num(b?.jerseyNo, 9999)) ||
    String(a?.displayName ?? '').localeCompare(String(b?.displayName ?? ''))
  );
}

/* ── 直播（docs/03 §5.1）────────────────────────────────── */

/**
 * 三種來源 → 嵌入網址。拿不到就回 null（畫面顯示佔位圖，不要破圖）。
 * 一律用 youtube-nocookie，減少第三方 Cookie。
 */
export function embedUrl({ match, venue } = {}) {
  const off = s => !s || s.status === 'off' || s.enabled === false;

  const ms = match?.stream;
  if (!off(ms) && ms?.videoId) {
    const start = Number.isFinite(ms.startOffsetSec) && ms.startOffsetSec > 0
      ? `&start=${Math.trunc(ms.startOffsetSec)}` : '';
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ms.videoId)}`
      + `?rel=0&modestbranding=1&playsinline=1${start}`;
  }

  const vs = venue?.stream;
  if (!off(vs) && vs?.videoId) {
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(vs.videoId)}`
      + '?rel=0&modestbranding=1&playsinline=1';
  }
  if (!off(vs) && vs?.channelId) {
    return 'https://www.youtube-nocookie.com/embed/live_stream'
      + `?channel=${encodeURIComponent(vs.channelId)}&rel=0&modestbranding=1&playsinline=1`;
  }
  return null;
}

/* ── 小工具 ─────────────────────────────────────────────── */

/** 只接受真正的數字（R-ENG-002：Number(null) 是 0，會把「沒資料」顯示成 0） */
function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
export { num as _num };
