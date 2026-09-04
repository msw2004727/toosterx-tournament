/**
 * 賽程產生與排定｜Schedule
 * ------------------------------------------------------------------
 * 規格：docs/05 §6、docs/02 §4；競賽規章第十四條（賽程抽籤）
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()、不用 Math.random（R-ENG-004）。
 *
 * ⚠️ **抽籤的亂數由呼叫端給 seed**，引擎只保證「同一個 seed 一定得到
 *    同一個結果」。規章第十四條要的是大會抽籤，而抽籤最重要的性質是
 *    **事後查得到**——種子寫進 audits，任何人都能重放出同一組分組。
 *    引擎自己 `Math.random()` 的話，抽完就再也證明不了那一次抽了什麼。
 *
 * `scripts/seed/build.js` 與管理後台共用這一份（R-ENG-001）。
 * 兩邊各寫一份的話，demo 上排得出來的賽程在正式站排不出來，
 * 而且要到比賽當天才會發現。
 */

import { berger, snakeSeed, groupLabel } from './berger.js';
import { STAGE_CODE } from './formats.js';

/** @typedef {{level:'error'|'warn'|'ok', code:string, message:string, source:string, matchIds?:string[]}} Finding */

/** 還沒開打、可以任意搬動的狀態 */
const MOVABLE_STATUSES = ['scheduled', 'checkin', 'ready'];

/**
 * 排程設定的預設值。執行時的權威是 Firestore 的 `config/schedule`
 * （主辦可在後台改），這裡只是「還沒設定過」時的起點。
 *
 * ⚠️ 這幾個數字**規章都沒有規定**：
 *   ・比賽時間與用球規章有（第十七、十八條），權威在 `formats.js`
 *   ・開賽時間、場間緩衝、休息下限、可用場地是**營運決定**
 *   所以它們可以在後台改，而且相關的檢查一律是 warn 不是 error。
 */
export const SCHEDULE_DEFAULTS = {
  startTime: '08:30',
  endTime: '18:00',
  bufferMin: 10,
  minRestMin: 20,
  maxGapMin: 240,
  venuesByDate: {}
};

// ══════════════════════════════════════════════════════════════════
//  時間：台北固定 UTC+8
// ══════════════════════════════════════════════════════════════════

/**
 * `2026-10-09` + `08:30` → 毫秒。
 *
 * 直接寫死 `+08:00` 而不是靠執行環境的時區：Cloud Functions 跑在 UTC、
 * 家長的手機可能在任何地方，而「早上八點半開賽」是台北時間的八點半。
 */
export function taipeiMs(dateYmd, hhmm = '00:00') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateYmd ?? ''))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(hhmm ?? ''))) return null;
  const ms = Date.parse(`${dateYmd}T${hhmm}:00+08:00`);
  return Number.isFinite(ms) ? ms : null;
}

// ══════════════════════════════════════════════════════════════════
//  抽籤（決定性）
// ══════════════════════════════════════════════════════════════════

/** mulberry32：小、快、決定性。只用於抽籤，不用於任何安全性用途。 */
function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 抽籤：把清單洗成一個順序。
 *
 * @param {Array} items
 * @param {number} seed 整數。由呼叫端產生並**記錄下來**（audits），
 *                      不然抽籤結果就沒有證據。
 * @returns {Array} 新陣列，不動原本的
 */
