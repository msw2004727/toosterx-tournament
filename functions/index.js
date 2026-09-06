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
import { ensureApp, db } from './admin.js';

import {
  recalcStandingForMatch, recalcStandingsForStage, resolveDownstreamOf,
  resolveAdvancementForStage, computeFinalRankingFor, publishFinalRankingFor,
  rebuildBoardsFor, reconcileMatchScore,
  syncRosterFor, recountTeamMembers, recountUserTeams, rejectDuplicateApplication,
  rejectCrossTeamDuplicate, enforceRosterCap,
  onAttemptSubmitted, setManualRankingFor, clearManualRankingFor
} from './pipeline.js';
import { setPlayerContactFor, issueGamePassFor } from './pipeline.js';
import { writeAudit } from './store.js';
import { loginWithLine } from './line.js';

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
// 賽務角色向上包含（R-ROLE-002）：攤位以上都做得了攤位的事
const BOOTH = ['booth', 'checkin', 'referee', 'scorer', 'admin', 'super_admin'];

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

    // 只有「新建立的那一筆」需要查重複。改動既有那筆不必再查一次，
    // 否則隊長按同意時又會跑一輪查詢（退件那次寫入也是 update，不會成環）。
    if (!before && after?.status === 'pending') {
      const rejected = await rejectDuplicateApplication({
        eventId, teamId, memberId, member: after
      });
      if (rejected) {
        logger.info('[onMemberWritten] 重複申請已退件', { teamId, memberId });
        return;                    // 退件那次寫入會再觸發一次，投影與計數交給它
      }
    }
    // 每人限報乙隊（規章第十二條）：待審或已核准的新成員都要跨隊查一次。
    // 教練直接新增的學童（status 一開始就是 approved）也在這裡被擋。
    if (!before && after && ['pending', 'approved'].includes(after.status)) {
      const cross = await rejectCrossTeamDuplicate({ eventId, teamId, memberId, member: after });
      if (cross) {
        logger.info('[onMemberWritten] 跨隊重複已退件', { teamId, memberId, otherTeamId: cross.otherTeamId });
        return;
      }
    }

    const r = await syncRosterFor({ eventId, teamId, memberId });
    const c = await recountTeamMembers({ eventId, teamId });
    logger.info('[onMemberWritten]', { teamId, memberId, projected: r.projected, memberCount: c.memberCount, playerCount: c.playerCount });

    // 球員最多 15 人（規章第十二條）。rules 用 playerCount 擋在前面，
    // 但那個數字是上面才剛算好的——兩位教練同一秒各加一人時兩筆都會過，
    // 所以這裡才是權威：超過的那幾筆退件。
    if (after?.status === 'approved') {
      const cap = await enforceRosterCap({ eventId, teamId });
      if (cap.rejected.length) logger.warn('[onMemberWritten] 超過球員上限，已退件', { teamId, rejected: cap.rejected });
    }
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

/**
 * 挑戰成績寫入 → 最佳成績 → 抽獎張數 → 排行榜 → 關卡統計（docs/06 §6.1）。
 *
 * ⚠️ 用 `onDocumentWritten` 而不是 `onDocumentCreated`：**作廢也要重算**
 *    （驗收 C07：作廢一筆最佳成績，排行榜與 best 要自動退回次佳），
 *    而作廢是 update 不是 create。只接 create 的話，被作廢的成績會
 *    永遠留在榜首——而且畫面上看起來完全正常。
 *
 * ⚠️ 管線自己會把 `isBest` 寫回 attempts，那又會再觸發這一支。
 *    只有「會影響結果的欄位」變了才往下走，不然兩次寫入互相打不完。
 */
