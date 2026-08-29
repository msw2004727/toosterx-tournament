/**
 * Cloud Functions v2｜asia-east1
 * ------------------------------------------------------------------
 * 契約：docs/07-權限安全與CloudFunctions.md §3
 * 狀態：TODO(M2/M3) — 目前僅宣告函式骨架與統一回傳格式。
 */
const { setGlobalOptions } = require('firebase-functions/v2');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();
setGlobalOptions({ region: 'asia-east1', maxInstances: 10 });

const ok   = (data) => ({ ok: true,  data });
const fail = (code, message) => { throw new HttpsError(code, message); };

/** 每個 callable 的共通前置：驗證身分與角色 */
async function requireStaff(request, roles = []) {
  if (!request.auth) fail('unauthenticated', '請先登入');
  const snap = await admin.firestore().doc(`staff/${request.auth.uid}`).get();
  const staff = snap.data();
  if (!snap.exists || staff.active !== true) fail('permission-denied', '你尚未被指派為工作人員');
  if (roles.length && !roles.some(r => staff.roles.includes(r))) fail('permission-denied', '權限不足');
  return staff;
}

// ── 觸發器 ────────────────────────────────────────────────────────
exports.onMatchWritten = onDocumentWritten('events/{eventId}/matches/{matchId}', async (event) => {
  // TODO(M2): recalcStanding → boards/live 扇出 → resolveAdvancement → audit
});

exports.onTimelineWritten = onDocumentWritten(
  'events/{eventId}/matches/{matchId}/timeline/{timelineId}', async (event) => {
    // TODO(M3): 事件加總對帳、球員 stats、boards/scorers
  });

exports.onMemberWritten = onDocumentWritten(
  'events/{eventId}/teams/{teamId}/members/{memberId}', async (event) => {
    // TODO(M1): 同步公開投影 teams/{teamId}/roster/{memberId}
  });

exports.onAttemptCreated = onDocumentCreated('events/{eventId}/attempts/{attemptId}', async (event) => {
  // TODO(M5): best score、抽獎資格、leaderboards 重算
});

exports.onCheckinCreated = onDocumentCreated('events/{eventId}/checkins/{checkinId}', async (event) => {
  // TODO(M5): 更新 matchSheets.checkedInCount 與 issues
});

// ── Callable ─────────────────────────────────────────────────────
exports.lineLogin        = onCall(async (req) => { /* TODO(M3) */ return ok({}); });
exports.issuePlayerQr    = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.revokePlayerQr   = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.verifyCheckin    = onCall(async (req) => { await requireStaff(req); return ok({}); });
exports.generateSchedule = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.scheduleMatches  = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.recalcStanding   = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.resolveAdvancement = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.setManualRanking = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.computeFinalRanking = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.publishFinalRanking = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.mergePlayers     = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.exportCsv        = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.exportPdf        = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });
exports.sendAnnouncement = onCall(async (req) => { await requireStaff(req, ['admin', 'super_admin']); return ok({}); });

// ── 排程 ─────────────────────────────────────────────────────────
exports.refreshBoards = onSchedule('every 1 minutes', async () => { /* TODO(M4) 保底重建看板 */ });
exports.detectAnomalies = onSchedule('every 5 minutes', async () => { /* TODO(M4) 異常偵測 */ });
