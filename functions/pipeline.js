/**
 * Functions｜結果管線
 * ------------------------------------------------------------------
 * 規格：docs/07 §3.1、docs/02 §6–§8
 *
 * 這一層把 M2 的引擎接上資料庫。分工是死的（R-ENG-001）：
 *   engine/  純函式，不碰 Firestore、不呼叫 Date.now()、不用隨機
 *   這裡     負責讀、負責填 serverTimestamp、負責寫、負責併發控制
 *
 * 併發模型：
 *   積分榜的重算放在交易裡，**場次與現有 standing 都在交易內重讀**。
 *   兩個 trigger 同時打進來時，後commit 的那個會撞到版本衝突而重試，
 *   重試會重新讀到最新的場次——所以最後落地的一定是「用最新資料算出來的」。
 *   （只用 version 比大小擋不住：兩邊都是 prev+1，先寫的反而可能資料比較新。）
 *
 *   卡片事件與隊伍資料也在交易內讀，重試時必須重新取來源，
 *   避免較慢的觸發器把舊紀律分或退賽狀態重新寫回積分榜。
 */
import { FieldValue } from 'firebase-admin/firestore';
import { DAILY_RULE, dailyStats } from './engine/challenge-days.js';
import { refreshDailyPlayer } from './challenge-days.js';

import { buildStanding, standingIdOf, isStaleWrite, diffRanking } from './engine/standing.js';
import { resolveStage, canResolve, isSlotWritable, describeTeamSource, computeFinalRanking as computeFinalRankingPure } from './engine/advancement.js';
import { computeScorers, computeFairPlayBoard, countedMatchIdsOf } from './engine/awards.js';
import { FAIR_PLAY } from './engine/ranking.js';
import { reconcileScore } from './engine/timeline.js';
import { rosterProjection } from './engine/privacy.js';
import { isPlayer } from './engine/review.js';
import { REGISTRATION_LIMITS } from './engine/formats.js';
import { normalizePhone, maskPhone, newPlayerDoc, formatPlayerId } from './engine/challenge.js';
import { createHash } from 'node:crypto';
import {
  db, evRef, loadRankingRule, loadFormat, loadDivision, loadGroups,
  loadDivisionMatches, loadStageMatchesTx, loadCardEvents, loadTeams, loadTimeline,
  teamMetaOf, withdrawnIdsOf, standingRef, loadStandings, writeAudit, adminActor,
  loadChallenge, loadChallenges, loadPlayerAttempts, loadChallengeAttempts,
  loadPlayers, loadChallengeRewards, playerRef, leaderboardRef
} from './store.js';
import {
  diffBestFlags, buildLeaderboard, drawEntries, nextCompleted, completesChallenge
} from './engine/challenge.js';

/** 已產生勝負、會被計入統計的狀態 */
const DECIDED = ['finished', 'confirmed', 'walkover'];

/** engine 要的 opts：全部從設定檔來，這裡不放任何預設值以外的判斷 */
function optsOf({ division, rule, teams, cardEvents }) {
  return {
    cardEvents,
    teamMeta: teamMetaOf(teams),
    withdrawnTeamIds: withdrawnIdsOf(teams),
    ...(division.withdrawalPolicy ? { withdrawalPolicy: division.withdrawalPolicy } : {}),
    ...(division.display?.mercyRule ? { mercyRule: division.display.mercyRule } : {}),
    ...(rule.walkover ? { walkover: rule.walkover } : {})
  };
}

// ══════════════════════════════════════════════════════════════
//  積分榜
// ══════════════════════════════════════════════════════════════

/**
 * 重算單一小組的積分榜。
 *
 * @returns {{standingId, version, hasUnresolvedTie, changed, diff, skipped?:true}}
 */
export async function recalcStandingForGroup({ eventId, divisionId, stageId, groupId, teamIds, manualPins = null, manualChange = null, actorUid = null }) {
  const standingId = standingIdOf(divisionId, stageId, groupId);
  const ref = standingRef(eventId, standingId);

  let result = null;

  await db().runTransaction(async tx => {
    const actor = await adminActor(tx, actorUid);
    const division = await loadDivision(eventId, divisionId, tx);
    const rule = await loadRankingRule(division.rankingRuleId, tx);
    const groups = await loadGroups(eventId, divisionId, stageId, tx);
    const group = groups.find(g => g.groupId === groupId);
    if (!group) throw new Error(`找不到小組設定：${divisionId}/${stageId}/${groupId}`);
    teamIds = group.teamIds || [];
    const stageMatches = await loadStageMatchesTx(tx, eventId, divisionId, stageId);
    const prevSnap = await tx.get(ref);
    const prev = prevSnap.exists ? { standingId, ...prevSnap.data() } : null;
    if (manualChange && !prev) throw new Error(`這一組還沒有積分榜可以裁定：${standingId}`);
    if (manualChange && manualPins?.some(p => !teamIds.includes(p.teamId))) throw new Error('裁定裡有不屬於這一組的隊伍');
    if (manualChange?.expectedVersion != null && prev.version !== manualChange.expectedVersion) throw Object.assign(new Error('積分榜已更新，請重新載入'), { code: 'aborted' });
    if (manualChange && (division.scheduleRevision ?? 0) !== (manualChange.expectedScheduleRevision ?? 0)) throw Object.assign(new Error('賽程已重產，請重新載入積分榜後再裁定'), { code: 'aborted' });

    const teams = await loadTeams(eventId, teamIds, tx);
    const matches = stageMatches.filter(m => m.groupId === groupId);
    const cardEvents = await loadCardEvents(eventId,
      matches.filter(m => DECIDED.includes(m.status)).map(m => m.matchId), tx);

    const doc = buildStanding({
      eventId, divisionId, stageId, groupId,
      teamIds, matches, rule,
      opts: optsOf({ division, rule, teams, cardEvents }),
      prev,
      // 有裁定就套用；沒有的話 buildStanding 會沿用 prev 裡鎖住的那幾列
      manualPins
    });

    // 交易內 prev 是最新的，version 必定是 prev+1，所以這一條理論上不會成立。
    // 留著是因為它便宜，而且真的成立時代表併發模型出了問題，會留下線索。
    if (isStaleWrite(prev, doc)) {
      // 這一層刻意只依賴 firebase-admin（不 import firebase-functions），
      // 整合測試才能直接從專案根目錄載入它跑，不必先在 functions/ 裝一次相依。
      console.warn('[standing] 放棄過時的寫入', standingId, prev?.version, '→', doc.version);
      result = { standingId, version: prev.version, hasUnresolvedTie: !!prev.hasUnresolvedTie, changed: false, diff: null, skipped: true };
      return;
    }

    const sourceHash = digest({ matches: sourceMatches(matches), teamIds, teams, cardEvents,
      rule, policy: optsOf({ division, rule, teams, cardEvents }),
      pins: manualPins ?? (prev?.rows || []).filter(r => r.locked).map(r => ({ teamId: r.teamId, rank: r.rank })) });
    if (manualChange) doc.manualOverride = { enabled: manualChange.enabled, by: actorUid,
      at: FieldValue.serverTimestamp(), reason: manualChange.reason, drawSeed: manualChange.drawSeed ?? null };
    tx.set(ref, { ...doc, sourceHash, scheduleRevision: division.scheduleRevision ?? 0,
      generationId: division.scheduleGenerationId ?? null, computedAt: FieldValue.serverTimestamp() });
    const diff = diffRanking(prev, doc);
    if (diff.changed) writeAudit(eventId, { entity: 'standing', entityId: standingId,
      action: 'standing.rankChanged', before: rankSnapshot(prev), after: rankSnapshot(doc), actor,
      reason: '依交易內最新場次、隊伍與紀律事件重算' }, tx);
    if (manualChange) writeAudit(eventId, { entity: 'standing', entityId: standingId,
      action: manualChange.enabled ? 'standing.manualRanking' : 'standing.clearManualRanking',
      before: { rows: rankSnapshot(prev), hasUnresolvedTie: prev.hasUnresolvedTie ?? null,
        version: prev.version, scheduleRevision: division.scheduleRevision ?? 0 },
      after: { pins: manualPins, drawSeed: manualChange.drawSeed ?? null,
        version: doc.version, scheduleRevision: division.scheduleRevision ?? 0 }, actor, reason: manualChange.reason }, tx);
    if (division.finalRankingPublished === true && prev?.sourceHash !== sourceHash) {
      invalidateRankingTx(tx, eventId, divisionId, division, actor, '積分來源已變更');
    }
    result = {
      standingId,
      version: doc.version,
      hasUnresolvedTie: doc.hasUnresolvedTie,
      diff: diffRanking(prev, doc),
      changed: diffRanking(prev, doc).changed
    };
  });

  return result;
}

