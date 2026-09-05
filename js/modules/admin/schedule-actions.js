/**
 * 賽程管理的純邏輯
 * ------------------------------------------------------------------
 * 「要寫進 Firestore 的東西長什麼樣」都在這裡，畫面只負責問與畫。
 * 不碰 Firestore、不呼叫 Date.now()（時間戳由呼叫端填）。
 *
 * 排程的**演算法**在 `js/engine/schedule.js`（種子與這裡共用，R-ENG-001），
 * 這一支只做「Firestore 的形狀 ↔ 引擎的形狀」的轉換與護欄。
 */

import {
  buildGroups, buildMatches, placeMatches, taipeiMs, slotSpanMin,
  kickoffMsOf, SCHEDULE_DEFAULTS
} from '../../engine/schedule.js';

/** 已經開打或打完的狀態。這些場次一動就會出事。 */
const STARTED = ['live', 'halftime', 'finished', 'confirmed', 'walkover'];

/**
 * 這一場**打過**了嗎——狀態在 STARTED 裡，或者雖然被延期／取消但已經有結果。
 * 延期／取消不清比分（match-actions 的 buildStatusPatch），所以一場 2:1 打完才取消的比賽
 * 狀態是 cancelled、result 還在；只看狀態會把它當成沒打過而放行重產，
 * 而重產會把它的 result 連同文件一起刪掉（驗收 D-10）。
 */
export function hadResult(m) {
  if (!m) return false;
  if (STARTED.includes(m.status)) return true;
  if (m.result && typeof m.result === 'object' && m.result.winner) return true;
  if (Number.isInteger(m.revisionCount) && m.revisionCount > 0) return true;
  if (m.lock?.locked === true) return true;
  return false;
}

/** 還沒開打的狀態 */
export const NOT_STARTED = ['scheduled', 'checkin', 'ready', 'postponed', 'cancelled'];

/** 報名核准、真的會上場的球隊 */
export function approvedTeamsOf(teams, divisionId) {
  return (teams ?? [])
    .filter(t => t.divisionId === divisionId && t.status === 'approved' && t.withdrawn !== true)
    .sort((a, b) => String(a.teamId).localeCompare(String(b.teamId)));
}

/**
 * 排程設定：讀不到就用預設值，但**要讓呼叫端知道那是預設值**。
 *
 * 悄悄套預設值的話，主辦會以為那幾個數字已經存進資料庫了，
 * 換一台電腦或換一個人來看就對不上。
 */
export function scheduleConfigOf(cfg) {
  return {
    ...SCHEDULE_DEFAULTS,
    ...(cfg ?? {}),
    venuesByDate: cfg?.venuesByDate ?? SCHEDULE_DEFAULTS.venuesByDate,
    saved: cfg != null
  };
}

/** 某一天可用的場地（依 config/schedule 的 venuesByDate）。沒設定就回全部。 */
export function venuesForDate(cfg, date, venues = []) {
  const ids = cfg?.venuesByDate?.[date];
  if (!Array.isArray(ids) || !ids.length) return [...venues];
  return ids.map(id => venues.find(v => v.venueId === id)).filter(Boolean);
}

/**
 * 能不能重新產生這一組的賽程。
 *
 * ⚠️ 只要有**任何一場**已經開打就整組擋下來。
 *    「只重產沒打的那幾場」聽起來合理，但分組是一整組一起算的——
 *    重抽一次籤，已經打完的那幾場就變成不同小組之間的比賽，
 *    積分榜會靜靜地算出一份沒有人看得懂的結果。
 */
export function canRegenerate(existingMatches = []) {
  const started = existingMatches.filter(hadResult);
  if (started.length) {
    return {
      ok: false,
      started: started.map(m => m.matchId),
      reason: `已經有 ${started.length} 場開打或完賽（${started.slice(0, 3).map(m => m.matchId).join('、')}${started.length > 3 ? '…' : ''}），不能重新產生賽程。`
    };
  }
  return { ok: true, started: [], reason: '' };
}

/**
 * 產生一組賽程的完整計畫（還沒寫進去）。
 *
 * @param {object} o
 * @param {object} o.division
 * @param {Array}  o.orderedTeams 已經決定順序的球隊（抽籤或手動）
 * @param {object} o.format
 * @returns {{stages:Array, groupDocs:Array, matches:Array, assignments:Array}}
 */
export function planGeneration({ division, orderedTeams, format }) {
  const rr = (format?.stages ?? []).find(s => s.type === 'roundRobin');
  const groups = buildGroups(orderedTeams, rr?.groupCount ?? 1);
  const { stages, groups: groupDocs, matches, groupAssign } =
    buildMatches({ division, format, groups });

  return {
    stages,
    groupDocs,
    matches,
    groups,
    assignments: orderedTeams.map((t, i) => ({
      teamId: t.teamId, seed: i + 1, groupId: groupAssign[t.teamId] ?? null
    }))
  };
}