export function drawOrder(items, seed) {
  if (!Array.isArray(items)) throw new TypeError('drawOrder：items 必須是陣列');
  if (!Number.isInteger(seed)) {
    throw new TypeError('drawOrder：seed 必須是整數，由呼叫端提供並記錄（R-ENG-004）');
  }
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  分組
// ══════════════════════════════════════════════════════════════════

/**
 * 依**給定的順序**蛇形分組。
 *
 * 順序從哪裡來是呼叫端的事：抽籤（`drawOrder`）、種子序、或主辦手動排。
 * 這一支不自己排序——傳進來的順序就是權威。
 *
 * @param {Array<{teamId:string}>} orderedTeams
 * @param {number} groupCount
 * @returns {Array<Array<object>>} groups[g] = [team, ...]
 */
export function buildGroups(orderedTeams, groupCount) {
  if (!Array.isArray(orderedTeams)) throw new TypeError('buildGroups：orderedTeams 必須是陣列');
  if (!Number.isInteger(groupCount) || groupCount < 1) {
    throw new RangeError('buildGroups：groupCount 必須是 >= 1 的整數');
  }
  // 明確標上 seed 再交給 snakeSeed，不倚賴 Array.prototype.sort 的穩定性——
  // 「順序看起來對」跟「順序保證對」是兩件事
  const withSeed = orderedTeams.map((t, i) => ({ ...t, seed: i + 1 }));
  return snakeSeed(withSeed, groupCount);
}

// ══════════════════════════════════════════════════════════════════
//  賽制範本
// ══════════════════════════════════════════════════════════════════

/**
 * 找一個現成的範本。找不到回 null——**不要猜**一個隊數不合的範本，
 * 那會排出少打一場或多打一場的賽程，而且要到積分榜才看得出來。
 */
export function pickFormatFor(teamCount, formats = {}) {
  const hit = Object.values(formats).find(f => f?.teamCount === teamCount);
  return hit ?? null;
}

/** 名次賽的名稱：1→冠軍賽、2→季軍賽，之後照名次寫 */
function placementLabel(k) {
  if (k === 1) return '冠軍賽';
  if (k === 2) return '季軍賽';
  return `第${2 * k - 1}、${2 * k}名賽`;
}

/**
 * 通用範本：任何隊數都排得出來。
 *
 * 現成的 4／6／8 隊範本涵蓋不了實際報名的結果（5 隊、7 隊、9 隊都可能發生）。
 * 沒有這一支的話，主辦在開賽前一週會遇到「系統排不出賽程」，
 * 而那時候能做的只剩下人工排表。
 *
 *   groupCount = 1  單循環，名次直接由積分榜決定（沒有名次賽）
 *   groupCount = 2  兩組循環 ＋ 同名次對決（A組第k名 vs B組第k名）
 *
 * 兩組隊數不等時（奇數隊），多出來的那一隊沒有名次賽，
 * 名次接在配對得到的名次之後——**場次數不齊一**，這件事寫在
 * `description` 裡讓主辦看得到，不要讓他到現場才發現有一隊少打一場。
 *
 * @param {number} teamCount
 * @param {{groupCount?:number}} opts
 */
export function genericFormat(teamCount, { groupCount } = {}) {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new RangeError('genericFormat：teamCount 必須是 >= 2 的整數');
  }
  const gc = groupCount ?? (teamCount <= 5 ? 1 : 2);
  if (gc !== 1 && gc !== 2) {
    throw new RangeError('genericFormat：目前只支援 1 或 2 組（3 組以上的交叉排名沒有定義）');
  }
  if (gc === 2 && teamCount < 4) {
    throw new RangeError('genericFormat：分兩組至少要 4 隊');
  }

  const formatId = `GEN_${teamCount}T_${gc}G`;

  if (gc === 1) {
    const total = (teamCount * (teamCount - 1)) / 2;
    return {
      formatId,
      name: `${teamCount}隊 單循環（系統產生）`,
      teamCount,
      generated: true,
      description: `每隊 ${teamCount - 1} 場，共 ${total} 場。名次由積分榜決定，沒有名次賽。`,
      stages: [{
        stageId: 'group', name: '單循環', type: 'roundRobin', order: 1,
        groupCount: 1, groupSize: teamCount, legs: 1, seedingMethod: 'snake'
      }],
      finalRankingMap: Array.from({ length: teamCount }, (_, i) => ({
        rank: i + 1,
        from: { type: 'standing', stageId: 'group', groupId: 'A', rank: i + 1 }
      }))
    };
  }

  // 兩組：蛇形之後 A、B 的隊數最多差 1
  const sizeA = Math.ceil(teamCount / 2);
  const sizeB = teamCount - sizeA;
  const pairs = Math.min(sizeA, sizeB);
  const bigger = sizeA >= sizeB ? 'A' : 'B';
  const biggerSize = Math.max(sizeA, sizeB);

  const slots = [];
  const finalRankingMap = [];
  for (let k = 1; k <= pairs; k++) {
    const matchKey = `F${2 * k - 1}`;
    slots.push({
      matchKey, label: placementLabel(k), round: 1,
      home: { type: 'standing', stageId: 'group', groupId: 'A', rank: k },
      away: { type: 'standing', stageId: 'group', groupId: 'B', rank: k }
    });
    finalRankingMap.push({ rank: 2 * k - 1, from: { type: 'matchWinner', matchKey } });
    finalRankingMap.push({ rank: 2 * k, from: { type: 'matchLoser', matchKey } });
  }
  // 多出來的那幾隊（最多一隊）沒有對手，名次直接接在後面
  for (let j = pairs + 1; j <= biggerSize; j++) {
    finalRankingMap.push({
      rank: 2 * pairs + (j - pairs),
      from: { type: 'standing', stageId: 'group', groupId: bigger, rank: j }
    });
  }

  const rrMatches = rrCount(sizeA) + rrCount(sizeB);
  const uneven = sizeA !== sizeB;
  return {
    formatId,
    name: `${teamCount}隊 兩組循環＋同名次對決（系統產生）`,
    teamCount,
    generated: true,
    description:
      `A組 ${sizeA} 隊、B組 ${sizeB} 隊，共 ${rrMatches + pairs} 場。` +
      // 這句話會顯示在畫面上，所以不放 emoji（R-UI-004）——
      // 圖示由呼叫端用 icon() 畫，emoji 在深色主題換不掉顏色
      (uneven ? `注意：隊數不齊，${bigger}組第 ${biggerSize} 名沒有名次賽，比別隊少打一場。` : ''),
    stages: [
      {
        stageId: 'group', name: '分組循環', type: 'roundRobin', order: 1,
        groupCount: 2, groupSize: sizeA, legs: 1, seedingMethod: 'snake'
      },
      { stageId: 'final', name: '名次對決', type: 'knockout', order: 2, drawRule: 'penalty', slots }
    ],
    finalRankingMap
  };
}