const digest = value => createHash('sha256').update(JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)).digest('hex');
const sourceMatches = matches => [...matches].sort((a, b) => a.matchId.localeCompare(b.matchId)).map(m => ({
  matchId: m.matchId, stageId: m.stageId, groupId: m.groupId ?? null, matchKey: m.matchKey ?? null,
  status: m.status, score: m.score ?? null, result: m.result ?? null, home: m.home?.teamId ?? null,
  away: m.away?.teamId ?? null
}));

function invalidateRankingTx(tx, eventId, divisionId, division, actor, reason) {
  tx.update(evRef(eventId).collection('divisions').doc(divisionId), {
    finalRankingPublished: false, finalRankingStale: true, finalRankingInvalidatedAt: FieldValue.serverTimestamp(),
    finalRankingInvalidationReason: reason
  });
  writeAudit(eventId, { entity: 'division', entityId: divisionId, action: 'finalRanking.invalidate',
    before: { published: true, ranking: division.finalRanking ?? null }, after: { published: false }, actor, reason }, tx);
}

/** 重算某階段底下的所有小組（淘汰賽階段沒有小組，回空陣列） */
export async function recalcStandingsForStage({ eventId, divisionId, stageId }) {
  const groups = await loadGroups(eventId, divisionId, stageId);
  const out = [];
  for (const g of groups) {
    out.push(await recalcStandingForGroup({
      eventId, divisionId, stageId, groupId: g.groupId, teamIds: g.teamIds || []
    }));
  }
  return out;
}

/**
 * 某一場的結果變了 → 重算它所屬小組的積分榜。
 * 淘汰賽場次沒有 groupId，也就沒有積分榜可以算，直接回 null。
 */
export async function recalcStandingForMatch({ eventId, match }) {
  const { divisionId, stageId, groupId } = match;
  if (!divisionId || !stageId || !groupId) return null;

  const groups = await loadGroups(eventId, divisionId, stageId);
  const group = groups.find(g => g.groupId === groupId);
  // fail-closed：小組設定讀不到就不要「拿場次裡出現過的隊伍」硬湊一份名單，
  // 那會讓退賽或還沒排進來的隊伍悄悄出現／消失在積分榜上（R-ENG-005）。
  if (!group) throw new Error(`找不到小組設定：${divisionId}/${stageId}/${groupId}`);

  return recalcStandingForGroup({
    eventId, divisionId, stageId, groupId, teamIds: group.teamIds || []
  });
}

/**
 * 解算「依賴這個階段」的下游階段。
 *
 * 每一支都會先過 canResolve，前置條件不成立就原地返回，
 * 所以重放是安全的——分組賽每改一次比分都可以無腦呼叫。
 */
export async function resolveDownstreamOf({ eventId, divisionId, stageId, actorUid = null }) {
  const division = await loadDivision(eventId, divisionId);
  const format = await loadFormat(division.formatId);
  const stages = format.stages || [];

  const idx = stages.findIndex(s => s.stageId === stageId);
  const targets = stages.filter((s, i) =>
    (s.dependsOn ? s.dependsOn === stageId : i === idx + 1) && (s.slots || []).length > 0);

  const out = [];
  for (const s of targets) {
    out.push({
      stageId: s.stageId,
      ...await resolveAdvancementForStage({ eventId, divisionId, stageId: s.stageId, actorUid })
    });
  }
  return out;
}

/**
 * 事件加總 vs 登錄比分的對帳（docs/07 §3.1 onTimelineWritten）。
 *
 * 只在結論**改變**時才寫回去：無條件寫會讓 match 每次都被更新，
 * 又把 onMatchWritten 叫起來，變成兩個 trigger 互相打。
 * （onMatchWritten 只看 status/score/result，不看 scoreMismatch，所以不會成環，
 *   但白寫一次仍然是白花一次寫入。）
 */
export async function reconcileMatchScore({ eventId, matchId }) {
  const ref = evRef(eventId).collection('matches').doc(matchId);
  const snap = await ref.get();
  if (!snap.exists) return { skipped: '場次不存在' };
  const match = snap.data();

  const events = await loadTimeline(eventId, matchId);
  const r = reconcileScore(match.score, events);
  const mismatch = !r.ok;

  if (match.scoreMismatch === mismatch) return { changed: false, mismatch, derived: r.derived };

  await ref.update({ scoreMismatch: mismatch, updatedAt: FieldValue.serverTimestamp() });
  return { changed: true, mismatch, derived: r.derived, entered: r.entered };
}

// ══════════════════════════════════════════════════════════════
//  晉級解算
// ══════════════════════════════════════════════════════════════

