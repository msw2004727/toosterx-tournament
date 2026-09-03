/**
 * T35 Demo 自助身分：介面與 rules 必須一致
 * ------------------------------------------------------------------
 * 規格：docs/07 §1.1、R-RULES-003
 *
 * 這份清單有兩份：`js/modules/demo/index.js` 的切換選單，
 * 與 `firestore.rules` 的 `validSelfServe()` 白名單。
 * 兩邊分岔的後果不對稱，而且都不會有錯誤訊息：
 *   ・介面多一個 → 使用者選了，送出被 rules 擋掉，看起來像系統壞了
 *   ・rules 多一個 → 有人手動送請求就拿得到那個身分，介面上完全看不出來
 *
 * ⭐ 最重要的一條是 super_admin **兩邊都不可以有**。
 *    大總管是唯一能指派身分的人；自助拿得到就等於
 *    「任何人登入一次就能發身分給任何人」。
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ROLES as DEMO_ROLES } from '../../js/modules/demo/index.js';
import { ROLE_INFO } from '../../js/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = p => fs.readFileSync(join(ROOT, p), 'utf8');

/**
 * 從 firestore.rules 的某個函式裡撈出 hasOnly 白名單。
 *
 * ⚠️ 一定要指定是哪一個函式。`staffRolesAssignable()` 與 `validSelfServe()`
 *    的那一行**字面完全相同**，用整檔搜第一個 hasOnly 的話，
 *    改壞了其中一個測試也不會紅（變異 #P32 第一次就是這樣逃掉的）。
 */
function rulesWhitelist(fnName) {
  const src = read('firestore.rules');
  const start = src.indexOf(`function ${fnName}(`);
  if (start < 0) throw new Error(`firestore.rules 裡找不到 ${fnName}()`);
  // 到下一個 function 為止就是這一個函式的內容
  const rest = src.slice(start + 1);
  const end = start + 1 + (rest.indexOf('function ') < 0 ? rest.length : rest.indexOf('function '));
  const m = /hasOnly\(\[([^\]]+)\]\)/.exec(src.slice(start, end));
  if (!m) throw new Error(`在 ${fnName}() 裡找不到 hasOnly([...]) 白名單`);
  return m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
}

/** demo 切換器提供的身分。直接 import，不要正規表示式硬解——
 *  改個排版就抓不到的測試等於沒有測試。 */
const uiRoles = () => DEMO_ROLES.map(r => r.value);

describe('T35 自助身分白名單', () => {
  const rules = rulesWhitelist('validSelfServe');
  const assignable = rulesWhitelist('staffRolesAssignable');
  const ui = uiRoles();

  test('⭐ 三份清單都不得包含 super_admin', () => {
    // R-RULES-003。這一條沒有例外，連 demo 也沒有——
    // demo 是拿來驗流程的，不是拿來繞過權限模型的。
    //
    // staffRolesAssignable 是「大總管能指派出什麼」，validSelfServe 是
    // 「demo 上能自己拿什麼」。兩者都放行 super_admin 的話，
    // 大總管就不再是唯一的了。
    expect(rules).not.toContain('super_admin');
    expect(assignable).not.toContain('super_admin');
    expect(ui).not.toContain('super_admin');
  });

  test('自助能拿的不可以超過大總管能指派的', () => {
    for (const r of rules) expect(assignable).toContain(r);
  });

  test('⭐ 介面提供的每一個身分，rules 都放行', () => {
    // 反過來（介面有、rules 沒有）使用者會選了才被擋，看起來像壞掉
    for (const r of ui) expect(rules).toContain(r);
  });

  test('⭐ rules 放行的每一個身分，介面上都看得到', () => {
    // 反過來（rules 有、介面沒有）等於有一個沒人知道的後門
    for (const r of rules) expect(ui).toContain(r);
  });

  test('admin 有開放（要測覆核完賽、審核報名）', () => {
    expect(ui).toContain('admin');
    expect(rules).toContain('admin');
  });

  test('身分都在全站角色字典裡（js/config.js）', () => {
    for (const r of [...ui, ...rules]) expect(ROLE_INFO).toHaveProperty(r);
  });
});
