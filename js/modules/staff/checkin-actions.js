/**
 * 檢錄的純邏輯
 * ------------------------------------------------------------------
 * 不碰 Firestore、不呼叫 Date.now()、不用隨機——時間戳由呼叫端填
 * （R-ENG-004）。這樣才測得動，也才能在離線佇列裡重放。
 *
 * 對應 docs/01b §1.12 的 `checkins/{matchId}__{memberId}`。
 */

/** 有效的檢錄結果。null 代表「取消勾選」，那是刪除不是狀態。 */
export const CHECKIN_RESULTS = ['pass', 'fail'];

/**
 * 一筆檢錄紀錄。
 *
 * 學童組是**用眼睛核對證件**，不是掃碼，所以 `method` 是 'manual'。
 * `memberName` 存的是名冊上的顯示名（學童組就是暱稱）——
 * 這裡不會、也拿不到孩子的真名。
 *
 * @param {object} o
 * @param {string} o.matchId / o.teamId
 * @param {object} o.member   roster 投影（displayName / jerseyNo / idLast4 / birthRoc）
 * @param {'pass'|'fail'|null} o.result
 * @param {string|null} o.uid
 */
export function buildCheckin({ matchId, teamId, member, result, uid, method = 'manual' }) {
  return {
    checkinId: `${matchId}__${member?.memberId}`,
    matchId,
    teamId,
    memberId: member?.memberId ?? null,
    memberName: member?.displayName ?? null,
    jerseyNo: typeof member?.jerseyNo === 'number' ? member.jerseyNo : null,
    result: CHECKIN_RESULTS.includes(result) ? result : null,
    // 標「有問題」的時候不猜原因：檢錄員當場會口頭處理，
    // 系統只負責記下「這一筆沒過」與是誰記的。
    failReason: result === 'fail' ? 'MANUAL_FLAG' : null,
    method,
    scannedBy: uid,
    // scannedAt / syncedAt 由寫入層填 serverTimestamp（R-ENG-004）
    note: ''
  };
}

/**
 * 一隊的檢錄進度。
 *
 * ⚠️ `total` 只算**球員**。隊職員（領隊／教練／管理）不上場，
 *    把他們算進分母會讓「11 / 14」看起來永遠檢不完，
 *    檢錄員會以為漏了三個人。
 */
export function checkinSummary(roster, checkins = {}) {
  const list = Array.isArray(roster) ? roster : [];
  const players = list.filter(isPlayer);
  let present = 0;
  let failed = 0;
  for (const m of players) {
    const r = checkins[m.memberId]?.result;
    if (r === 'pass') present += 1;
    else if (r === 'fail') failed += 1;
  }
  return { total: players.length, present, failed };
}

const isPlayer = m => {
  const role = m?.role ?? m?.kind ?? 'player';
  return role === 'player';
};

/**
 * 已確認出賽的 memberId。
 * 順序照名冊（背號），不是照勾選順序——出場名單要看得出號碼順序。
 */
export function presentIds(roster, checkins = {}) {
  return (Array.isArray(roster) ? roster : [])
    .filter(m => checkins[m?.memberId]?.result === 'pass')
    .map(m => m.memberId);
}

/**
 * 人數夠不夠開賽。
 *
 * fail-closed（R-ENG-005）：讀不到門檻就回 `ready: false` 並附原因，
 * 不可以「沒設定就當作通過」——那會在人數不足時默默放行，
 * 而規章第十八條第 6 款對人數不足的處理是棄權論 0:2。
 */
export function readyToStart(summary, requiredMin) {
  if (typeof requiredMin !== 'number' || !Number.isFinite(requiredMin)) {
    return { ready: false, reason: '讀不到開賽人數門檻，請找主辦確認' };
  }
  if (summary.present < requiredMin) {
    return { ready: false, reason: `已確認 ${summary.present} 人，不足 ${requiredMin} 人` };
  }
  return { ready: true, reason: '' };
}