/** 組出 advancement 需要的 ctx */
async function advancementCtx(eventId, divisionId, format, tx, division) {
  const matches = await loadDivisionMatches(eventId, divisionId, tx);
  const standings = await loadStandings(eventId, divisionId, tx);
  const groups = (await Promise.all((format.stages || []).map(st => loadGroups(eventId, divisionId, st.stageId, tx))))
    .flatMap((list, index) => list.map(g => ({ ...g, stageId: format.stages[index].stageId })));
  const teams = await loadTeams(eventId, [...new Set([...matches.flatMap(m => m.teamIds || []), ...groups.flatMap(g => g.teamIds || [])])], tx);
  const rule = groups.length ? await loadRankingRule(division.rankingRuleId, tx) : null;
  const cards = await loadCardEvents(eventId, matches.filter(m => DECIDED.includes(m.status)).map(m => m.matchId), tx);
  cards.sort((a, b) => `${a.matchId}/${a.timelineId}`.localeCompare(`${b.matchId}/${b.timelineId}`));
  // 積分 trigger 尚未送達也不會讀到舊排名：從同一交易內的權威來源即時計算。
  for (const g of groups) {
    const id = standingIdOf(divisionId, g.stageId, g.groupId);
    if (!standings[id]) continue; // 缺失仍由引擎 fail-closed
    standings[id] = buildStanding({ eventId, divisionId, stageId: g.stageId, groupId: g.groupId,
      teamIds: g.teamIds || [], matches: matches.filter(m => m.stageId === g.stageId && m.groupId === g.groupId), rule,
      prev: standings[id], opts: optsOf({ division, rule, teams, cardEvents: cards }) });
  }

  const matchesByKey = {};
  for (const m of matches) if (m.matchKey) matchesByKey[m.matchKey] = m;

  const stageMatches = {};
  for (const st of format.stages || []) {
    stageMatches[st.stageId] = matches.filter(m => m.stageId === st.stageId);
  }

  const sourceBasis = { groups, rule, format,
    withdrawalPolicy: division.withdrawalPolicy ?? null, teams: teamMetaOf(teams), withdrawn: withdrawnIdsOf(teams).sort(),
    standings: Object.values(standings).map(s => ({ id: s.standingId, rows: s.rows, unresolved: s.hasUnresolvedTie })) };
  const sourceHash = digest({ ...sourceBasis, matches: sourceMatches(matches) });
  return { divisionId, standings, matchesByKey, stageMatches, teams, matches, sourceHash, sourceBasis };
}

/**
 * 解算某個 Stage 的晉級。
 *
 * 前置條件不成立時**不寫任何東西**並回報原因（R-ENG-005）——
 * 「還沒打完就先把 A1 填進冠軍賽」比「晉級欄位空著」危險得多。
 *
 * @param {boolean} [force] Admin 明確要求時可跳過上游未完賽（仍受 manualHold / isSlotWritable 保護）
 */
export async function resolveAdvancementForStage({ eventId, divisionId, stageId, force = false, actorUid = null }) {
  return db().runTransaction(async tx => {
  const actor = await adminActor(tx, actorUid);
  const division = await loadDivision(eventId, divisionId, tx);
  const format = await loadFormat(division.formatId, tx);
  const ctx = await advancementCtx(eventId, divisionId, format, tx, division);

  const stage = (format.stages || []).find(s => s.stageId === stageId);
  if (!stage) return { ready: false, reason: `Format 沒有 stage ${stageId}`, applied: [], blocked: [] };
  // 同次解算對其他下游場次的寫入不構成新的上游衝突。
  const conflictSourceHash = digest({ ...ctx.sourceBasis, matches: sourceMatches(ctx.matches.filter(m => m.stageId !== stageId)) });

  // 解算的是「這一階段的 slots」，前置條件則是它依賴的上游階段全部打完。
  const dependsOn = stage.dependsOn || previousStageIdOf(format, stageId);
  const gate = dependsOn
    ? canResolve(format, dependsOn, ctx, { manualHold: division.manualHold === true })
    : { ready: true, reason: '' };

  if (!gate.ready && (!force || division.manualHold === true)) {
    // 上游重開後，已填入但未開打的舊名單必須失效；已開打只標示衝突。
    if (division.manualHold !== true) {
      for (const slot of stage.slots || []) {
        const target = ctx.matchesByKey[slot.matchKey];
        if (!target || !target.teamIds?.length) continue;
        const reason = `上游來源尚未就緒：${gate.reason}`;
        recordAdvancementConflict(tx, eventId, target, { reason, sourceHash: conflictSourceHash }, actor);
        if (isSlotWritable(target) && target.lock?.locked !== true) {
          const placeholder = src => ({ teamId: null, name: null, displayName: null, placeholder: describeTeamSource(src) });
          tx.update(evRef(eventId).collection('matches').doc(target.matchId), {
            home: placeholder(slot.home), away: placeholder(slot.away), teamIds: [], status: 'scheduled'
          });
        }
      }
    }
    return { ready: false, reason: gate.reason, applied: [], blocked: [] };
  }

  const { updates, blocked, notApplicable } = resolveStage(format, stageId, ctx);
  if (notApplicable) return { ready: false, reason: `${stageId} 不需要解算`, applied: [], blocked };

  const applied = [];
  // 鎖定也要阻擋，即使狀態被人工退回 scheduled。
  for (const u of updates.filter(u => !u.noop)) {
    const target = ctx.matches.find(m => m.matchId === u.matchId);
    if (target?.lock?.locked === true) { u.locked = true; blocked.push({ matchId: u.matchId, reason: '下游場次已鎖定' }); }
  }
  for (const u of updates) {
    if (u.noop) {
      const target = ctx.matches.find(m => m.matchId === u.matchId);
      if (target?.advancementConflict) {
        tx.update(evRef(eventId).collection('matches').doc(u.matchId), { advancementConflict: null });
        writeAudit(eventId, { entity: 'match', entityId: u.matchId, action: 'advancement.conflictCleared',
          before: target.advancementConflict, after: null, actor, reason: '目前晉級來源與場次一致' }, tx);
      }
    }
    if (u.noop || u.locked) continue;
    const before = ctx.matches.find(m => m.matchId === u.matchId);
    tx.update(evRef(eventId).collection('matches').doc(u.matchId), {
      ...u.patch,
      advancementConflict: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid ?? 'fn:resolveAdvancement'
    });
    writeAudit(eventId, { entity: 'match', entityId: u.matchId, action: 'advancement.resolve',
      before: { home: before.home, away: before.away, status: before.status }, after: u.patch, actor,
      reason: `${u.trace?.home ?? ''}／${u.trace?.away ?? ''}` }, tx);
    applied.push({ matchId: u.matchId, matchKey: u.matchKey, trace: u.trace });
  }
  for (const conflict of blocked) {
    const target = ctx.matches.find(m => m.matchId === conflict.matchId);
    if (target) recordAdvancementConflict(tx, eventId, target, { reason: conflict.reason, sourceHash: conflictSourceHash }, actor);
  }

  return { ready: true, reason: '', applied, blocked };
  });
}

function recordAdvancementConflict(tx, eventId, target, conflict, actor) {
  if (target.advancementConflict?.reason === conflict.reason
      && target.advancementConflict?.sourceHash === conflict.sourceHash) return;
  tx.update(evRef(eventId).collection('matches').doc(target.matchId), { advancementConflict: conflict });
  writeAudit(eventId, { entity: 'match', entityId: target.matchId, action: 'advancement.conflict',
    before: { teamIds: target.teamIds ?? [], status: target.status }, after: conflict, actor, reason: conflict.reason }, tx);
}

/** Format 的 stages 是有序的，沒寫 dependsOn 時就用前一個階段 */
function previousStageIdOf(format, stageId) {
  const list = (format.stages || []).map(s => s.stageId);
  const i = list.indexOf(stageId);
  return i > 0 ? list[i - 1] : null;
}

