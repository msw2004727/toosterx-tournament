/**
 * 權限開關
 * ------------------------------------------------------------------
 * 規格：docs/05、R-PERM-001、R-PERM-002、R-RULES-002
 *
 * 總管在 `#/admin/perms` 逐條調整每個身分能做的事。
 * 純函式：不碰 Firestore、不呼叫 Date.now()。
 *
 * ⚠️ 這一層只控制**畫面**。破壞性操作真正擋得住的是 `firestore.rules`
 *    （R-PERM-002）。所以這裡只做得到「收窄」，做不到「放寬」——
 *    詳見下面 `editableRole()` 的說明。
 */

import {
  PERMISSIONS, PERMISSION_GROUPS, STAFF_CHAIN, ROLE_INFO, effectivePerms
} from '../config.js';

/**
 * 一條權限「屬於」哪一階。
 *
 * 也就是它的 `minRole`。這一階以上的人靠向上包含拿到它。
 */
export const ownerRole = p => p.minRole;

/**
 * 這一條權限**調得動嗎**？調不動的話原因是什麼。
 *
 * 兩種調不動：
 *
 * 1. **總管的三條**（指派身分／權限開關／報名開關）。
 *    `effectivePerms()` 對 super_admin 直接回傳全部權限——這是刻意的
 *    （規矩 2：「調整權限開關」本身也是一條權限，關掉就再也打不開了）。
 *    所以這裡的開關按下去不會有任何效果，那就是一顆按了沒反應的按鈕。
 *
 * 2. **繼承來的那幾條**（`minRole` 不是這一階）。
 *    `effectivePerms()` 是「開優先於關」的聯集，而種子把每個角色的
 *    預設權限都寫成 `true`——所以在「記錄員」那一列關掉挑戰成績登錄，
 *    會被「挑戰攤位」那一列的 `true` 蓋過去，開關**完全沒有作用**。
 *    要關就到來源那一階關。
 */
export function editableRole(p, role) {
  if (p.minRole === 'super_admin') {
    return { ok: false, reason: '總管不受權限開關影響（不然關掉之後就再也打不開了）。' };
  }
  if (p.minRole !== role) {
    const owner = ROLE_INFO[p.minRole]?.label ?? p.minRole;
    return { ok: false, reason: `這一條屬於${owner}，請到${owner}那一列調整。` };
  }
  return { ok: true, reason: '' };
}

/**
 * 關掉之後**誰不受影響**。
 *
 * 這句話一定要寫在畫面上。「關掉記錄員的送出完賽」不會讓管理員也不能
 * 送出——管理員那一列自己也開著。少了這句，主辦會以為整個功能被關掉了，
 * 然後在現場找不到人送出完賽。
 */
export function stillAllowed(p) {
  const i = STAFF_CHAIN.indexOf(p.minRole);
  if (i < 0) return [];
  return STAFF_CHAIN.slice(i + 1);
}

/**
 * 一條權限現在的狀態。
 *
 * `on` 問的是「一個身分正好是這一階的人，實際上拿不拿得到」——
 * 用的是 `effectivePerms()` 本尊，不是另外算一份。
 * 兩份實作遲早分岔，而分岔的方向是「畫面說開著、實際上關著」。
 */
export function permState(p, matrix = {}) {
  const role = ownerRole(p);
  const raw = matrix?.[role]?.perms?.[p.code];
  const stored = raw === true || raw === false ? raw : null;
  const on = role === 'super_admin' ? true : effectivePerms([role], matrix).has(p.code);
  return {
    on,
    stored,
    changed: stored === false,        // 只有「被關掉」算改過；true 就是預設值
    // 設定寫著「關」，實際上卻是開的：某個下層角色還留著一個 true，
    // 而「開優先於關」讓它贏了。介面一定要講出來——不然那位總管會
    // 一直按同一個開關，然後以為系統壞了。
    conflict: stored === false && on === true
  };
}

/**
 * 整張表：依 `PERMISSION_GROUPS` 的順序分組。
 *
 * ⚠️ 分組不等於角色：「賽務」組裡同時有裁判的（出場名單）與記錄員的
 *    （比分、時鐘、完賽），所以角色標在**每一列**上，不標在組標題。
 *
 * @returns {Array<{group:string, rows:Array}>}
 */
export function permGroups(matrix = {}) {
  const out = [];
  for (const group of PERMISSION_GROUPS) {
    const perms = PERMISSIONS.filter(p => p.group === group);
    if (!perms.length) continue;
    out.push({
      group,
      rows: perms.map(p => {
        const st = permState(p, matrix);
        const ed = editableRole(p, ownerRole(p));
        return {
          code: p.code,
          label: p.label,
          role: ownerRole(p),
          roleLabel: ROLE_INFO[ownerRole(p)]?.label ?? ownerRole(p),
          destructive: p.destructive === true,
          on: st.on,
          changed: st.changed,
          conflict: st.conflict,
          editable: ed.ok,
          lockReason: ed.reason,
          stillAllowed: stillAllowed(p).map(r => ROLE_INFO[r]?.label ?? r)
        };
      })
    });
  }
  return out;
}

/**
 * 要寫進 `rolePermissions/{role}` 的內容。
 *
 * 只動一個欄位，用 merge 寫入——整份覆蓋的話會把其他權限的設定一起抹掉，
 * 而那份設定可能是上一位總管在賽前調好的。
 *
 * @returns {{role:string, patch:object}}
 */
export function buildPermPatch(p, on) {
  const role = ownerRole(p);
  if (role === 'super_admin') throw new Error('總管的權限不能由介面調整');
  if (typeof on !== 'boolean') throw new Error('權限開關只能是 true 或 false');
  return { role, patch: { role, perms: { [p.code]: on } } };
}