const rrCount = n => (n < 2 ? 0 : (n * (n - 1)) / 2);

// ══════════════════════════════════════════════════════════════════
//  對戰表
// ══════════════════════════════════════════════════════════════════

/** 場次上的隊伍參照。報名進來的球隊沒有 abbr／隊色，一律容忍為 null。 */
export function teamRefOf(t) {
  const name = t?.shortName || t?.name || null;
  return {
    teamId: t?.teamId ?? null,
    name,
    abbr: t?.abbr ?? null,
    logoUrl: t?.logoUrl ?? null,
    colorPrimary: t?.colors?.primary ?? null,
    placeholder: null,
    displayName: name
  };
}

/** 未定隊伍的佔位（docs/01b §1.7.1） */
export function placeholderRefOf(src) {
  const label =
    src?.type === 'standing' ? `${src.groupId}組第${src.rank}名`
    : src?.type === 'matchWinner' ? `${src.matchKey} 勝隊`
    : src?.type === 'matchLoser' ? `${src.matchKey} 敗隊`
    : '待定';
  return {
    teamId: null, name: null, abbr: null, logoUrl: null, colorPrimary: null,
    placeholder: src ?? null, displayName: label
  };
}

/**
 * 依 Format 產生一個組別的全部對戰。
 *
 * @param {object} o
 * @param {object} o.division 組別（要有 `code`，matchId 的前綴）
 * @param {object} o.format   賽制範本
 * @param {Array<Array<object>>} o.groups 已分好的小組（`buildGroups` 的輸出）
 * @returns {{stages:Array, groups:Array, matches:Array, groupAssign:Object}}
 */