// ══════════════════════════════════════════════════════════════
//  最終排名
// ══════════════════════════════════════════════════════════════

export async function computeFinalRankingFor({ eventId, divisionId }) {
  return db().runTransaction(async tx => {
    const division = await loadDivision(eventId, divisionId, tx);
    const format = await loadFormat(division.formatId, tx);
    const ctx = await advancementCtx(eventId, divisionId, format, tx, division);
    return finalRankingSnapshot(format, ctx);
  });
}

function finalRankingSnapshot(format, ctx) {
  const result = computeFinalRankingPure(format, ctx);
  for (const m of ctx.matches) {
    if (!DECIDED.includes(m.status) || m.advancementConflict) result.missing.push({ rank: null, reason: `${m.matchId} 尚未完賽或晉級來源待處理` });
  }
  if (!ctx.matches.length || !(format.finalRankingMap || []).length) result.missing.push({ rank: null, reason: '缺少最終排名來源' });
  for (const st of format.stages || []) {
    if (!st.slots?.length) continue;
    const resolution = resolveStage(format, st.stageId, ctx);
    if (resolution.blocked.length || resolution.updates.some(u => !u.noop)) result.missing.push({ rank: null, reason: `${st.stageId} 晉級與目前來源不一致` });
  }
  return { ...result, complete: result.missing.length === 0, sourceHash: ctx.sourceHash };
}

/**
 * 發布最終排名到公開端。
 * **算不完整就不發布**——公開端上少一個名次，遠比掛一個錯的名次好收拾。
 */
export async function publishFinalRankingFor({ eventId, divisionId, actorUid = null }) {
  return db().runTransaction(async tx => {
  const actor = await adminActor(tx, actorUid);
  const division = await loadDivision(eventId, divisionId, tx);
  const format = await loadFormat(division.formatId, tx);
  const ctx = await advancementCtx(eventId, divisionId, format, tx, division);
  const { ranking, complete, missing, sourceHash } = finalRankingSnapshot(format, ctx);
  if (!complete) return { published: false, missing, ranking };

  const ref = evRef(eventId).collection('divisions').doc(divisionId);
  const before = division.finalRanking ?? null;
  if (division.finalRankingPublished === true && division.finalRankingSourceHash === sourceHash) return { published: true, missing: [], ranking };

  tx.update(ref, {
    finalRanking: ranking,
    finalRankingPublished: true,
    finalRankingStale: false, finalRankingSourceHash: sourceHash,
    finalRankingPublishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid ?? 'fn:publishFinalRanking'
  });
  writeAudit(eventId, {
    entity: 'division', entityId: divisionId, action: 'finalRanking.publish',
    before, after: ranking, actor, reason: '最終排名發布'
  }, tx);

  return { published: true, missing: [], ranking };
  });
}

export async function invalidateFinalRankingFor({ eventId, divisionId }) {
  return db().runTransaction(async tx => {
    const division = await loadDivision(eventId, divisionId, tx);
    if (division.finalRankingPublished !== true) return false;
    const format = await loadFormat(division.formatId, tx);
    const ctx = await advancementCtx(eventId, divisionId, format, tx, division);
    if (division.finalRankingSourceHash === ctx.sourceHash) return false;
    invalidateRankingTx(tx, eventId, divisionId, division, { uid: null, name: 'system', source: 'function' }, '結果、隊伍或晉級來源已變更，須重新覆核發布');
    return true;
  });
}

export async function refreshDivisionFor({ eventId, divisionId }) {
  const division = await loadDivision(eventId, divisionId);
  const format = await loadFormat(division.formatId);
  for (const st of format.stages || []) {
    await recalcStandingsForStage({ eventId, divisionId, stageId: st.stageId });
    if (st.slots?.length) await resolveAdvancementForStage({ eventId, divisionId, stageId: st.stageId });
  }
  await invalidateFinalRankingFor({ eventId, divisionId });
  await rebuildBoardsFor({ eventId, divisionId });
}

// ══════════════════════════════════════════════════════════════
//  獎項看板（射手榜 / 行為分）
// ══════════════════════════════════════════════════════════════

/** 每個組別在榜上最多留幾列（docs/01b §1.13「射手榜前 20」） */
const BOARD_LIMIT = 20;

/**
 * 重建射手榜與行為分排行。
 *
 * 寫入的是**單一文件** `boards/scorers`／`boards/fairplay`（docs/01b §1.13）。
 * 首頁與統計頁只監聽一份文件是規格的明確要求——每個組別各一份的話，
 * 公開端得先知道有哪些組別、再開六個監聽。
 * 這個函式一次只算一個組別，所以用交易把該組別那幾列換掉，其他組別原封不動。
 *
 * ⚠️ 球員姓名一律取自 roster 投影，不可以用 timeline 事件上的 playerName。
 *    後者是賽務端記的真名；boards/* 是 `allow read: if true`。
 *    名冊上查不到的球員寧可留 null（公開端顯示背號），也不要把真名寫上去。
 */
export async function rebuildBoardsFor({ eventId, divisionId }) {
  // 來源與看板在同一交易重讀，避免較慢的舊觸發器把已刪除的資料寫回來。
  return db().runTransaction(async tx => {
    const base = evRef(eventId);
    const [matchSnap, teamSnap, divisionSnap, ...boardSnaps] = await Promise.all([
      tx.get(base.collection('matches').where('divisionId', '==', divisionId)),
      tx.get(base.collection('teams')),
      tx.get(base.collection('divisions').doc(divisionId)),
      ...['scorers', 'fairplay'].map(boardId => tx.get(base.collection('boards').doc(boardId)))
    ]);
    const teams = Object.fromEntries(teamSnap.docs.map(d => [d.id, { ...d.data(), teamId: d.id }]));
    const matches = matchSnap.docs.map(d => ({ ...d.data(), matchId: d.id })).filter(m =>
      [m.home?.teamId, m.away?.teamId].every(id => teams[id]?.divisionId === divisionId)
      && m.home.teamId !== m.away.teamId);
    const withdrawalPolicy = divisionSnap.data()?.withdrawalPolicy;
    const counted = countedMatchIdsOf(matches, { teams, withdrawalPolicy });
    const events = [];
    const roster = {};
    const played = matches.filter(m => counted.has(m.matchId));
    const teamIds = [...new Set(played.flatMap(m => [m.home.teamId, m.away.teamId]))];
    await Promise.all([
      ...played.map(async m => {
        const snap = await tx.get(base.collection('matches').doc(m.matchId).collection('timeline'));
        for (const d of snap.docs) {
          const row = { ...d.data(), timelineId: d.id, matchId: m.matchId };
          if ([m.home.teamId, m.away.teamId].includes(row.teamId)) events.push(row);
        }
      }),
      ...teamIds.map(async teamId => {
        const snap = await tx.get(base.collection('teams').doc(teamId).collection('roster'));
        for (const d of snap.docs) roster[d.id] = { ...d.data(), teamId };
      })
    ]);
    const playerMeta = {};
    for (const e of events) {
      if (!e.playerId || playerMeta[e.playerId]) continue;
      const r = roster[e.playerId];
      playerMeta[e.playerId] = {
        name: r?.displayName ?? null,          // ← 已遮蔽的公開名，查不到就留 null
        teamId: e.teamId,
        teamName: teams[e.teamId]?.shortName ?? teams[e.teamId]?.name ?? null,
        jerseyNo: r?.jerseyNo ?? null
      };
    }
    const scorers = computeScorers(events, { countedMatchIds: counted, playerMeta })
      .slice(0, BOARD_LIMIT).map(r => ({ ...r, divisionId }));
    const fairPlay = computeFairPlayBoard({ matches, cardEvents: events, teams, withdrawalPolicy });
    for (const [i, rows] of [scorers, fairPlay].entries()) {
      const snap = boardSnaps[i];
      const boardId = snap.id;
      const ref = evRef(eventId).collection('boards').doc(boardId);
      const kept = (snap.data()?.rows || []).filter(r => r.divisionId !== divisionId
        && teams[r.teamId]?.divisionId === r.divisionId);
      tx.set(ref, {
        boardId, rows: [...kept, ...rows], updatedAt: FieldValue.serverTimestamp(),
        computedBy: 'fn:rebuildBoards',
        ...(boardId === 'fairplay' ? { scoringRules: FAIR_PLAY } : {})
      }, { merge: true });
    }
    return { scorers: scorers.length, fairPlay: fairPlay.length };
  });
}

