/**
 * 身分授權
 * ------------------------------------------------------------------
 * 規格：docs/10 §5.1、R-RULES-003
 *
 * 總管在這裡把賽務身分指派給人。純函式：不碰 Firestore、不呼叫 Date.now()。
 *
 * ⚠️ 兩件事這裡一定要擋，而且 `firestore.rules` 也擋一次（R-PERM-002）：
 *   1. **總管指派不出總管**。`staffRolesAssignable()` 的白名單裡沒有
 *      super_admin——大總管只能由 Admin SDK 建立（scripts/grant-super-admin.mjs）。
 *      少了這條，介面上點兩下就能造出第二個大總管。
 *   2. **角色至少要有一個**。空陣列的 staff 文件在 `myRoles()` 看來是
 *      「有身分但什麼都不能做」，比沒有文件更難查。
 */

import { STAFF_CHAIN, ROLE_INFO, impliedRoles } from '../config.js';

/**
 * 總管指派得出來的身分。
 *
 * 就是繼承鏈**扣掉最上面那一階**。寫成 slice 而不是另外列一份陣列：
 * 兩份清單遲早會分岔，而分岔的方向如果是「多列了 super_admin」，
 * 就是一個介面上點得到的提權漏洞。
 * `tests/unit/selfserve-roles.test.js` 會比對這一份與 rules 的白名單。
 */
export const ASSIGNABLE_ROLES = STAFF_CHAIN.slice(0, -1);

/**
 * 這個角色指派下去，對方實際會拿到哪些身分。
 *
 * 因為是向上包含（R-ROLE-002），指派一個記錄員等於同時給了
 * 挑戰攤位、檢錄員、裁判。介面一定要把這件事講出來——
 * 不然總管會以為要一個一個指派，然後指派出四個角色。
 */
export function impliedBy(role) {
  return impliedRoles([role]);
}

/**
 * 檢查一次指派是否合法。
 *
 * @param {object} o
 * @param {string} o.uid   被指派的人
 * @param {string} o.role  單一角色（介面用單選：階層之下，選一個就夠了）
 * @param {string[]} [o.venueIds] 指派場地。空陣列＝全部場地
 * @param {string[]} [o.knownVenueIds] 這場活動實際存在的場地
 * @returns {{ok:boolean, code:string|null, message:string}}
 */
export function validateAssignment({ uid, role, venueIds = [], knownVenueIds = null }) {
  if (!/^\S+$/.test(String(uid ?? ''))) {
    return { ok: false, code: 'NO_UID', message: '請先選一個人。' };
  }
  if (!role) {
    return { ok: false, code: 'NO_ROLE', message: '請選一個身分。' };
  }
  if (role === 'super_admin') {
    // 這是提權，不是設定錯誤——訊息要說清楚為什麼，以及唯一的正路
    return {
      ok: false,
      code: 'SUPER_ADMIN_FORBIDDEN',
      message: '總管不能由介面指派。第一位與每一位總管都只能用 scripts/grant-super-admin.mjs 建立。'
    };
  }
  if (!ASSIGNABLE_ROLES.includes(role)) {
    return { ok: false, code: 'UNKNOWN_ROLE', message: `不認得的身分：${role}` };
  }

  const ids = Array.isArray(venueIds) ? venueIds : [];
  if (knownVenueIds) {
    const bad = ids.filter(v => !knownVenueIds.includes(v));
    if (bad.length) {
      // 指派到不存在的場地＝這個人什麼場次都經手不到，而且完全沒有錯誤訊息
      return { ok: false, code: 'UNKNOWN_VENUE', message: `不認得的場地：${bad.join('、')}` };
    }
  }

  // 管理員以上不受場地限制（rules 的 assignedVenue() 對 admin 直接放行），
  // 指派場地只會讓人以為有限制。
  if (ids.length && !onlyStaffScoped(role)) {
    return {
      ok: false,
      code: 'VENUE_NOT_APPLICABLE',
      message: `${ROLE_INFO[role]?.label ?? role}不受場地限制，不用指派場地。`
    };
  }

  return { ok: true, code: null, message: '' };
}

/**
 * staff 文件上**這一頁管不到**的角色。
 *
 * 兩種來源：舊版本留下的（`venue_lead` 在 M3.5 已移除）、
 * 以及 FC-Football 同步過來的（`captain`／`coach`／`venue_owner`）。
 *
 * 這些角色要照原樣印出來，**不可以顯示成「未指派」**——
 * 看起來像沒有身分的話，總管永遠不會去清掉它，而它還留在資料庫裡。
 */