export function buildMatches({ division, format, groups }) {
  if (!division?.code) {
    throw new Error(`組別 ${division?.divisionId ?? '(未知)'} 沒有 code，產不出 matchId`);
  }
  if (!format?.stages?.length) throw new Error('Format 沒有 stages');
  if (!Array.isArray(groups) || !groups.length) throw new Error('buildMatches：缺少分組');

  const teamTotal = groups.reduce((n, g) => n + g.length, 0);
  if (Number.isInteger(format.teamCount) && format.teamCount !== teamTotal) {
    throw new Error(
      `${division.divisionId}：Format「${format.name}」需要 ${format.teamCount} 隊，` +
      `實際 ${teamTotal} 隊。請換一個範本，或讓系統產生通用範本。`
    );
  }

  const stages = [];
  const groupDocs = [];
  const matches = [];
  const groupAssign = {};

  for (const st of format.stages) {
    stages.push({
      stageId: st.stageId, name: st.name, type: st.type, order: st.order,
      groupCount: st.groupCount ?? null, legs: st.legs ?? null,
      drawRule: st.drawRule ?? 'none',
      status: 'pending', advancementResolved: false
    });

    const code = STAGE_CODE[st.stageId];
    if (!code) throw new Error(`STAGE_CODE 沒有 ${st.stageId}，matchId 產不出來`);

    if (st.type === 'roundRobin') {
      groups.forEach((teamsInGroup, gi) => {
        const gid = groupLabel(gi);
        groupDocs.push({
          stageId: st.stageId, groupId: gid, name: `${gid}組`,
          teamIds: teamsInGroup.map(t => t.teamId), order: gi + 1
        });
        teamsInGroup.forEach(t => { groupAssign[t.teamId] = gid; });

        const rounds = berger(teamsInGroup.length);
        let seq = 0;
        rounds.forEach((round, ri) => {
          round.forEach(([h, a]) => {
            seq += 1;
            const home = teamsInGroup[h];
            const away = teamsInGroup[a];
            matches.push({
              matchId: `${division.code}-${code}-${gid}-${String(seq).padStart(2, '0')}`,
              divisionId: division.divisionId, stageId: st.stageId, groupId: gid,
              round: ri + 1, label: `${gid}組 第${ri + 1}輪`, matchKey: null,
              home: teamRefOf(home), away: teamRefOf(away),
              teamIds: [home.teamId, away.teamId],
              _sortKey: [st.order, ri + 1, gi, seq]
            });
          });
        });
      });
    } else {
      (st.slots || []).forEach((slot, si) => {
        matches.push({
          matchId: `${division.code}-${code}-${slot.matchKey}`,
          divisionId: division.divisionId, stageId: st.stageId, groupId: null,
          round: slot.round ?? 1, label: slot.label, matchKey: slot.matchKey,
          home: placeholderRefOf(slot.home),
          away: placeholderRefOf(slot.away),
          teamIds: [],
          _sortKey: [st.order, slot.round ?? 1, 0, si + 1]
        });
      });
    }
  }

  return { stages, groups: groupDocs, matches, groupAssign };
}

/** 對戰表的排列順序：階段 → 輪次 → 小組 → 序號 */
export function sortByStructure(matches) {
  return [...matches].sort((x, y) => {
    const kx = x._sortKey ?? [0, 0, 0, 0];
    const ky = y._sortKey ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const d = (kx[i] ?? 0) - (ky[i] ?? 0);
      if (d !== 0) return d;
    }
    return String(x.matchId).localeCompare(String(y.matchId));
  });
}

// ══════════════════════════════════════════════════════════════════
//  排時段與場地
// ══════════════════════════════════════════════════════════════════

/** 一場比賽在場地上佔用的時間（分）＝ 比賽時間 ＋ 場間緩衝 */
export function slotSpanMin(durationMin, bufferMin) {
  return intOr(durationMin, 0) + intOr(bufferMin, 0);
}

const intOr = (v, fallback) => (Number.isInteger(v) ? v : fallback);
const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/** 9 人制不能排進 5 人制場地；5 人制排進大場沒問題（種子本來就這樣排） */
export function fieldFits(playersOnField, venue) {
  if (playersOnField !== 9) return true;
  return venue?.fieldType !== '5v5';
}