// ══════════════════════════════════════════════════════════════
//  報名：公開投影與計數（M4，docs/10 §2）
// ══════════════════════════════════════════════════════════════

/** 年齡遮蔽的基準日：賽事第一天（見 js/engine/privacy.js 的說明） */
async function ageBasisOf(eventId, tx = null) {
  const ref = evRef(eventId);
  const ev = (await (tx ? tx.get(ref) : ref.get())).data();
  const d = ev?.dates?.[0];
  // fail-closed：讀不到日期就給一個不可能的早期日期，
  // 這樣每個人都會被算成「未滿 13 歲」而遮起來。寧可遮過頭，不可漏。
  return typeof d === 'string' ? d : '1900-01-01';
}

/**
 * `members/{id}` → `roster/{id}` 的公開投影（docs/01b §1.6.1）。
 *
 * 只有 `status === 'approved'` 的成員會出現在公開名冊；其餘（pending／
 * rejected／removed）一律把投影**刪掉**——名冊是投影，不是紀錄，
 * 留著一筆已經被移除的隊員在公開端比沒有更糟。
 * 原始的 members 文件永遠不刪（docs/10 §4）。
 */
export async function syncRosterFor({ eventId, teamId, memberId }) {
  const rosterRef = evRef(eventId).collection('teams').doc(teamId)
    .collection('roster').doc(memberId);
  return db().runTransaction(async tx => {
  const memberRef = evRef(eventId).collection('teams').doc(teamId).collection('members').doc(memberId);
  const snap = await tx.get(memberRef);

  if (!snap.exists || snap.data().status !== 'approved') {
    tx.delete(rosterRef);   // 不存在也成功；提交錯誤傳出，由 trigger 重試
    return { projected: false };
  }

  const member = { memberId, ...snap.data() };
  const team = (await tx.get(evRef(eventId).collection('teams').doc(teamId))).data();
  if (!team) {
    tx.delete(rosterRef);
    return { projected: false, skipped: '球隊不存在' };
  }

  const doc = rosterProjection(member, {
    teamId,
    divisionId: team?.divisionId ?? member.divisionId ?? null,
    asOf: await ageBasisOf(eventId, tx),
    // 照片同意目前不收（docs/10 §6 不收圖片），所以一律 null。
    // 之後要開放時，同意旗標在 members.consent 上，改這一行就好。
    photoConsent: false
  });

  tx.set(rosterRef, doc);
  return { projected: true, displayName: doc.displayName };
  });
}

/** 已核准人數（docs/10 §2.1 memberCount）。公開端拿它顯示「N 人」。 */
export async function recountTeamMembers({ eventId, teamId }) {
  return db().runTransaction(async tx => {
  const query = evRef(eventId).collection('teams').doc(teamId)
    .collection('members').where('status', '==', 'approved');
  const snap = await tx.get(query);
  const teamRef = evRef(eventId).collection('teams').doc(teamId);
  const cur = (await tx.get(teamRef)).data();
  if (!cur) return { memberCount: 0, playerCount: 0, skipped: '球隊不存在' };

  // playerCount 只數球員（規章第十二條的 15 人上限不含隊職員）。
  // firestore.rules 靠這一格擋第 16 位——rules 沒辦法 count 子集合，
  // 所以這個數字要由這裡維護，而且用的是跟審核頁同一份 isPlayer。
  const playerCount = snap.docs.filter(d => isPlayer(d.data())).length;
  if (cur.memberCount === snap.size && cur.playerCount === playerCount) {
    return { memberCount: snap.size, playerCount, changed: false };
  }

  tx.update(teamRef, { memberCount: snap.size, playerCount, updatedAt: FieldValue.serverTimestamp() });
  return { memberCount: snap.size, playerCount, changed: true };
  });
}

/**
 * 每個帳號建了幾支隊（docs/10 §2.3 maxTeamsPerAccount）。
 *
 * ⚠️ 這是**防洗版，不是權限邊界**：rules 沒辦法 count 文件，所以上限只能
 *    在這裡把關，而且擋不住「同時送出三筆」的競態。真正的閘門是主辦審核。
 */
export async function recountUserTeams({ eventId, uid }) {
  if (!uid) return { teamCount: 0, skipped: '沒有 uid' };
  const snap = await evRef(eventId).collection('teams').where('captainUid', '==', uid).get();
  await db().doc(`users/${uid}`).set({
    uid, teamCount: snap.size, teamCountAt: FieldValue.serverTimestamp()
  }, { merge: true });
  return { teamCount: snap.size };
}

/**
 * 同一個帳號對同一隊只能有一筆待審申請（docs/10 §3.3）。
 *
 * rules 查不到「有沒有另一筆 guardianUid 相同且 pending 的文件」，
 * 所以這條在這裡把關：新的那一筆直接退件，**先送的那一筆留著**。
 * 退件而不是刪除——申請人看得到自己被退了、為什麼被退。
 *
 * 家長替第二個小孩報名是合法的，所以退件的是「還沒被決定的重複申請」，
 * 不是「同一個 guardianUid 的第二筆」。
 *
 * @returns {boolean} true 代表這一筆已被退件
 */
