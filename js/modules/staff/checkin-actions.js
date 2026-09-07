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

/**
 * 這一場、這一隊要幾個人才算「檢錄完成」。
 *
 * 優先序：
 *   1. 場次上的 `checkin.requiredMin`（主辦逐場設定；docs/04 §4.6 寫的「可設定」）
 *   2. 組別的 `minPlayersToStart`（整組設定；規章沒有寫最低開賽人數，留給主辦）
 *   3. 組別的 `playersOnField`（規章第十五條的上場人數：學童三組與女子 5、男子兩組 9）
 *
 * 三個都讀不到就回 null，由呼叫端 fail-closed（R-ENG-005）。
 *
 * ⚠️ 真實的場次文件**沒有** `requiredMin`（seed 只寫 homeConfirmed／awayConfirmed／confirmedAt），
 *    而 E2E 的替身曾經替它補了一個——所以「一個人也能完成檢錄」在測試裡從來沒有紅過，
 *    在 demo 上一按就過（第三輪驗收 C-5）。替身資料寫錯 schema 比沒有測試更危險，第六次。
 */
export function requiredMinOf({ match, division } = {}) {
  const candidates = [match?.checkin?.requiredMin, division?.minPlayersToStart, division?.playersOnField];
  for (const v of candidates) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * 「完成這一隊的檢錄」按不按得下去。
 *
 * 人數不足是主辦要裁定的事（規章第十八條第 6 款：逾時不出場以棄權論 0:2），
 * 檢錄員**不能自己放行**；管理員可以，但一定要記錄原因（docs/04 §4.6）。
 * 門檻讀不到時連管理員也不放行——那是設定壞了，要先修設定，不是硬按過去。
 *
 * @returns {{allowed:boolean, short:boolean, missing:number|null, reason:string, needsReason:boolean}}
 */
export function checkinGate({ summary, requiredMin, canForce = false }) {
  const r = readyToStart(summary, requiredMin);
  if (r.ready) return { allowed: true, short: false, missing: 0, reason: '', needsReason: false };
  const known = typeof requiredMin === 'number' && Number.isFinite(requiredMin);
  const missing = known ? Math.max(0, requiredMin - (summary?.present ?? 0)) : null;
  if (known && canForce === true) {
    return { allowed: true, short: true, missing, reason: r.reason, needsReason: true };
  }
  return { allowed: false, short: known, missing, reason: r.reason, needsReason: false };
}

/**
 * 完成一隊的檢錄要寫回場次的 patch（docs/01b §1.7 的 `checkin` 那一包）。
 *
 * ⚠️ `updateDoc` 對巢狀 map 是**整包取代**：`checkin` 少列一個欄位就等於把它從文件上刪掉，
 *    所以另一隊的旗標要原封不動抄回去。
 *
 * 狀態：第一隊完成 → `checkin`，兩隊都完成 → `ready`。已經開打的場次不動狀態
 * （規則的 validStatusTransition 對那些狀態只放行 from == to）。
 *
 * @param {object} o
 * @param {'home'|'away'} o.side
 * @param {*} [o.stamp]  呼叫端給的 serverTimestamp()——這裡不碰時間（R-ENG-004）
 */
export function buildCheckinConfirmPatch({ match, side, uid, present, forcedReason = null, stamp = null }) {
  if (side !== 'home' && side !== 'away') throw new Error('side 必須是 home 或 away');
  const prev = match?.checkin && typeof match.checkin === 'object' ? match.checkin : {};
  const checkin = {
    ...prev,
    homeConfirmed: side === 'home' ? true : prev.homeConfirmed === true,
    awayConfirmed: side === 'away' ? true : prev.awayConfirmed === true,
    [`${side}ConfirmedBy`]: uid ?? null,
    [`${side}ConfirmedAt`]: stamp,
    [`${side}Present`]: typeof present === 'number' ? present : null,
    [`${side}ForcedReason`]: forcedReason ? String(forcedReason).slice(0, 200) : null
  };
  const both = checkin.homeConfirmed && checkin.awayConfirmed;
  checkin.confirmedAt = both ? (prev.confirmedAt ?? stamp) : null;

  const from = match?.status;
  const status = (from === 'scheduled' || from === 'checkin' || from === 'ready')
    ? (both ? 'ready' : 'checkin')
    : from;
  return { checkin, ...(typeof status === 'string' ? { status } : {}) };
}