/**
 * 把一批場次排進時段與場地（貪婪：每一場放進最早排得下的位置）。
 *
 * `occupied` 帶入當天**其他組別已排定**的場次，不然兩個組別會排到同一片場地上——
 * 而 Firestore 不會阻止你把兩場比賽寫在同一個時間同一個場地。
 *
 * @param {object} o
 * @param {Array}  o.matches   要排的場次（同一天、同一組別）
 * @param {Array}  o.occupied  已佔用：[{venueId, startMs, endMs, teamIds}]
 * @param {Array}  o.venues    當天可用的場地（依 order）
 * @param {number} o.dayStartMs 當天第一個時段
 * @param {number} o.dayEndMs   當天最後一場必須結束的時間
 * @param {number} o.slotMin    時段間隔（分）
 * @param {number} o.bufferMin   場間緩衝（分）
 * @param {number} o.minRestMin  同一隊兩場之間的休息下限（分）
 * @param {Array}  o.divisions   組別設定，用來查每一場的比賽長度與人數制。
 *                               同一天有好幾個組別時一定要帶——25 分鐘的兒童組
 *                               與 30 分鐘的成人組混在一起排，長度取錯會撞場。
 * @param {number} o.durationMin  只有一個組別時的簡寫（沒有 divisions 時才用）
 * @param {number} o.playersOnField 同上
 * @returns {{placed:Array, unplaced:Array<{match:object, reason:string}>}}
 */
export function placeMatches({
  matches, occupied = [], venues = [],
  dayStartMs, dayEndMs, slotMin, bufferMin = 0,
  divisions = [], durationMin, playersOnField, minRestMin = 0
}) {
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(dayEndMs)) {
    throw new TypeError('placeMatches：dayStartMs / dayEndMs 必須是毫秒數字');
  }
  if (!Number.isInteger(slotMin) || slotMin < 1) {
    throw new RangeError('placeMatches：slotMin 必須是 >= 1 的整數');
  }
  if (!venues.length) return { placed: [], unplaced: matches.map(m => ({ match: m, reason: '當天沒有可用場地' })) };

  const divById = Object.fromEntries(divisions.map(d => [d.divisionId, d]));
  /** 每一場自己的比賽長度與人數制。查不到就用呼叫端給的簡寫，兩者都沒有就丟錯 */
  const specOf = m => {
    const d = divById[m.divisionId];
    const dur = intOr(d?.matchDurationMin, durationMin);
    const pof = Number.isInteger(d?.playersOnField) ? d.playersOnField : playersOnField;
    if (!Number.isInteger(dur)) {
      throw new Error(`placeMatches：${m.matchId} 查不到比賽長度（缺 divisions 或 durationMin）`);
    }
    return { durationMin: dur, playersOnField: pof };
  };

  const busy = occupied.map(o => ({ ...o }));
  const placed = [];
  const unplaced = [];
  const slotCount = Math.max(0, Math.floor((dayEndMs - dayStartMs) / (slotMin * 60000)) + 1);
  const restMs = intOr(minRestMin, 0) * 60000;

  for (const m of sortByStructure(matches)) {
    const spec = specOf(m);
    const span = slotSpanMin(spec.durationMin, bufferMin);
    let fitted = null;

    for (let i = 0; i < slotCount && !fitted; i++) {
      const startMs = dayStartMs + i * slotMin * 60000;
      const endMs = startMs + span * 60000;
      if (startMs + spec.durationMin * 60000 > dayEndMs) break;

      // 同一隊：兩場之間要留得下休息
      const teamBusy = busy.some(o =>
        (o.teamIds || []).some(t => (m.teamIds || []).includes(t)) &&
        overlaps(startMs - restMs, endMs + restMs, o.startMs, o.endMs));
      if (teamBusy) continue;

      for (const v of venues) {
        if (!fieldFits(spec.playersOnField, v)) continue;
        const clash = busy.some(o => o.venueId === v.venueId && overlaps(startMs, endMs, o.startMs, o.endMs));
        if (clash) continue;
        fitted = { startMs, endMs, venue: v };
        break;
      }
    }

    if (!fitted) {
      unplaced.push({
        match: m,
        reason: '當天排不下（場地或時間不足）。可以增加場地、延後結束時間，或降低休息下限。'
      });
      continue;
    }

    busy.push({
      venueId: fitted.venue.venueId, startMs: fitted.startMs, endMs: fitted.endMs,
      teamIds: m.teamIds || []
    });
    placed.push({
      ...m,
      kickoffMs: fitted.startMs,
      venueId: fitted.venue.venueId,
      venueName: fitted.venue.name ?? fitted.venue.venueId
    });
  }

  return { placed, unplaced };
}