/**
 * 完整的場次文件（新產生的場次）。
 *
 * 欄位照 docs/01b §1.7，跟 `scripts/seed/build.js` 寫的同一套——
 * 少一個欄位不會報錯，只會讓賽務台在比賽當天讀到 undefined。
 */
export function matchDocOf({ m, division, eventId, matchNo = null, venueName = null }) {
  return {
    matchId: m.matchId, eventId,
    divisionId: m.divisionId, stageId: m.stageId, groupId: m.groupId,
    round: m.round, matchNo, label: m.label,
    matchKey: m.matchKey ?? null,
    date: division.date ?? null,
    kickoffAt: m.kickoffMs != null ? new Date(m.kickoffMs) : null,
    venueId: m.venueId ?? null, venueName,
    home: m.home, away: m.away, teamIds: m.teamIds ?? [],
    score: { home: 0, away: 0 }, htScore: { home: 0, away: 0 },
    penaltyScore: { home: null, away: null },
    status: 'scheduled', period: 'pre',
    clock: { running: false, periodStartedAt: null, elapsedSecAtPause: 0, addedTimeSec: 0 },
    result: { winner: null, method: null, homePoints: 0, awayPoints: 0 },
    walkoverSide: null, walkoverReason: null,
    officials: { referee: null, assistants: [], scorer: null },
    stream: { enabled: false, provider: 'youtube', videoId: null, startOffsetSec: 0, status: 'off' },
    checkin: { homeConfirmed: false, awayConfirmed: false, confirmedAt: null },
    lock: { locked: false, lockedAt: null, lockedBy: null },
    scoreMismatch: false, revisionCount: 0
  };
}

/**
 * 自動排定時間與場地。
 *
 * `otherMatches` 要帶**別的組別**當天已排好的場次，不然兩組會排到
 * 同一片場地的同一個時段——而 Firestore 不會阻止你寫進去。
 *
 * @returns {{placed:Array, unplaced:Array}}
 */
export function planPlacement({ division, matches, otherMatches = [], venues, cfg, divisions = [] }) {
  const date = division?.date;
  const dayStartMs = taipeiMs(date, cfg.startTime);
  const dayEndMs = taipeiMs(date, cfg.endTime);
  if (dayStartMs == null || dayEndMs == null) {
    return {
      placed: [],
      unplaced: matches.map(m => ({ match: m, reason: `組別沒有比賽日期，或排程設定的時間格式不對（${date} ${cfg.startTime}–${cfg.endTime}）` }))
    };
  }

  const divById = Object.fromEntries(divisions.map(d => [d.divisionId, d]));
  // ⚠️ **只濾掉自己這一組**，不濾日期。
  //    ・自己這一組要濾掉：不然重排一次，舊的位置會把自己擋住，
  //      每重排一次就整批往後擠（變異 #S16 守這件事）。
  //    ・日期**不要**濾：權威是時間區間，別天的場次算出來的區間本來就
  //      不會重疊。反而是「date 欄位跟 kickoffAt 對不起來」的那種資料，
  //      用 date 濾會把一個真的衝突濾掉——那就是安靜地排出兩場同時同地。
  const occupied = otherMatches
    .filter(m => m.divisionId !== division.divisionId)
    .map(m => {
      const start = kickoffMsOf(m);
      if (start == null || !m.venueId) return null;
      const dur = divById[m.divisionId]?.matchDurationMin ?? division.matchDurationMin ?? 30;
      return {
        venueId: m.venueId, startMs: start,
        endMs: start + slotSpanMin(dur, cfg.bufferMin) * 60000,
        teamIds: m.teamIds ?? []
      };
    })
    .filter(Boolean);

  // 時段長度取當天最長的一種，避免不同組別的場地時間互相錯開
  const sameDay = divisions.filter(d => d.date === date);
  const slotMin = Math.max(
    slotSpanMin(division.matchDurationMin, cfg.bufferMin),
    ...sameDay.map(d => slotSpanMin(d.matchDurationMin, cfg.bufferMin))
  );

  return placeMatches({
    matches, occupied, venues,
    dayStartMs, dayEndMs, slotMin,
    bufferMin: cfg.bufferMin,
    divisions: [division],
    minRestMin: cfg.minRestMin
  });
}

/** 一批「只改時間與場地」的場次 patch */
export function movePatch({ kickoffMs, venueId, venueName }) {
  return {
    kickoffAt: kickoffMs != null ? new Date(kickoffMs) : null,
    venueId: venueId ?? null,
    venueName: venueName ?? null
  };
}

/** 抽籤的種子。呼叫端提供時間，引擎不碰 Date.now()（R-ENG-004）。 */
export function drawSeedFrom(nowMs) {
  if (!Number.isFinite(nowMs)) throw new TypeError('drawSeedFrom：需要一個毫秒數字');
  return Math.floor(nowMs % 2147483647);
}