export const unmanagedRoles = (roles = []) =>
  (Array.isArray(roles) ? roles : []).filter(r => !STAFF_CHAIN.includes(r));

/**
 * 這一列能不能在介面上改身分？
 *
 * **總管那一列不行。** rules 的白名單沒有 super_admin，所以一旦在這裡把
 * 總管改成管理員，那個人就**再也升不回去**，而且如果他是最後一位總管，
 * 整個系統就再也沒有人指派得了身分——唯一的回頭路是後台腳本。
 *
 * 這件事最可能發生在總管好奇點開自己那一列的時候，而且點下去不會有
 * 任何警告：rules 放行（admin 在白名單裡），畫面會顯示「已更新」。
 */
export const assignableHere = row => row?.role !== 'super_admin';

/** 這個角色的權限會受「指派場地」限制嗎？管理員以上不會。 */
export const onlyStaffScoped = role => ASSIGNABLE_ROLES.includes(role) && role !== 'admin';

/**
 * 組出要寫進 `staff/{uid}` 的文件。
 *
 * ⚠️ `roles` 只存**被指派的那一個**，不存展開後的四個。
 *    存展開的話，之後想調整階層（例如把裁判與記錄員對調）就要重寫
 *    所有人的資料；而且「他到底被指派了什麼」會再也看不出來。
 *    展開是讀取時算的（impliedRoles）。
 *
 * 時間戳由呼叫端填 serverTimestamp（R-ENG-004）。
 */
export function buildStaffDoc({ uid, name, role, venueIds = [], eventId }) {
  return {
    uid,
    name: name ?? null,
    lineUserId: uid,
    roles: [role],
    assignment: {
      eventId,
      date: null,                       // 不綁日期：現場常常臨時調班
      venueIds: onlyStaffScoped(role) ? [...venueIds] : [],
      divisionIds: [],
      challengeIds: []
    },
    deviceLabel: null,
    active: true
  };
}

/**
 * 停用一個身分。
 *
 * **不刪文件**：`myRoles()` 看的是 `active == true`，停用就等於失去全部權限，
 * 但「這個人曾經是記錄員」這件事要留著——賽後查某一筆比分是誰記的，
 * 靠的就是這份文件。
 */
export const buildDeactivatePatch = () => ({ active: false });
export const buildReactivatePatch = () => ({ active: true });

/**
 * 把 users 名錄與 staff 合成一份「這場活動有哪些人」的清單。
 *
 * 名錄是唯一能查到 LINE uid 的地方（uid 沒辦法憑空產生，docs/10 §1.4），
 * 所以「指派身分」的第一步永遠是「請對方先登入一次」。
 *
 * @returns {Array<{uid, name, role:string|null, roles:string[], active:boolean,
 *                   assigned:boolean, venueIds:string[]}>}
 */
export function mergeDirectory(users = [], staff = []) {
  const byUid = new Map();
  for (const u of users ?? []) {
    if (!u?.uid) continue;
    byUid.set(u.uid, {
      uid: u.uid,
      name: u.displayName || u.name || null,
      role: null, roles: [], active: false, assigned: false, venueIds: []
    });
  }
  for (const s of staff ?? []) {
    if (!s?.uid) continue;
    const chainRole = (s.roles ?? []).find(r => STAFF_CHAIN.includes(r)) ?? null;
    const row = byUid.get(s.uid) ?? { uid: s.uid, name: null, venueIds: [] };
    byUid.set(s.uid, {
      ...row,
      // staff 文件上的名字比名錄新（總管可能改過），但名錄的 LINE 名稱才是本人
      name: row.name || s.name || null,
      role: chainRole,
      roles: Array.isArray(s.roles) ? s.roles : [],
      active: s.active === true,
      assigned: true,
      venueIds: s.assignment?.venueIds ?? []
    });
  }
  // 有身分的排前面，其次照 level 由高到低，最後照名字
  return [...byUid.values()].sort((a, b) => {
    if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
    const la = ROLE_INFO[a.role]?.level ?? -1;
    const lb = ROLE_INFO[b.role]?.level ?? -1;
    if (la !== lb) return lb - la;
    return String(a.name ?? a.uid).localeCompare(String(b.name ?? b.uid), 'zh-Hant');
  });
}