/**
 * 把某個時間點之後的場次整體順延（雨天）。
 *
 * ⚠️ **已經開打的場次不動。** 把一場正在進行的比賽往後推三十分鐘，
 *    賽務台的時鐘與這個時間就對不起來了。回傳裡會說明跳過了哪幾場。
 *
 * @returns {{updates:Array<{matchId:string, kickoffMs:number}>, skipped:Array<{matchId:string, reason:string}>}}
 */
export function shiftMatches(matches, { fromMs, deltaMin }) {
  if (!Number.isFinite(fromMs)) throw new TypeError('shiftMatches：fromMs 必須是毫秒數字');
  if (!Number.isInteger(deltaMin) || deltaMin === 0) {
    throw new RangeError('shiftMatches：deltaMin 必須是非零整數（分鐘）');
  }
  const updates = [];
  const skipped = [];
  for (const m of matches) {
    const ms = kickoffMsOf(m);
    if (ms == null || ms < fromMs) continue;
    if (!MOVABLE_STATUSES.includes(m.status)) {
      skipped.push({ matchId: m.matchId, reason: `已經是「${m.status}」，不順延` });
      continue;
    }
    updates.push({ matchId: m.matchId, kickoffMs: ms + deltaMin * 60000 });
  }
  return { updates, skipped };
}

/** 場次的開賽毫秒。相容 Firestore Timestamp、Date、數字。 */
export function kickoffMsOf(m) {
  const v = m?.kickoffMs ?? m?.kickoffAt;
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds ?? 0) / 1e6);
  return null;
}

// ══════════════════════════════════════════════════════════════════
//  場次編號
// ══════════════════════════════════════════════════════════════════

/**
 * 全賽事流水號（現場廣播用「第 31 場」）。
 *
 * ⚠️ `frozen` 的意思是「已經有場次開打了」。那時候重編號碼會讓紙本賽程表
 *    與廣播全部對不上，所以只給還沒有號碼的場次接續編下去。
 *
 * @returns {Array<{matchId:string, matchNo:number}>} 只回傳需要改的
 */
