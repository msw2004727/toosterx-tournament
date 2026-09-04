/**
 * 報名審核的名單檢核
 * ------------------------------------------------------------------
 * 規格：docs/05 §8.2、docs/10 §3；競賽規章第十一、十二條
 *
 * 主辦按「核准」之前要看到的東西：這支球隊有沒有違反規章，
 * 以及哪些是**不能放行**的、哪些是「知道就好」。
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()（R-ENG-004）。
 *
 * ⚠️ 兩種嚴重度的界線很重要：
 *   ・`error` 擋住核准。只放**規章明文**與「放行之後會產生錯誤結果」的兩類。
 *   ・`warn`  只是提醒，主辦仍可核准。
 *   規章沒寫、也不會弄錯結果的事情，不要升成 error——
 *   那等於系統替主辦訂了一條規章沒有的規則。
 */

import { checkAge, isYouthDivision } from './eligibility.js';

/** @typedef {{level:'error'|'warn'|'ok', code:string, message:string, source:string}} Finding */

const ACTIVE = ['approved'];
const isPlayer = m => (m?.kind ?? m?.role ?? 'player') === 'player';

/**
 * 檢核一支球隊的名單。
 *
 * @param {object} o
 * @param {object} o.team      teams 文件
 * @param {Array}  o.members   members 文件（會自己過濾出 approved 的）
 * @param {object} o.division  組別設定（年齡門檻與名稱從這裡來）
 * @param {{maxPlayers:number, maxStaff:number}} o.limits 規章第十二條
 * @returns {{findings:Finding[], canApprove:boolean, players:number, staff:number}}
 */
export function reviewTeam({ team, members = [], division, limits }) {
  const findings = [];
  const roster = (Array.isArray(members) ? members : []).filter(m => ACTIVE.includes(m?.status));
  const players = roster.filter(isPlayer);
  const staff = roster.filter(m => !isPlayer(m));

  const add = (level, code, message, source) => findings.push({ level, code, message, source });

  // ── 人數（規章第十二條）──────────────────────────────────
  if (players.length === 0) {
    add('error', 'NO_PLAYERS', '名單上沒有球員，不能核准。', '系統');
  } else if (players.length > limits.maxPlayers) {
    add('error', 'TOO_MANY_PLAYERS',
      `球員 ${players.length} 人，超過規章的 ${limits.maxPlayers} 人上限。`, '規章第十二條');
  } else {
    add('ok', 'PLAYERS', `球員 ${players.length} 人（上限 ${limits.maxPlayers}）`, '規章第十二條');
  }

  if (staff.length > limits.maxStaff) {
    add('error', 'TOO_MANY_STAFF',
      `隊職員 ${staff.length} 人，超過規章的 ${limits.maxStaff} 人（領隊、教練、管理各 1）。`,
      '規章第十二條');
  } else if (staff.length > 0) {
    add('ok', 'STAFF', `隊職員 ${staff.length} 人（上限 ${limits.maxStaff}）`, '規章第十二條');
  }

  // ── 背號 ────────────────────────────────────────────────
  // 規章沒有「背號不得重複」這一條，但兩個 7 號在賽務台上分不出來，
  // 進球會記到錯的人身上——那是**結果性錯誤**，這個系統存在的理由就是防它。
  // 所以升成 error，但在來源上誠實標「系統限制」而不是「規章」。
  const nums = players.map(m => m?.jerseyNo).filter(n => typeof n === 'number');
  const dup = [...new Set(nums.filter((n, i) => nums.indexOf(n) !== i))].sort((a, b) => a - b);
  if (dup.length) {
    add('error', 'DUPLICATE_JERSEY',
      `背號重複：${dup.join('、')} 號。賽務台靠背號認人，重複會把進球記到錯的球員身上。`,
      '系統限制');
  }
  const noNumber = players.filter(m => typeof m?.jerseyNo !== 'number').length;
  if (noNumber) {
    add('warn', 'MISSING_JERSEY', `${noNumber} 位球員還沒有背號。`, '系統');
  }

  // ── 參賽資格（規章第十一條）──────────────────────────────
  // 第十八條第 3 款：冒名頂替「立即停止該球隊繼續比賽資格」。
  // 罰則是取消整隊，所以超齡一定是 error。
  const tooOld = [];
  const noBirth = [];
  for (const m of players) {
    const r = checkAge(m?.birthDate, division);
    if (r.ok) continue;
    (r.code === 'BIRTHDATE_MISSING' ? noBirth : tooOld).push(m);
  }
  if (tooOld.length) {
    add('error', 'TOO_OLD',
      `${tooOld.length} 位球員早於 ${division?.name ?? '本組'} 的出生門檻：${nameList(tooOld)}。`,
      '規章第十一條');
  }
  if (noBirth.length) {
    add('error', 'BIRTHDATE_MISSING',
      `${noBirth.length} 位球員沒有填出生年月日，驗不了資格：${nameList(noBirth)}。`,
      '規章第十一條');
  }
  if (isYouthDivision(division) && !tooOld.length && !noBirth.length && players.length) {
    add('ok', 'AGE', '全部球員符合出生日期門檻', '規章第十一條');
  }

  // ── 檢錄要用的欄位（學童組）─────────────────────────────
  if (isYouthDivision(division)) {
    const noId = players.filter(m => !/^\d{4}$/.test(String(m?.idLast4 ?? '')));
    if (noId.length) {
      add('error', 'ID_LAST4_MISSING',
        `${noId.length} 位球員沒有身分證後四碼，檢錄當天核對不了證件：${nameList(noId)}。`,
        '檢錄');
    }
  }

  return {
    findings,
    canApprove: !findings.some(f => f.level === 'error'),
    players: players.length,
    staff: staff.length
  };
}

/** 最多列三個名字，其餘用「等 N 位」帶過——列一長串在手機上會佔滿整個畫面 */
function nameList(list) {
  const names = list.map(m => m?.name || m?.memberId || '（未填）');
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等 ${names.length} 位`;
}

/**
 * 核准時要寫進 teams 的欄位。
 *
 * `rosterLocked: true` 是**第二道鎖**（docs/10 §3.1）：送出時 status 就凍結了名單，
 * 核准之後連狀態退回都不放行，要改只能找 Admin。
 *
 * 時間戳由呼叫端填 serverTimestamp（R-ENG-004）。
 */
export function buildApprovePatch(uid) {
  return { status: 'approved', rosterLocked: true, reviewedBy: uid, rejectReason: null };
}

/**
 * 退回時要寫進 teams 的欄位。
 *
 * ⚠️ **不可以設 rosterLocked**。退回的意思是「請你改完再送」，
 *    而 rosterFrozen() 看的是 `status in ['draft','rejected'] && !rosterLocked`——
 *    順手鎖起來的話隊長改不動，卻看不出為什麼。
 */
export function buildRejectPatch(uid, reason) {
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('退回一定要填原因');
  return { status: 'rejected', rosterLocked: false, reviewedBy: uid, rejectReason: text.slice(0, 500) };
}