export async function rejectDuplicateApplication({ eventId, teamId, memberId, member }) {
  const col = evRef(eventId).collection('teams').doc(teamId).collection('members');
  return db().runTransaction(async tx => {
  const current = (await tx.get(col.doc(memberId))).data();
  if (current?.status !== 'pending' || !current.guardianUid) return false;
  const guardianUid = current.guardianUid;
  // 只用單一欄位查（自動索引），status 在記憶體裡篩——一支隊的名單很小
  const snap = await tx.get(col.where('guardianUid', '==', guardianUid));
  const pending = snap.docs.filter(d => d.data().status === 'pending');
  const ms = d => {
    const v = d.data().appliedAt ?? d.data().createdAt;
    return v?.toMillis?.() ?? (typeof v === 'number' ? v : 0);
  };
  pending.sort((a, b) => (ms(a) - ms(b)) || a.id.localeCompare(b.id, 'en'));
  if (pending.length < 2 || pending[0].id === memberId) return false;

  tx.update(col.doc(memberId), {
    status: 'rejected',
    rejectReason: '這個帳號對這支球隊已經有一筆待審的申請，請等隊長處理完再送下一筆。',
    decidedAt: FieldValue.serverTimestamp(),
    decidedBy: 'fn:rejectDuplicateApplication'
  });
  writeAudit(eventId, {
    entity: 'member', entityId: `${teamId}/${memberId}`, action: 'member.duplicateRejected',
    before: { status: current.status }, after: { status: 'rejected', guardianUid, kept: pending[0].id }, reason: '同一帳號對同一隊只能有一筆待審申請（docs/10 §3.3）'
  }, tx);
  return true;
  });
}

// ══════════════════════════════════════════════════════════════
//  挑戰系統（M6，docs/06 §6.1）
// ══════════════════════════════════════════════════════════════

/** 排行榜取前幾名（docs/06 §5.3：前 50 名） */
const LEADERBOARD_TOP_N = 50;

/**
 * 一筆成績送出（或被作廢）之後要做的事。
 *
 * docs/06 §6.1 的五個步驟：
 *   ① 查該玩家該關的所有 attempt，依 rankingRule 決定 best
 *   ② 更新舊 best 的 isBest = false、新 best 的 isBest = true
 *   ③ 若首次完成該關 → completedChallengeIds += id、重算抽獎張數
 *   ④ 重算 leaderboards/{challengeId}
 *   ⑤ challenges/{id}.stats 累加
 *
 * ⚠️ **這一支必須是冪等的**：作廢一筆成績也會走同一條路（驗收 C07），
 *    而 Firestore 的觸發器本來就可能重放。所有寫入都是「算出現在該是
 *    什麼，然後寫成那樣」，沒有任何 `+1` 式的累加（stats 除外，見下）。
 *
 * ⚠️ 缺設定一律丟錯（R-ENG-005）。算錯的排行榜跟算對的長得一模一樣，
 *    現場不會有人發現。
 */
export async function onAttemptSubmitted({ eventId, challengeId, playerId }) {
  if (!eventId || !challengeId || !playerId) {
    throw new Error('onAttemptSubmitted：需要 eventId / challengeId / playerId');
  }
  const challenge = await loadChallenge(eventId, challengeId);

  // ① ② 這位玩家在這一關的最佳成績
  const flagCount = await db().runTransaction(async tx => {
    const mine = await loadPlayerAttempts(eventId, challengeId, playerId, tx);
    const flags = diffBestFlags(mine, challenge);
    for (const f of flags) {
      tx.update(evRef(eventId).collection('attempts').doc(f.attemptId), { isBest: f.isBest });
    }
    return flags.length;
  });

  // ③ 完成關卡與抽獎張數
  const completion = await syncPlayerCompletion({ eventId, challengeId, playerId, challenge });

  // ④ 排行榜
  const board = challenge.leaderboardEnabled === false ? {} : await rebuildLeaderboard({ eventId, challengeId, challenge });

  // ⑤ 關卡統計
  const stats = await recountChallengeStats({ eventId, challengeId });

  return { bestFlags: flagCount, ...completion, ...board, stats };
}

/**
 * 玩家的完成關卡與抽獎張數。
 *
 * ⚠️ **抽獎張數是算出來的，不是累加的。** `luckyDrawEntries += 1` 在觸發器
 *    重放時會多發一張，而抽獎券發出去就收不回來。這裡永遠是
 *    「依現在完成了哪幾關算出應得幾張」。
 *
 * ⚠️ 一關的成績全部被作廢時，那一關要**從完成清單移除**，張數跟著退回去
 *    （驗收 C07 的延伸）。只加不減的話，作廢之後玩家還留著那張券。
 */
async function syncPlayerCompletion({ eventId, challengeId, playerId, challenge }) {
  const ref = playerRef(eventId, playerId);
  return db().runTransaction(async tx => {
    const [rewards, all] = await Promise.all([loadChallengeRewards(tx), loadChallenges(eventId, tx)]);
    const snap = await tx.get(ref);
    const attempts = await loadPlayerAttempts(eventId, challengeId, playerId, tx);
    if (!snap.exists) {
      // 玩家不存在是資料問題，不是可以忽略的情況——但也不該讓整條管線爆掉，
      // 成績本身已經寫進去了。記一筆稽核讓主辦查得到。
      writeAudit(eventId, {
        entity: 'player', entityId: playerId, action: 'challenge.playerMissing',
        after: { challengeId }, reason: '成績指到一個不存在的玩家，抽獎張數沒有更新'
      }, tx);
      return { completedChanged: false, entries: null };
    }

    const player = snap.data();
    if (rewards?.rule === DAILY_RULE) {
      return refreshDailyPlayer(eventId, playerId, tx, all, rewards);
    }
    const hasLiveScore = attempts.some(a => completesChallenge(a, challenge));
    const cur = Array.isArray(player.completedChallengeIds) ? player.completedChallengeIds : [];

    let completed = cur;
    if (hasLiveScore) {
      completed = nextCompleted(cur, challengeId) ?? cur;
    } else if (cur.includes(challengeId)) {
      completed = cur.filter(id => id !== challengeId);      // 全部作廢 → 退回
    }

    const { entries } = drawEntries({
      completedChallengeIds: completed,
      challengeTotal: all.length,
      rewards
    });

    const ruleVersion = rewards?.rule === 'allChallengesCompleted' ? rewards.version ?? null : null;
    const changed = completed.length !== cur.length || entries !== (player.luckyDrawEntries ?? 0)
      || ruleVersion !== (player.luckyDrawRuleVersion ?? null);
    if (!changed) return { completedChanged: false, entries };

    tx.update(ref, {
      completedChallengeIds: completed,
      luckyDrawEntries: entries,
      luckyDrawRuleVersion: ruleVersion,
      lastActiveAt: FieldValue.serverTimestamp()
    });
    return { completedChanged: true, entries, completedCount: completed.length, challengeName: challenge?.name ?? null };
  });
}

/**
 * 重建一關的排行榜。
 *
 * ⚠️ `totalPlayers` 是**截斷前**的人數：玩家不在前 50 時，畫面底部仍要
 *    顯示自己那一列與真正的名次（docs/06 §5.3）。
 *
 * 用交易而不是讀-改-寫：五個攤位的成績會同時打進來。
 */