export function assignMatchNos(matches, { frozen = false } = {}) {
  const sorted = [...matches].sort((a, b) => {
    const ka = kickoffMsOf(a);
    const kb = kickoffMsOf(b);
    if (ka != null && kb != null && ka !== kb) return ka - kb;
    if (ka == null && kb != null) return 1;      // 沒排時間的排最後
    if (ka != null && kb == null) return -1;
    return String(a.matchId).localeCompare(String(b.matchId));
  });

  if (!frozen) {
    const out = [];
    sorted.forEach((m, i) => {
      if (m.matchNo !== i + 1) out.push({ matchId: m.matchId, matchNo: i + 1 });
    });
    return out;
  }

  const used = matches.map(m => m.matchNo).filter(n => Number.isInteger(n) && n > 0);
  let next = used.length ? Math.max(...used) + 1 : 1;
  const out = [];
  for (const m of sorted) {
    if (Number.isInteger(m.matchNo) && m.matchNo > 0) continue;
    out.push({ matchId: m.matchId, matchNo: next });
    next += 1;
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  衝突檢查
// ══════════════════════════════════════════════════════════════════

/**
 * 檢查一批場次排得對不對。
 *
 * ⚠️ error 與 warn 的界線跟報名審核同一條（`js/engine/review.js`）：
 *   ・`error` = 放行之後會產生**錯誤的結果**（兩場比賽同時同地、
 *     一支球隊同時出現在兩片場地、名次賽排在它的來源之前）。
 *   ・`warn`  = 提醒，主辦仍可發布。休息時間規章沒有規定，所以是 warn；
 *     系統不該替主辦訂一條規章沒有的規則。
 *
 * `matches` 要帶**當天全部組別**的場次，否則跨組別的場地衝突檢查不出來。
 *
 * @returns {{findings:Finding[], canPublish:boolean}}
 */
export function checkSchedule({
  matches = [], venues = [], divisions = [], minRestMin = 20, maxGapMin = 240
} = {}) {
  const findings = [];
  const add = (level, code, message, source, matchIds) =>
    findings.push({ level, code, message, source, matchIds: matchIds ?? [] });

  const venueById = Object.fromEntries(venues.map(v => [v.venueId, v]));
  const divById = Object.fromEntries(divisions.map(d => [d.divisionId, d]));
  const label = m => `${m.matchId}（${m.label ?? ''}）`;

  // 每一場的佔用區間
  const spans = [];
  const noSlot = [];
  for (const m of matches) {
    const start = kickoffMsOf(m);
    if (start == null || !m.venueId) { noSlot.push(m); continue; }
    const div = divById[m.divisionId] ?? {};
    const dur = intOr(div.matchDurationMin, 30);
    spans.push({ m, start, end: start + dur * 60000, playMin: dur });
  }

  if (noSlot.length) {
    add('error', 'NO_SLOT',
      `${noSlot.length} 場還沒有排定時間或場地：${briefList(noSlot.map(label))}`,
      '系統限制', noSlot.map(m => m.matchId));
  }

  // ── 場地重疊 ──
  // 只比**時間相鄰**的兩場。全配對比較會在三場以上重疊時吐出一堆重複的
  // 說法，而主辦要的是「哪兩場撞在一起」，不是排列組合。
  for (const [venueId, list] of byKeySorted(spans, s => s.m.venueId)) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (!overlaps(a.start, a.end, b.start, b.end)) continue;
      add('error', 'VENUE_OVERLAP',
        `${venueName(venueById, venueId)} 同時排了兩場：${label(a.m)} 與 ${label(b.m)}。`,
        '系統限制', [a.m.matchId, b.m.matchId]);
    }
  }

  // ── 同一隊：撞場與休息 ──
  // ⚠️ 休息與空等也**只看相鄰的兩場**。一支球隊當天打三場的話，
  //    第一場與第三場之間本來就隔很久——那不是「空等太久」，
  //    而是中間還有一場。全配對比較會把它報成警告，
  //    然後主辦看到一整頁沒有意義的黃字，就再也不看警告了。
  for (const [teamId, list] of byKeySorted(spans, s => s.m.teamIds || [])) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      if (overlaps(a.start, a.end, b.start, b.end)) {
        add('error', 'TEAM_OVERLAP',
          `${teamNameOf(a.m, teamId)} 同時要打兩場：${label(a.m)} 與 ${label(b.m)}。`,
          '系統限制', [a.m.matchId, b.m.matchId]);
        continue;
      }
      const gap = Math.round((b.start - a.end) / 60000);
      if (gap < minRestMin) {
        add('warn', 'SHORT_REST',
          `${teamNameOf(a.m, teamId)} 兩場之間只休息 ${gap} 分鐘（建議至少 ${minRestMin} 分）：${label(a.m)} 與 ${label(b.m)}。`,
          '建議', [a.m.matchId, b.m.matchId]);
      } else if (gap > maxGapMin) {
        add('warn', 'LONG_GAP',
          `${teamNameOf(a.m, teamId)} 兩場之間要等 ${Math.round((gap / 60) * 10) / 10} 小時：${label(a.m)} 與 ${label(b.m)}。`,
          '建議', [a.m.matchId, b.m.matchId]);
      }
    }
  }

  // ── 場地型態 ──
  for (const s of spans) {
    const div = divById[s.m.divisionId] ?? {};
    const v = venueById[s.m.venueId];
    if (!v) {
      add('error', 'UNKNOWN_VENUE',
        `${label(s.m)} 指到不存在的場地 ${s.m.venueId}。`, '系統限制', [s.m.matchId]);
      continue;
    }
    if (!fieldFits(div.playersOnField, v)) {
      add('error', 'FIELD_TOO_SMALL',
        `${label(s.m)} 是 ${div.playersOnField} 人制，排在 ${v.name ?? v.venueId}（${v.fieldType}）。`,
        '系統限制', [s.m.matchId]);
    }
  }

  // ── 名次賽排在來源之前 ──
  // 這一條最容易在手動改時間之後發生，而且發生了完全看不出來：
  // 冠軍賽照樣顯示「A組第1名」，只是那個名次到開賽時還不存在。
  const byKey = new Map();
  for (const s of spans) if (s.m.matchKey) byKey.set(`${s.m.divisionId}|${s.m.matchKey}`, s);
  const stageEnd = new Map();
  for (const s of spans) {
    const k = `${s.m.divisionId}|${s.m.stageId}`;
    stageEnd.set(k, Math.max(stageEnd.get(k) ?? -Infinity, s.end));
  }

  for (const s of spans) {
    for (const side of ['home', 'away']) {
      const ph = s.m[side]?.placeholder;
      if (!ph) continue;
      if (ph.type === 'standing') {
        const end = stageEnd.get(`${s.m.divisionId}|${ph.stageId}`);
        if (end != null && s.start < end) {
          add('error', 'SOURCE_AFTER',
            `${label(s.m)} 要用「${ph.groupId}組第${ph.rank}名」，但 ${ph.stageId} 還有場次排在它之後或同時。`,
            '系統限制', [s.m.matchId]);
        }
      } else if (ph.type === 'matchWinner' || ph.type === 'matchLoser') {
        const src = byKey.get(`${s.m.divisionId}|${ph.matchKey}`);
        if (src && s.start < src.end) {
          add('error', 'SOURCE_AFTER',
            `${label(s.m)} 要用 ${ph.matchKey} 的結果，但 ${ph.matchKey} 排在它之後或同時。`,
            '系統限制', [s.m.matchId, src.m.matchId]);
        }
      }
    }
  }

  const out = dedupe(findings);
  return { findings: out, canPublish: !out.some(f => f.level === 'error') };
}

