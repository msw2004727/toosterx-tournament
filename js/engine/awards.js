/**
 * 個人獎項統計
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §8.2
 *
 * 只有射手榜是全自動；門將榜是「系統排行 ＋ 人工評選」，
 * MVP／運動精神獎／Team Award 一律人工，這裡不做。
 */

/** 計入射手榜的事件型別。烏龍球（own_goal）不計入射手（T15）。 */
export const SCORING_TYPES = ['goal', 'penalty_scored'];

/** 只有這些狀態的場次才納入統計 */
const COUNTED_STATUSES = ['finished', 'confirmed', 'walkover'];

/**
 * 射手榜。
 *
 * @param {Array<object>} events   timeline 事件（可跨場次；periodId==='pk' 的不計）
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.countedMatchIds] 只計這些場次；省略則全計
 * @param {Object<string,object>} [opts.playerMeta] playerId → { name, teamId, teamName, jerseyNo }
 * @param {Object<string,{matches:number, minutes:number}>} [opts.appearances] 出賽場次與時間，供同分判定
 * @returns {Array<object>} 依名次排序；並列時 rank 相同
 */
export function computeScorers(events, opts = {}) {
  const only = opts.countedMatchIds
    ? new Set(opts.countedMatchIds)
    : null;

  const byPlayer = new Map();
  for (const e of events || []) {
    if (!e || e.voided) continue;
    if (!SCORING_TYPES.includes(e.type)) continue;      // own_goal 在這裡被擋掉
    // 01b §1.8 的 goalType 列舉裡也有 'own'，兩種寫法都要擋，否則烏龍球會混進射手榜
    if (e.goalType === 'own') continue;
    // PK 大戰的罰球不計入個人進球（docs/03 §9.2，國際慣例）。
    // 它跟「比賽進行中的罰球」是同一個事件型別，只差在期別，
    // 少了這一條，一場 5:4 的 PK 大戰會讓九個人的射手榜各加一球。
    if (e.periodId === 'pk') continue;
    if (!e.playerId) continue;
    if (only && e.matchId && !only.has(e.matchId)) continue;

    if (!byPlayer.has(e.playerId)) {
      byPlayer.set(e.playerId, {
        playerId: e.playerId,
        goals: 0, penalties: 0, openPlay: 0,
        matchIds: new Set()
      });
    }
    const p = byPlayer.get(e.playerId);
    p.goals += 1;
    if (e.type === 'penalty_scored' || e.goalType === 'penalty') p.penalties += 1;
    else p.openPlay += 1;
    if (e.matchId) p.matchIds.add(e.matchId);
  }

  const meta = opts.playerMeta || {};
  const app = opts.appearances || {};

  const rows = [...byPlayer.values()].map(p => {
    const m = meta[p.playerId] || {};
    const a = app[p.playerId] || {};
    return {
      playerId: p.playerId,
      name: m.name ?? null,
      teamId: m.teamId ?? null,
      teamName: m.teamName ?? null,
      jerseyNo: m.jerseyNo ?? null,
      goals: p.goals,
      penalties: p.penalties,
      openPlay: p.openPlay,
      // 同分判定：出賽場次少者優先 → 上場時間少者優先（缺資料時以進球場次數代替）
      matchesPlayed: a.matches ?? p.matchIds.size,
      minutesPlayed: a.minutes ?? null
    };
  });

  rows.sort(compareScorers);
  return assignRanks(rows, (a, b) => compareScorers(a, b) === 0);
}

function compareScorers(a, b) {
  if (b.goals !== a.goals) return b.goals - a.goals;
  if (a.matchesPlayed !== b.matchesPlayed) return a.matchesPlayed - b.matchesPlayed;
  const am = a.minutesPlayed ?? Number.MAX_SAFE_INTEGER;
  const bm = b.minutesPlayed ?? Number.MAX_SAFE_INTEGER;
  if (am !== bm) return am - bm;
  return 0;   // 真的並列
}

/**
 * 門將榜（半自動）：失球數 ÷ 上場場次，越低越好。
 * 沒有 GK 上場紀錄的球員不列入——寧可少列，也不要把後衛算成門將。
 *
 * @param {Array<object>} keeperAppearances [{ playerId, matchId, minutes }]
 * @param {Object<string,{goalsAgainst:number}>} concededByMatchTeam key = `${matchId}__${teamId}`
 * @param {object} [opts] { playerMeta, minMatches }
 */
export function computeGoalkeepers(keeperAppearances, concededByMatchTeam, opts = {}) {
  const minMatches = opts.minMatches ?? 2;
  const byPlayer = new Map();

  for (const a of keeperAppearances || []) {
    if (!a?.playerId || !a.matchId) continue;
    if (!byPlayer.has(a.playerId)) {
      byPlayer.set(a.playerId, { playerId: a.playerId, matches: 0, minutes: 0, goalsAgainst: 0, cleanSheets: 0 });
    }
    const p = byPlayer.get(a.playerId);
    const conceded = concededByMatchTeam?.[`${a.matchId}__${a.teamId}`]?.goalsAgainst ?? 0;
    p.matches += 1;
    p.minutes += a.minutes ?? 0;
    p.goalsAgainst += conceded;
    if (conceded === 0) p.cleanSheets += 1;
  }

  const meta = opts.playerMeta || {};
  const rows = [...byPlayer.values()]
    .filter(p => p.matches >= minMatches)
    .map(p => ({
      ...p,
      name: meta[p.playerId]?.name ?? null,
      teamName: meta[p.playerId]?.teamName ?? null,
      goalsAgainstPerMatch: round2(p.goalsAgainst / p.matches)
    }));

  rows.sort((a, b) =>
    a.goalsAgainstPerMatch - b.goalsAgainstPerMatch ||
    b.cleanSheets - a.cleanSheets ||
    b.matches - a.matches);

  return assignRanks(rows, (a, b) =>
    a.goalsAgainstPerMatch === b.goalsAgainstPerMatch && a.cleanSheets === b.cleanSheets);
}

/** 行為分排行（運動精神獎的參考值，非決定值） */
export function computeFairPlayBoard(standings) {
  const rows = [];
  for (const st of standings || []) {
    for (const r of st.rows || []) {
      rows.push({
        teamId: r.teamId, name: r.name,
        divisionId: st.divisionId,
        fairPlayPoints: r.fairPlayPoints ?? 0,
        yellow: r.yellow ?? 0, red: r.red ?? 0,
        played: r.played ?? 0
      });
    }
  }
  rows.sort((a, b) => b.fairPlayPoints - a.fairPlayPoints || a.yellow - b.yellow);
  return assignRanks(rows, (a, b) => a.fairPlayPoints === b.fairPlayPoints && a.yellow === b.yellow);
}

/** 並列時給同一個名次，下一個名次跳號（1,2,2,4） */
function assignRanks(rows, isTie) {
  let rank = 0;
  rows.forEach((r, i) => {
    if (i === 0 || !isTie(rows[i - 1], r)) rank = i + 1;
    r.rank = rank;
  });
  return rows;
}

const round2 = n => Math.round(n * 100) / 100;

/** 只納入已完賽場次，供呼叫端先篩一輪 */
export function countedMatchIdsOf(matches) {
  return new Set((matches || []).filter(m => COUNTED_STATUSES.includes(m.status)).map(m => m.matchId));
}
