/**
 * Cloud Functions v2｜asia-east1
 * ------------------------------------------------------------------
 * 契約：docs/07-權限安全與CloudFunctions.md §3
 *
 * 這個檔案只做三件事：接觸發器、驗權限、把參數交給 pipeline.js。
 * 任何「算分數／排名次／解晉級」的邏輯都不准寫在這裡——
 * 那些只能有一份實作，在 engine/（來源 js/engine/，R-ENG-001）。
 *
 * ⚠️ ESM：functions/package.json 是 "type": "module"。
 *    理由是 engine/ 是給瀏覽器直接載的 ES module，不可能改寫成 CJS，
 *    而 `require()` 一個 ESM 在 nodejs22 上的行為取決於 patch 版本，不能賭。
 *
 * ⚠️ engine/ 是**建置產物**（.gitignore），由 scripts/sync-engine.js 從
 *    js/engine/ 複製。改邏輯請改 js/engine/。部署時 firebase.json 的
 *    predeploy 會自動同步——因為 Firebase 只上傳 functions/ 這一個目錄。
 */
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { ensureApp, db } from './admin.js';

import {
  recalcStandingForMatch, recalcStandingsForStage, resolveDownstreamOf,
  resolveAdvancementForStage, computeFinalRankingFor, publishFinalRankingFor,
  rebuildBoardsFor, reconcileMatchScore,
  syncRosterFor, recountTeamMembers, recountUserTeams, rejectDuplicateApplication
} from './pipeline.js';
import { writeAudit } from './store.js';

ensureApp();
setGlobalOptions({ region: 'asia-east1', maxInstances: 10 });

const ok = (data) => ({ ok: true, data });
const fail = (code, message) => { throw new HttpsError(code, message); };

/**
 * 還沒實作的 callable 一律丟錯，不要回 `ok({})`。
 * 回一個空的成功就是「假成功」——呼叫端會以為事情做完了（不可協商的產品行為 #1）。
 */
const unimplemented = (name, milestone) => () =>
  fail('unimplemented', `${name} 尚未實作（預計 ${milestone}）`);

/** 每個 callable 的共通前置：驗證身分與角色 */
async function requireStaff(request, roles = []) {
  if (!request.auth) fail('unauthenticated', '請先登入');
  const snap = await db().doc(`staff/${request.auth.uid}`).get();
  const staff = snap.data();
  if (!snap.exists || staff.active !== true) fail('permission-denied', '你尚未被指派為工作人員');
  if (roles.length && !roles.some(r => staff.roles.includes(r))) fail('permission-denied', '權限不足');
  return staff;
}

const ADMIN = ['admin', 'super_admin'];

/** 結果性欄位有沒有真的變。用 JSON 比對就夠——這些都是小物件。 */
const changedAny = (before, after, keys) =>
  keys.some(k => JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null));

const DECIDED = ['finished', 'confirmed', 'walkover'];

// ══════════════════════════════════════════════════════════════
//  觸發器
// ══════════════════════════════════════════════════════════════

/**
 * 場次寫入 → 積分榜 → 晉級 → 看板。
 *
 * 只有 status / score / result 變動才動作。少了這道閘，
 * 賽務每按一次計時暫停都會把整組積分榜重算一遍。
 */