/**
 * 依 key 分堆並各自依開賽時間排序。
 * `keyFn` 回傳字串或字串陣列（一場比賽有兩支球隊，兩堆都要進）。
 */
function byKeySorted(spans, keyFn) {
  const map = new Map();
  for (const s of spans) {
    const raw = keyFn(s);
    for (const k of (Array.isArray(raw) ? raw : [raw])) {
      if (k == null || k === '') continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(s);
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.start - b.start || String(a.m.matchId).localeCompare(String(b.m.matchId)));
  return map;
}

/** 場次上找得到隊名就用隊名，找不到退回 teamId——顯示空白會讓人以為紀錄壞了 */
function teamNameOf(match, teamId) {
  for (const side of ['home', 'away']) {
    if (match?.[side]?.teamId === teamId) return match[side].name || match[side].displayName || teamId;
  }
  return teamId;
}

/** 同一件事只講一次（同一組場次可能同時被兩支球隊或兩個檢查命中） */
function dedupe(findings) {
  const seen = new Set();
  return findings.filter(f => {
    const key = `${f.code}|${[...(f.matchIds ?? [])].sort().join(',')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function venueName(byId, venueId) {
  return byId[venueId]?.name ?? venueId ?? '（未指定場地）';
}

/** 最多列三個，其餘用「等 N 場」帶過——列一長串在手機上會佔滿整個畫面 */
function briefList(list) {
  return list.length <= 3 ? list.join('、') : `${list.slice(0, 3).join('、')} 等 ${list.length} 場`;
}

// CommonJS 相容（供 functions/ 以 require 使用）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCHEDULE_DEFAULTS,
    taipeiMs, drawOrder, buildGroups, pickFormatFor, genericFormat,
    teamRefOf, placeholderRefOf, buildMatches, sortByStructure,
    slotSpanMin, fieldFits, placeMatches, shiftMatches, kickoffMsOf,
    assignMatchNos, checkSchedule
  };
}