export const onAttemptWritten = onDocumentWritten(
  'events/{eventId}/attempts/{attemptId}', async (event) => {
    const { eventId } = event.params;
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const doc = after ?? before;
    if (!doc?.challengeId || !doc?.playerId) return;

    // isBest 是這條管線自己寫回去的，不能拿它當重算的理由
    if (before && after
        && before.rawValue === after.rawValue
        && before.voided === after.voided) return;

    const r = await onAttemptSubmitted({
      eventId, challengeId: doc.challengeId, playerId: doc.playerId
    });
    logger.info('[onAttemptWritten] 挑戰成績已處理', {
      challengeId: doc.challengeId, playerId: doc.playerId,
      bestFlags: r.bestFlags, rows: r.rows, entries: r.entries
    });
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

/**
 * 人工裁定同分（競賽規章第十九條第 5 順位：抽籤）。
 *
 * ⚠️ **一定要走 Function，不可以讓前端直接寫 `standings/`。**
 *    名次要由 `buildStanding` 重算一次，而重算需要 `rankingRule`、`cardEvents`、
 *    `withdrawnTeamIds`、`mercyRule`——前端自己拼一份 opts，遲早會跟管線分岔，
 *    而分岔的症狀是「積分榜的數字對不上」，不會有任何錯誤訊息。
 *
 * `pins` 是 `[{teamId, rank}]`；`clear: true` 則是解除裁定。
 */
export const setManualRanking = onCall(async (req) => {
  await requireStaff(req, ADMIN);
  const { eventId, divisionId, stageId, groupId, pins, reason, drawSeed = null, clear = false } = req.data || {};
  if (!eventId || !divisionId || !stageId || !groupId) {
    fail('invalid-argument', '需要 eventId / divisionId / stageId / groupId');
  }
  try {
    if (clear === true) {
      return ok(await clearManualRankingFor({
        eventId, divisionId, stageId, groupId, reason, actorUid: req.auth.uid
      }));
    }
    const r = await setManualRankingFor({
      eventId, divisionId, stageId, groupId, pins, reason,
      drawSeed: Number.isInteger(drawSeed) ? drawSeed : null,
      actorUid: req.auth.uid
    });
    logger.info('[setManualRanking]', { by: req.auth.uid, standingId: r.standingId, drawSeed });
    return ok(r);
  } catch (err) {
    // 參數錯誤要回 invalid-argument 而不是 internal——前端的錯誤翻譯靠 code 分流，
    // 一律 internal 的話「名次重複」會顯示成「系統發生錯誤」。
    fail('invalid-argument', err.message);
  }
});

// ── 尚未實作（回錯誤，不回假成功）──────────────────────────
/**
 * LINE 登入（docs/07 §3.2）。公開端點——還沒登入的人才會呼叫它。
 *
 * 驗證失敗一律回 `unauthenticated` 並附上 LINE 給的原因：
 * 現場最常見的是 token 過期或 Channel 設錯，錯誤訊息含糊的話沒有人查得出來。
 */
/**
 * 抽獎中獎聯絡方式（docs/06 §7.2）。公開端點——玩家沒有登入。
 * 身分靠建卡時留在手機上的憑證（見 pipeline.setPlayerContactFor）。
 */
export const setPlayerContact = onCall(async (req) => {
  const { eventId, playerId, key, phone } = req.data || {};
  if (!eventId || !playerId) fail('invalid-argument', '需要 eventId / playerId');
  // 登入的攤位工作人員可以替玩家登記（攤位代建的卡沒有憑證）。
  // 沒登入的就是玩家本人，要帶建卡時留在手機上的憑證。
  // 登入的人：攤位以上的工作人員可以替玩家登記；一般 LINE 使用者是替自己（要是這張卡的主人）。
  // 沒登入的（舊的自建卡）要帶建卡時留在手機上的憑證。
  let staffUid = null;
  let ownerUid = null;
  if (req.auth) {
    const snap = await db().doc(`staff/${req.auth.uid}`).get();
    const s = snap.data();
    if (snap.exists && s.active === true && BOOTH.some(r => (s.roles || []).includes(r))) staffUid = req.auth.uid;
    else ownerUid = req.auth.uid;
  }
  try {
    return ok(await setPlayerContactFor({ eventId, playerId, key, phone, staffUid, ownerUid }));
  } catch (err) {
    fail('invalid-argument', err.message);
  }
});

export const lineLogin = onCall(async (req) => {
  try {
    return ok(await loginWithLine(req.data?.idToken));
  } catch (err) {
    logger.warn('[lineLogin] 失敗', { err: err.message });
    fail('unauthenticated', err.message);
  }
});
/**
 * 配發挑戰卡（docs/06 §5.1，2026-09-06 主辦修訂：綁 LINE 帳號，由系統配發）。
 * 要登入，而且不能是匿名身分（demo 的切換身分是匿名登入，那不是一個人）。
 */
export const issuePlayerQr = onCall(async (req) => {
  if (!req.auth) fail('unauthenticated', '請先用 LINE 登入');
  if (req.auth.token?.firebase?.sign_in_provider === 'anonymous') fail('permission-denied', '匿名身分不能領挑戰卡，請用 LINE 登入');
  const { eventId } = req.data || {};
  if (!eventId) fail('invalid-argument', '需要 eventId');
  try {
    return ok(await issueGamePassFor({ eventId, uid: req.auth.uid, displayName: req.auth.token?.name ?? null }));
  } catch (err) {
    fail('failed-precondition', err.message);
  }
});
export const revokePlayerQr   = onCall(unimplemented('revokePlayerQr', 'M6'));
export const verifyCheckin    = onCall(unimplemented('verifyCheckin', 'M6'));
export const generateSchedule = onCall(unimplemented('generateSchedule', 'M4'));
export const scheduleMatches  = onCall(unimplemented('scheduleMatches', 'M4'));
export const mergePlayers     = onCall(unimplemented('mergePlayers', 'M6'));
export const exportCsv        = onCall(unimplemented('exportCsv', 'M7'));
export const exportPdf        = onCall(unimplemented('exportPdf', 'M7'));
export const sendAnnouncement = onCall(unimplemented('sendAnnouncement', 'M5'));

// ══════════════════════════════════════════════════════════════
//  排程
// ══════════════════════════════════════════════════════════════

// ⚠️ 2026-09-05 拿掉了 refreshBoards（每 1 分鐘）與 detectAnomalies（每 5 分鐘）。
//    兩支從 M3.9 起一直是**空的**，卻部署在 demo 上每分鐘白跑一次——
//    留著會讓人以為看板有保底重建、異常有人在掃，其實都沒有（docs/07 §3.1 已註記）。
//    看板由 onMatchWritten 在完賽時重建；要做保底時再加回來，而且要有內容。
//    ⚠️ 從雲端刪除要另外跑 `firebase functions:delete refreshBoards detectAnomalies`，
//       部署不會自動刪（非互動模式會直接中止）。