export const onMatchWritten = onDocumentWritten(
  'events/{eventId}/matches/{matchId}', async (event) => {
    const { eventId, matchId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;                                   // 刪除：沒有東西可算
    if (!changedAny(before, after, ['status', 'score', 'result'])) return;

    const match = { matchId, ...after };
    const { divisionId, stageId } = match;
    if (!divisionId || !stageId) {
      logger.warn('[onMatchWritten] 場次缺 divisionId/stageId，跳過', { matchId });
      return;
    }

    try {
      const standing = await recalcStandingForMatch({ eventId, match });
      if (standing) {
        logger.info('[onMatchWritten] 積分榜已重算', {
          standingId: standing.standingId, version: standing.version,
          changed: standing.changed, hasUnresolvedTie: standing.hasUnresolvedTie
        });

        // 名次真的動了 → 留一筆稽核給 Admin 看（docs/02 §10 / T12）。
        // 下游若已經填過人，Admin 需要知道那份晉級名單的依據已經變了。
        if (standing.changed && standing.diff) {
          await writeAudit(eventId, {
            entity: 'standing', entityId: standing.standingId, action: 'standing.rankChanged',
            after: standing.diff, reason: `${matchId} 的結果變動造成名次改變`
          });
        }
      }

      // 這一場已經有勝負，才值得去試下游與看板
      if (DECIDED.includes(after.status)) {
        const downstream = await resolveDownstreamOf({ eventId, divisionId, stageId });
        for (const d of downstream) {
          if (d.applied?.length) logger.info('[onMatchWritten] 已解算晉級', { stageId: d.stageId, applied: d.applied.length });
          else if (!d.ready) logger.debug('[onMatchWritten] 晉級尚未就緒', { stageId: d.stageId, reason: d.reason });
        }
        await rebuildBoardsFor({ eventId, divisionId });
      }
    } catch (err) {
      // 這裡**不吞例外**：吞掉的話積分榜會安靜地停在舊版，
      // 現場只會看到「怎麼沒更新」而沒有任何線索。讓它重試並留 log。
      logger.error('[onMatchWritten] 失敗', { matchId, err: err.message });
      throw err;
    }
  });

/**
 * 事件寫入 → 只做這一場的比分對帳。
 *
 * 刻意**不**在這裡重建射手榜：一顆進球就掃全組別的 timeline 太貴，
 * 而且未完賽的場次本來就不計入榜單。看板改由 onMatchWritten 在完賽時重建。
 */
export const onTimelineWritten = onDocumentWritten(
  'events/{eventId}/matches/{matchId}/timeline/{timelineId}', async (event) => {
    const { eventId, matchId } = event.params;
    const r = await reconcileMatchScore({ eventId, matchId });
    if (r.changed) {
      logger.info('[onTimelineWritten] 比分對帳結果改變', { matchId, mismatch: r.mismatch, derived: r.derived });
    }
  });

/**
 * 名單寫入 → 重複申請退件 → 公開投影 → 已核准人數。
 *
 * 公開投影是 members 唯一合法的出口（docs/01b §1.6.1）：
 * 未滿 13 歲遮蔽姓名、照片預設不公開、白名單以外的欄位一個都不帶。
 */
export const onMemberWritten = onDocumentWritten(
  'events/{eventId}/teams/{teamId}/members/{memberId}', async (event) => {
    const { eventId, teamId, memberId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    // 只有「新建立的待審申請」需要查重複。改動既有那筆不必再查一次，
    // 否則隊長按同意時又會跑一輪查詢。
    if (!before && after?.status === 'pending') {
      const rejected = await rejectDuplicateApplication({
        eventId, teamId, memberId, member: after
      });
      if (rejected) {
        logger.info('[onMemberWritten] 重複申請已退件', { teamId, memberId });
        return;                    // 退件那次寫入會再觸發一次，投影與計數交給它
      }
    }

    const r = await syncRosterFor({ eventId, teamId, memberId });
    const c = await recountTeamMembers({ eventId, teamId });
    logger.info('[onMemberWritten]', { teamId, memberId, projected: r.projected, memberCount: c.memberCount });
  });

/**
 * 球隊寫入 → 維護每個帳號的建隊數。
 *
 * 只在「建立、刪除、或換隊長」時才動作——球隊文件在報名期間會被改很多次
 * （隊名、公告、狀態），每一次都去 count 一遍球隊集合太浪費。
 */
export const onTeamWritten = onDocumentWritten(
  'events/{eventId}/teams/{teamId}', async (event) => {
    const { eventId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    const oldCap = before?.captainUid ?? null;
    const newCap = after?.captainUid ?? null;
    if (oldCap === newCap && before && after) return;   // 隊長沒變，也不是建立／刪除

    for (const uid of new Set([oldCap, newCap].filter(Boolean))) {
      const r = await recountUserTeams({ eventId, uid });
      logger.info('[onTeamWritten] 建隊數已更新', { uid, teamCount: r.teamCount });
    }
  });

export const onAttemptCreated = onDocumentCreated(
  'events/{eventId}/attempts/{attemptId}', async () => {
    // TODO(M6): best score、抽獎資格、leaderboards 重算
  });

export const onCheckinCreated = onDocumentCreated(
  'events/{eventId}/checkins/{checkinId}', async () => {
    // TODO(M6): 更新 matchSheets.checkedInCount 與 issues
  });

// ══════════════════════════════════════════════════════════════
//  Callable
// ══════════════════════════════════════════════════════════════

/** 強制重算某階段（或某小組）的積分榜 */
export const recalcStanding = onCall(async (req) => {
  await requireStaff(req, ADMIN);
  const { eventId, divisionId, stageId, groupId } = req.data || {};
  if (!eventId || !divisionId || !stageId) fail('invalid-argument', '需要 eventId / divisionId / stageId');

  const all = await recalcStandingsForStage({ eventId, divisionId, stageId });
  const rows = groupId ? all.filter(r => r?.standingId?.endsWith(`__${groupId}`)) : all;
  return ok({ standings: rows });
});

/** 解算晉級。force 只跳過「上游是否全部完賽」的閘，不會覆寫已開打的場次。 */
export const resolveAdvancement = onCall(async (req) => {
  const staff = await requireStaff(req, ADMIN);
  const { eventId, divisionId, stageId, force = false } = req.data || {};
  if (!eventId || !divisionId || !stageId) fail('invalid-argument', '需要 eventId / divisionId / stageId');

  const r = await resolveAdvancementForStage({
    eventId, divisionId, stageId, force: force === true, actorUid: req.auth.uid
  });
  logger.info('[resolveAdvancement]', { by: staff.uid ?? req.auth.uid, stageId, applied: r.applied.length });
  return ok(r);
});

export const computeFinalRanking = onCall(async (req) => {
  await requireStaff(req, ADMIN);
  const { eventId, divisionId } = req.data || {};
  if (!eventId || !divisionId) fail('invalid-argument', '需要 eventId / divisionId');
  return ok(await computeFinalRankingFor({ eventId, divisionId }));
});

export const publishFinalRanking = onCall(async (req) => {
  await requireStaff(req, ADMIN);
  const { eventId, divisionId } = req.data || {};
  if (!eventId || !divisionId) fail('invalid-argument', '需要 eventId / divisionId');
  return ok(await publishFinalRankingFor({ eventId, divisionId, actorUid: req.auth.uid }));
});

export const rebuildBoards = onCall(async (req) => {
  await requireStaff(req, ADMIN);
  const { eventId, divisionId } = req.data || {};
  if (!eventId || !divisionId) fail('invalid-argument', '需要 eventId / divisionId');
  return ok(await rebuildBoardsFor({ eventId, divisionId }));
});

// ── 尚未實作（回錯誤，不回假成功）──────────────────────────
export const lineLogin        = onCall(unimplemented('lineLogin', 'M4，需先建 LIFF Channel'));
export const issuePlayerQr    = onCall(unimplemented('issuePlayerQr', 'M6'));
export const revokePlayerQr   = onCall(unimplemented('revokePlayerQr', 'M6'));
export const verifyCheckin    = onCall(unimplemented('verifyCheckin', 'M6'));
export const generateSchedule = onCall(unimplemented('generateSchedule', 'M4'));
export const scheduleMatches  = onCall(unimplemented('scheduleMatches', 'M4'));
export const setManualRanking = onCall(unimplemented('setManualRanking', 'M4'));
export const mergePlayers     = onCall(unimplemented('mergePlayers', 'M6'));
export const exportCsv        = onCall(unimplemented('exportCsv', 'M7'));
export const exportPdf        = onCall(unimplemented('exportPdf', 'M7'));
export const sendAnnouncement = onCall(unimplemented('sendAnnouncement', 'M5'));

// ══════════════════════════════════════════════════════════════
//  排程
// ══════════════════════════════════════════════════════════════

export const refreshBoards = onSchedule('every 1 minutes', async () => {
  // TODO(M5): 保底重建 boards/live、boards/today，避免 trigger 漏掉
});

export const detectAnomalies = onSchedule('every 5 minutes', async () => {
  // TODO(M5): 掃描 docs/00 的異常規則，寫入 boards/alerts
});