async function rebuildLeaderboard({ eventId, challengeId, challenge }) {
  const ref = leaderboardRef(eventId, challengeId);
  return db().runTransaction(async tx => {
    const attempts = await loadChallengeAttempts(eventId, challengeId, tx);
    const players = await loadPlayers(eventId, attempts.map(a => a.playerId), tx);
    const { rows, totalPlayers, ladder } = buildLeaderboard({
      attempts, challenge, players, topN: LEADERBOARD_TOP_N
    });

    const prev = (await tx.get(ref)).data();
    tx.set(ref, {
      challengeId,
      rows: rows.map(r => ({
        rank: r.rank, playerId: r.playerId, nickname: r.nickname,
        value: r.value, displayValue: r.displayValue,
        attempts: r.attempts, attemptAt: r.attemptAt
      })),
      topN: LEADERBOARD_TOP_N,
      totalPlayers,
      // 只有數字（成績與時間），沒有 ID——讓第 51 名之後的玩家也算得出
      // 自己的名次（docs/06 §5.3）。放 ID 等於公布一份完整的代號名冊。
      ladder,
      version: (prev?.version ?? 0) + 1,
      computedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    return { rows: rows.length, totalPlayers };
  });
}

/**
 * 關卡統計（docs/06 §11 的指標來源）。
 *
 * 用**重數**而不是累加：觸發器重放時 `+1` 會虛胖，而這個數字會出現在
 * 活動後的成效報告裡。attempts 一關幾百筆，重數的成本可以忽略。
 */
async function recountChallengeStats({ eventId, challengeId }) {
  return db().runTransaction(async tx => {
    const [challenge, rewards] = await Promise.all([
      tx.get(evRef(eventId).collection('challenges').doc(challengeId)), loadChallengeRewards(tx)
    ]);
    const attempts = await loadChallengeAttempts(eventId, challengeId, tx);
    const live = attempts.filter(a => a?.voided !== true);
    const stats = {
      attempts: live.length,
      players: new Set(live.map(a => a.playerId).filter(Boolean)).size,
      voided: attempts.length - live.length
    };
    if (rewards?.rule === DAILY_RULE) stats.dailyPlayers = dailyStats(attempts, challenge.data(), rewards.dates, rewards.timeZone);
    tx.set(evRef(eventId).collection('challenges').doc(challengeId),
      { stats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return stats;
  });
}

/**
 * 一位玩家的完整進度（`#/challenge/me` 與抽獎名單匯出都用這一支）。
 * 純讀取，不寫。
 */
export async function playerProgress({ eventId, playerId }) {
  const [snap, challenges, rewards] = await Promise.all([
    playerRef(eventId, playerId).get(),
    loadChallenges(eventId),
    loadChallengeRewards()
  ]);
  if (!snap.exists) return null;
  const player = { playerId, ...snap.data() };
  const completed = Array.isArray(player.completedChallengeIds) ? player.completedChallengeIds : [];
  return {
    player,
    challengeTotal: challenges.length,
    completedCount: completed.length,
    draw: drawEntries({ completedChallengeIds: completed, challengeTotal: challenges.length, rewards })
  };
}

// ══════════════════════════════════════════════════════════════
//  人工裁定同分（docs/05 §7.2；競賽規章第十九條第 5 順位）
// ══════════════════════════════════════════════════════════════

/**
 * 主辦裁定同分的名次。
 *
 * ⭐ **這是「完全同分」唯一的出口。** 規章第十九條把抽籤列為第 5 順位，
 *    而引擎依 R-ENG-004 不會自己擲骰子——它只標 `hasUnresolvedTie` 等人回填。
 *    在這一支出現之前，兩隊每一項條件都相同時：
 *      `hasUnresolvedTie: true` → `explainTeamSource` 回 miss
 *      → 晉級永遠解不開 → 冠軍賽的隊伍永遠是「A組第1名」
 *      → 最終排名算不出來 → **整個組別打不完**。
 *
 * ⚠️ 名次由 `buildStanding` 重算一次（帶 manualPins），**不是**直接改 rows：
 *    直接改的話，rows 上的統計數字與 `version` 會跟管線分岔，
 *    而下一次 `onMatchWritten` 重算就把裁定沖掉了。
 *
 * ⚠️ `reason` 必填。規章寫的是抽籤，但實際是誰、依什麼、在什麼時候決定的，
 *    只有稽核紀錄留得住——申訴時要拿得出來。
 *
 * @param {object} o
 * @param {Array<{teamId:string, rank:number}>} o.pins 裁定後的名次
 * @param {string} o.reason 必填
 * @param {number|null} [o.drawSeed] 用抽籤決定時的亂數種子（要能重放）
 */
export async function setManualRankingFor({
  eventId, divisionId, stageId, groupId, pins, reason, actorUid = null, drawSeed = null, expectedVersion = null, expectedScheduleRevision = 0
}) {
  if (!eventId || !divisionId || !stageId || !groupId) throw new Error('需要 eventId / divisionId / stageId / groupId');
  if (!Array.isArray(pins) || !pins.length) throw new Error('需要至少一筆裁定名次');
  if (!String(reason ?? '').trim()) throw new Error('裁定一定要填原因');
  if (pins.some(p => !Number.isInteger(p.rank) || p.rank < 1)
      || new Set(pins.map(p => p.rank)).size !== pins.length
      || new Set(pins.map(p => p.teamId)).size !== pins.length) throw new Error('同一個名次被指派給兩隊或名次不正確');
  const result = await recalcStandingForGroup({ eventId, divisionId, stageId, groupId, manualPins: pins, actorUid,
    manualChange: { enabled: true, reason: String(reason).trim().slice(0, 500), drawSeed, expectedVersion, expectedScheduleRevision } });
  const downstream = await resolveDownstreamOf({ eventId, divisionId, stageId, actorUid });
  return { ...result, downstream };
}

export async function clearManualRankingFor({ eventId, divisionId, stageId, groupId, reason, actorUid = null, expectedVersion = null, expectedScheduleRevision = 0 }) {
  if (!String(reason ?? '').trim()) throw new Error('解除裁定一定要填原因');
  const result = await recalcStandingForGroup({ eventId, divisionId, stageId, groupId, manualPins: [], actorUid,
    manualChange: { enabled: false, reason: String(reason).trim().slice(0, 500), expectedVersion, expectedScheduleRevision } });
  const downstream = await resolveDownstreamOf({ eventId, divisionId, stageId, actorUid });
  return { ...result, downstream };
}

function rankSnapshot(standing) {
  return (standing?.rows || []).map(r => ({ teamId: r.teamId, rank: r.rank, locked: r.locked === true }));
}

// ══════════════════════════════════════════════════════════════
//  規章第十二條：球員最多 15 人（伺服器端強制）
// ══════════════════════════════════════════════════════════════

/**
 * 一般報名球員最多 15 人——超過的那幾筆退件；管理員 CSV 匯入名冊除外。
 *
 * rules 用 `teams.playerCount < 15` 擋在前面，但那個數字是這裡**事後**維護的：
 * 兩位教練同一秒各加一人，兩筆都會過。所以這裡是權威：已核准的球員
 * 依核准時間排序，第 16 位起一律退件，晚核准的先退。
 *
 * ⚠️ 上限來自 `REGISTRATION_LIMITS.maxPlayers`（規章的權威在 formats.js），
 *    這裡不寫 15。
 *
 * @returns {Promise<{rejected:string[]}>}
 */
export async function enforceRosterCap({ eventId, teamId, maxPlayers = REGISTRATION_LIMITS.maxPlayers }) {
  const col = evRef(eventId).collection('teams').doc(teamId).collection('members');
  return db().runTransaction(async tx => {
  const snap = await tx.get(col.where('status', '==', 'approved'));
  const teamRef = evRef(eventId).collection('teams').doc(teamId);
  const team = await tx.get(teamRef);
  // CSV 匯入由 Admin SDK 建立無帳號隊長且鎖定的名冊。
  // 一般客戶端建立球隊必須以自己為隊長且未鎖定；隊長能在草稿期轉移帳號，
  // 但不能自行修改來源或鎖定名冊，因此豁免必須同時檢查以下三項。
  const imported = team.data();
  if (imported?.source === 'csv' && imported.captainUid === null && imported.rosterLocked === true) return { rejected: [] };
  const players = snap.docs.filter(d => isPlayer(d.data()));
  if (players.length <= maxPlayers) return { rejected: [] };

  const ms = v => (v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0));
  // 早核准的留下，晚的退——排序穩定（同時間依 id），重跑結果一樣
  players.sort((a, b) =>
    (ms(a.data().decidedAt) - ms(b.data().decidedAt)) || a.id.localeCompare(b.id));
  const extra = players.slice(maxPlayers);

  for (const d of extra) {
    tx.update(d.ref, {
      status: 'rejected',
      rejectReason: `球員最多 ${maxPlayers} 人（競賽規章第十二條）。這一筆是第 ${maxPlayers + 1} 位之後才核准的，已自動退回。`,
      decidedAt: FieldValue.serverTimestamp(),
      decidedBy: 'fn:rosterCap'
    });
    tx.delete(teamRef.collection('roster').doc(d.id));
  }
  if (team.exists) tx.update(teamRef, { memberCount: snap.size - extra.length, playerCount: players.length - extra.length });
  writeAudit(eventId, {
    entity: 'team', entityId: teamId, action: 'member.capRejected',
    after: { maxPlayers, rejected: extra.map(d => d.id) },
    reason: `球員超過 ${maxPlayers} 人上限（規章第十二條）`
  }, tx);
  return { rejected: extra.map(d => d.id) };
  });
}

/**
 * 抽獎中獎的聯絡方式（docs/06 §7.2）。
 *
 * `players` 文件任何人都讀得到、代號空間只有一萬組——電話不能放在那裡，
 * 也不能讓「知道代號的人」就改得動。所以：
 *   ・建卡時客戶端產生一組隨機憑證，只把 sha256 存進 players.contactKeyHash
 *   ・填聯絡方式要把憑證本體送來，這裡算雜湊比對；對得上才寫
 *   ・電話寫進 `playerContacts/{playerId}`（只有管理員讀得到，匯出抽獎名單時合併）
 * 攤位代建的卡沒有憑證，只能到攤位登記（畫面會這樣說）。
 */
/**
 * 配發挑戰卡（綁 LINE 帳號；主辦 2026-09-06 決定：不讓玩家自己生成）。
 *
 * 一個 LINE 帳號一張卡：users/{uid}.gamePassId ↔ players/{id}。同一個人再叫一次拿到同一張，
 * 帳號指到的卡若已不存在就重配。代號在交易內配（隨機四位數，撞到就換）——
 * 隨機留在這裡而不進引擎（R-ENG-004）。users 是私密文件，公開的 players 上**不放 uid**
 * （代號空間只有一萬組、掃得完，放了等於公布一份 LINE uid 名冊）。
 *
 * @returns {Promise<{playerId:string, nickname:string|null, created:boolean}>}
 */
export async function issueGamePassFor({ eventId, uid, displayName = null }) {
  if (!eventId || !uid) throw new Error('需要 eventId 與登入身分');
  const fsdb = playerRef(eventId, 'FEDA-0000').firestore;
  const userRef = fsdb.doc(`users/${uid}`);
  return fsdb.runTransaction(async tx => {
    const userSnap = await tx.get(userRef);
    const existing = userSnap.exists ? userSnap.data().gamePassId : null;
    if (existing) {
      const p = await tx.get(playerRef(eventId, existing));
      if (p.exists) return { playerId: existing, nickname: p.data().nickname ?? null, created: false };
    }
    // 交易裡的讀要全部在寫之前：先把候選代號查完再寫
    let playerId = null;
    for (let i = 0; i < 12 && !playerId; i++) {
      const cand = formatPlayerId(Math.floor(Math.random() * 10000));
      const s = await tx.get(playerRef(eventId, cand));
      if (!s.exists) playerId = cand;
    }
    if (!playerId) throw new Error('配號失敗，請再試一次');
    const name = String(userSnap.data()?.displayName ?? displayName ?? '').trim().slice(0, 12) || '玩家';
    tx.set(playerRef(eventId, playerId), {
      ...newPlayerDoc({ playerId, eventId, nickname: name, ageBand: null, createdVia: 'line' }),
      createdAt: FieldValue.serverTimestamp(),
      lastActiveAt: FieldValue.serverTimestamp()
    });
    tx.set(userRef, { uid, gamePassId: playerId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { playerId, nickname: name, created: true };
  });
}

export async function setPlayerContactFor({ eventId, playerId, key, phone, staffUid = null, ownerUid = null }) {
  const id = String(playerId ?? '').trim().toUpperCase();
  if (!/^FEDA-\d{4}$/.test(id)) throw new Error('代號格式不對');
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('手機號碼要是 09 開頭的 10 碼');

  const snap = await playerRef(eventId, id).get();
  if (!snap.exists) throw new Error('查無此代號');

  // 攤位工作人員（已登入、有 booth 以上身分，由 callable 驗過）可以替玩家登記——
  // 攤位代建的卡沒有憑證，只有這條路。留下是誰登記的。
  if (!staffUid && ownerUid) {
    // 用 LINE 登入的卡主（主辦 2026-09-06 起的配發方式）：users/{uid}.gamePassId 要指到這一張
    const u = await playerRef(eventId, id).firestore.doc(`users/${ownerUid}`).get();
    if (!u.exists || u.data().gamePassId !== id) throw new Error('這張卡不是你的：請用領卡時的 LINE 帳號登入');
  } else if (!staffUid) {
    const k = String(key ?? '');
    if (k.length < 16) throw new Error('這支手機上沒有這張卡的憑證');
    const hash = snap.data()?.contactKeyHash;
    if (!hash) throw new Error('這張卡是攤位代建的，請到攤位登記聯絡方式');
    if (createHash('sha256').update(k).digest('hex') !== hash) {
      throw new Error('憑證不符：這張卡不是在這支手機上建立的');
    }
  }

  await evRef(eventId).collection('playerContacts').doc(id).set({
    playerId: id, eventId, phone: normalized,
    via: staffUid ? 'booth' : 'self', byUid: staffUid ?? ownerUid ?? null,
    updatedAt: FieldValue.serverTimestamp()
  });
  return { playerId: id, maskedPhone: maskPhone(normalized) };
}
