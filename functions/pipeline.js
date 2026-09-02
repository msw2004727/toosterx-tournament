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
 *   卡片事件與隊伍資料在交易外讀。卡片只影響同分排序的末端條件，
 *   而且新增一張牌本身也會觸發 onTimelineWritten 再算一次，
 *   把它們放進交易只會把交易撐大，換不到正確性。
 */
import { FieldValue } from 'firebase-admin/firestore';

import { buildStanding, standingIdOf, isStaleWrite, diffRanking } from './engine/standing.js';
import { resolveStage, canResolve, computeFinalRanking as computeFinalRankingPure } from './engine/advancement.js';
import { computeScorers, computeFairPlayBoard, countedMatchIdsOf } from './engine/awards.js';
import { reconcileScore } from './engine/timeline.js';
import { rosterProjection } from './engine/privacy.js';
import {
  db, evRef, loadRankingRule, loadFormat, loadDivision, loadGroups,
  loadDivisionMatches, loadStageMatchesTx, loadCardEvents, loadTeams, loadTimeline,
  loadRosters, teamMetaOf, withdrawnIdsOf, standingRef, loadStandings, writeAudit
} from './store.js';

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
export async function recalcStandingForGroup({ eventId, divisionId, stageId, groupId, teamIds }) {
  const division = await loadDivision(eventId, divisionId);
  const rule = await loadRankingRule(division.rankingRuleId);

  const teams = await loadTeams(eventId, teamIds);
  const standingId = standingIdOf(divisionId, stageId, groupId);
  const ref = standingRef(eventId, standingId);

  // 卡片要先知道有哪些場次。交易外先抓一次「這個階段目前的場次」來取 matchId，
  // 交易裡再重讀一次場次本身——卡片多讀或少讀一場不影響正確性（見檔頭）。
  const preMatches = (await evRef(eventId).collection('matches')
    .where('divisionId', '==', divisionId).where('stageId', '==', stageId).get())
    .docs.map(d => ({ matchId: d.id, ...d.data() }));
  const groupMatchIds = preMatches
    .filter(m => m.groupId === groupId && DECIDED.includes(m.status))
    .map(m => m.matchId);
  const cardEvents = await loadCardEvents(eventId, groupMatchIds);

  let result = null;

  await db().runTransaction(async tx => {
    const stageMatches = await loadStageMatchesTx(tx, eventId, divisionId, stageId);
    const prevSnap = await tx.get(ref);
    const prev = prevSnap.exists ? { standingId, ...prevSnap.data() } : null;

    const matches = stageMatches.filter(m => m.groupId === groupId);

    const doc = buildStanding({
      eventId, divisionId, stageId, groupId,
      teamIds, matches, rule,
      opts: optsOf({ division, rule, teams, cardEvents }),
      prev
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

    tx.set(ref, { ...doc, computedAt: FieldValue.serverTimestamp() });
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
async function advancementCtx(eventId, divisionId, format) {
  const matches = await loadDivisionMatches(eventId, divisionId);
  const standings = await loadStandings(eventId, divisionId);
  const teams = await loadTeams(eventId, [...new Set(matches.flatMap(m => m.teamIds || []))]);

  const matchesByKey = {};
  for (const m of matches) if (m.matchKey) matchesByKey[m.matchKey] = m;

  const stageMatches = {};
  for (const st of format.stages || []) {
    stageMatches[st.stageId] = matches.filter(m => m.stageId === st.stageId);
  }

  return { divisionId, standings, matchesByKey, stageMatches, teams, matches };
}

/**
 * 解算某個 Stage 的晉級。
 *
 * 前置條件不成立時**不寫任何東西**並回報原因（R-ENG-005）——
 * 「還沒打完就先把 A1 填進冠軍賽」比「晉級欄位空著」危險得多。
 *
 * @param {boolean} [force] Admin 明確要求時可跳過 canResolve（仍受 isSlotWritable 保護）
 */
export async function resolveAdvancementForStage({ eventId, divisionId, stageId, force = false, actorUid = null }) {
  const division = await loadDivision(eventId, divisionId);
  const format = await loadFormat(division.formatId);
  const ctx = await advancementCtx(eventId, divisionId, format);

  const stage = (format.stages || []).find(s => s.stageId === stageId);
  if (!stage) return { ready: false, reason: `Format 沒有 stage ${stageId}`, applied: [], blocked: [] };

  // 解算的是「這一階段的 slots」，前置條件則是它依賴的上游階段全部打完。
  const dependsOn = stage.dependsOn || previousStageIdOf(format, stageId);
  const gate = dependsOn
    ? canResolve(format, dependsOn, ctx, { manualHold: division.manualHold === true })
    : { ready: true, reason: '' };

  if (!gate.ready && !force) {
    return { ready: false, reason: gate.reason, applied: [], blocked: [] };
  }

  const { updates, blocked, notApplicable } = resolveStage(format, stageId, ctx);
  if (notApplicable) return { ready: false, reason: `${stageId} 不需要解算`, applied: [], blocked };

  const applied = [];
  const batch = db().batch();
  for (const u of updates) {
    if (u.noop) continue;
    batch.update(evRef(eventId).collection('matches').doc(u.matchId), {
      ...u.patch,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorUid ?? 'fn:resolveAdvancement'
    });
    applied.push({ matchId: u.matchId, matchKey: u.matchKey, trace: u.trace });
  }
  if (applied.length) await batch.commit();

  for (const a of applied) {
    await writeAudit(eventId, {
      entity: 'match', entityId: a.matchId, action: 'advancement.resolve',
      after: { matchKey: a.matchKey }, reason: `${a.trace?.home ?? ''}／${a.trace?.away ?? ''}`
    });
  }

  return { ready: true, reason: '', applied, blocked };
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
  const division = await loadDivision(eventId, divisionId);
  const format = await loadFormat(division.formatId);
  const ctx = await advancementCtx(eventId, divisionId, format);
  return computeFinalRankingPure(format, ctx);
}

/**
 * 發布最終排名到公開端。
 * **算不完整就不發布**——公開端上少一個名次，遠比掛一個錯的名次好收拾。
 */
export async function publishFinalRankingFor({ eventId, divisionId, actorUid = null }) {
  const { ranking, complete, missing } = await computeFinalRankingFor({ eventId, divisionId });
  if (!complete) return { published: false, missing, ranking };

  const ref = evRef(eventId).collection('divisions').doc(divisionId);
  const before = (await ref.get()).data()?.finalRanking ?? null;

  await ref.update({
    finalRanking: ranking,
    finalRankingPublished: true,
    finalRankingPublishedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actorUid ?? 'fn:publishFinalRanking'
  });
  await writeAudit(eventId, {
    entity: 'division', entityId: divisionId, action: 'finalRanking.publish',
    before, after: ranking, reason: '最終排名發布'
  });

  return { published: true, missing: [], ranking };
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
  const matches = await loadDivisionMatches(eventId, divisionId);

  // 「哪些場次算數」只認引擎這一份判定（countedMatchIdsOf）。
  // 這裡本來在外層另外用 DECIDED 篩了一次——兩層一模一樣的過濾會互相遮蔽，
  // 單獨改壞任何一層測試都抓不到（變異 FN#7 就是這樣逃掉的）。
  // 現在同一個 Set 同時決定「要讀哪些 timeline」與「哪些進得了榜」。
  const counted = countedMatchIdsOf(matches);

  const events = [];
  await Promise.all(matches.filter(m => counted.has(m.matchId)).map(async m => {
    const snap = await evRef(eventId).collection('matches').doc(m.matchId)
      .collection('timeline').get();
    for (const d of snap.docs) events.push({ timelineId: d.id, ...d.data() });
  }));

  const teamIds = [...new Set(matches.flatMap(m => m.teamIds || []))];
  const teams = await loadTeams(eventId, teamIds);
  const roster = await loadRosters(eventId, teamIds);

  const playerMeta = {};
  for (const e of events) {
    if (!e.playerId || playerMeta[e.playerId]) continue;
    const r = roster[e.playerId];
    playerMeta[e.playerId] = {
      name: r?.displayName ?? null,          // ← 已遮蔽的公開名，查不到就留 null
      teamId: r?.teamId ?? e.teamId ?? null,
      teamName: teams[r?.teamId ?? e.teamId]?.shortName ?? teams[r?.teamId ?? e.teamId]?.name ?? null,
      jerseyNo: r?.jerseyNo ?? null
    };
  }

  const scorers = computeScorers(events, { countedMatchIds: counted, playerMeta })
    .slice(0, BOARD_LIMIT)
    .map(r => ({ ...r, divisionId }));

  const standings = Object.values(await loadStandings(eventId, divisionId));
  const fairPlay = computeFairPlayBoard(standings).slice(0, BOARD_LIMIT);

  await Promise.all([
    replaceDivisionRows(eventId, 'scorers', divisionId, scorers),
    replaceDivisionRows(eventId, 'fairplay', divisionId, fairPlay)
  ]);

  return { scorers: scorers.length, fairPlay: fairPlay.length };
}

/**
 * 把單一看板文件裡「屬於這個組別」的列換成新的，其他組別保持不動。
 * 用交易而不是讀-改-寫：六個組別的完賽事件會同時打進來。
 */
async function replaceDivisionRows(eventId, boardId, divisionId, rows) {
  const ref = evRef(eventId).collection('boards').doc(boardId);
  await db().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const kept = (snap.data()?.rows || []).filter(r => r.divisionId !== divisionId);
    tx.set(ref, {
      boardId,
      rows: [...kept, ...rows],
      updatedAt: FieldValue.serverTimestamp(),
      computedBy: 'fn:rebuildBoards'
    }, { merge: true });
  });
}

// ══════════════════════════════════════════════════════════════
//  報名：公開投影與計數（M4，docs/10 §2）
// ══════════════════════════════════════════════════════════════

/** 年齡遮蔽的基準日：賽事第一天（見 js/engine/privacy.js 的說明） */
async function ageBasisOf(eventId) {
  const ev = (await evRef(eventId).get()).data();
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
  const snap = await evRef(eventId).collection('teams').doc(teamId)
    .collection('members').doc(memberId).get();

  if (!snap.exists || snap.data().status !== 'approved') {
    await rosterRef.delete().catch(() => {});   // 本來就沒有也算成功
    return { projected: false };
  }

  const member = { memberId, ...snap.data() };
  const team = (await evRef(eventId).collection('teams').doc(teamId).get()).data();

  const doc = rosterProjection(member, {
    teamId,
    divisionId: team?.divisionId ?? member.divisionId ?? null,
    asOf: await ageBasisOf(eventId),
    // 照片同意目前不收（docs/10 §6 不收圖片），所以一律 null。
    // 之後要開放時，同意旗標在 members.consent 上，改這一行就好。
    photoConsent: false
  });

  await rosterRef.set(doc);
  return { projected: true, displayName: doc.displayName };
}

/** 已核准人數（docs/10 §2.1 memberCount）。公開端拿它顯示「N 人」。 */
export async function recountTeamMembers({ eventId, teamId }) {
  const snap = await evRef(eventId).collection('teams').doc(teamId)
    .collection('members').where('status', '==', 'approved').get();
  const teamRef = evRef(eventId).collection('teams').doc(teamId);
  const cur = (await teamRef.get()).data();
  if (!cur) return { memberCount: 0, skipped: '球隊不存在' };
  if (cur.memberCount === snap.size) return { memberCount: snap.size, changed: false };

  await teamRef.update({ memberCount: snap.size, updatedAt: FieldValue.serverTimestamp() });
  return { memberCount: snap.size, changed: true };
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
  const guardianUid = member?.guardianUid;
  if (!guardianUid) return false;

  const col = evRef(eventId).collection('teams').doc(teamId).collection('members');
  // 只用單一欄位查（自動索引），status 在記憶體裡篩——一支隊的名單很小
  const snap = await col.where('guardianUid', '==', guardianUid).get();
  const others = snap.docs
    .filter(d => d.id !== memberId && d.data().status === 'pending');
  if (!others.length) return false;

  await col.doc(memberId).update({
    status: 'rejected',
    rejectReason: '這個帳號對這支球隊已經有一筆待審的申請，請等隊長處理完再送下一筆。',
    decidedAt: FieldValue.serverTimestamp(),
    decidedBy: 'fn:rejectDuplicateApplication'
  });
  await writeAudit(eventId, {
    entity: 'member', entityId: `${teamId}/${memberId}`, action: 'member.duplicateRejected',
    after: { guardianUid }, reason: '同一帳號對同一隊只能有一筆待審申請（docs/10 §3.3）'
  });
  return true;
}
