/**
 * T36 角色字典與 FC-Football 對齊
 * ------------------------------------------------------------------
 * 規格：docs/07 §1.1、docs/10 §5.1、§8.5
 *
 * 兩個專案共用同一批 LINE 使用者（uid 完全相同，2026-09-02 實機驗證過），
 * 未來要把身分資料對接起來。對接的前提是**同一個代碼在兩邊是同一件事**。
 *
 * 這一組把 FC 的定義抄成常數擺在這裡，任何一邊改動都會撞紅。
 * 抄一份而不是去網路上抓：測試不能依賴網路，而且「對方改了」這件事
 * 本來就應該由人看過再決定要不要跟進——自動跟著變就不叫守衛了。
 *
 * FC 的權威定義：github.com/msw2004727/FC → js/config.js
 *   const BUILTIN_ROLE_KEYS = ['user','coach','captain','venue_owner','admin','super_admin'];
 *   const _BASE_ROLES = {
 *     user:        { level: 0, label: '一般用戶' },
 *     coach:       { level: 1, label: '教練' },
 *     captain:     { level: 2, label: '領隊' },
 *     venue_owner: { level: 3, label: '場主' },
 *     admin:       { level: 4, label: '管理員' },
 *     super_admin: { level: 5, label: '總管' }
 *   };
 * （抄錄日 2026-09-03，main 分支）
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROLE_INFO, ROLES, roleLabel, topRole } from '../../js/config.js';

/** FC 的六個內建角色。改這裡之前請先確認 FC 那邊真的改了。 */
const FC_ROLES = {
  user:        { level: 0, label: '一般用戶' },
  coach:       { level: 1, label: '教練' },
  captain:     { level: 2, label: '領隊' },
  venue_owner: { level: 3, label: '場主' },
  admin:       { level: 4, label: '管理員' },
  super_admin: { level: 5, label: '總管' }
};

describe('T36-1 共用角色必須逐字相同', () => {
  test('⭐ FC 的六個角色這裡都有，而且 level 與標籤一致', () => {
    for (const [key, fc] of Object.entries(FC_ROLES)) {
      expect(ROLE_INFO).toHaveProperty(key);
      expect(ROLE_INFO[key].level).toBe(fc.level);
      expect(ROLE_INFO[key].label).toBe(fc.label);
    }
  });

  test('⭐ super_admin 是「總管」，不是「大總管」', () => {
    // 主辦 2026-09-03 明確指定：總管的英文就是 super_admin。
    // 標籤跟著 FC 走，兩個系統裡不能同一個人叫不同的頭銜。
    expect(roleLabel('super_admin')).toBe('總管');
    expect(ROLE_INFO.super_admin.level).toBe(5);
  });

  test('admin 是 level 4「管理員」，比總管低一階', () => {
    expect(roleLabel('admin')).toBe('管理員');
    expect(ROLE_INFO.admin.level).toBeLessThan(ROLE_INFO.super_admin.level);
  });

  test('標記為 fc:true 的，就是 FC 也有的那幾個', () => {
    const mine = Object.entries(ROLE_INFO).filter(([, v]) => v.fc).map(([k]) => k).sort();
    expect(mine).toEqual(Object.keys(FC_ROLES).sort());
  });
});

describe('T36-2 這裡多出來的賽務角色', () => {
  const extras = ['scorer', 'referee', 'checkin', 'booth'];

  test('賽務角色不可以標成 fc:true（FC 沒有這些）', () => {
    for (const k of extras) expect(ROLE_INFO[k].fc).toBe(false);
  });

  test('⭐ 賽務角色的 level 夾在領隊與管理員之間', () => {
    // 對接時 FC 端看到會落在「比領隊高、比管理員低」，語意才不會歪。
    // 撞到 FC 既有的整數會讓兩邊的排序衝突，所以用小數。
    for (const k of extras) {
      expect(ROLE_INFO[k].level).toBeGreaterThan(FC_ROLES.captain.level);
      expect(ROLE_INFO[k].level).toBeLessThan(FC_ROLES.admin.level);
      expect(Number.isInteger(ROLE_INFO[k].level)).toBe(false);
    }
  });

  test('⭐ 沒有兩個角色共用同一個 level', () => {
    const levels = Object.values(ROLE_INFO).map(v => v.level);
    expect(new Set(levels).size).toBe(levels.length);
  });
});

describe('T36-3 字典的衍生工具', () => {
  test('ROLES 由高到低排序', () => {
    expect(ROLES[0]).toBe('super_admin');
    expect(ROLES.at(-1)).toBe('user');
    const levels = ROLES.map(r => ROLE_INFO[r].level);
    expect([...levels].sort((a, b) => b - a)).toEqual(levels);
  });

  test('topRole 取一組身分裡最高的那個', () => {
    // 主辦 2026-09-03 指定的順序：挑戰攤位 < 檢錄員 < 裁判 < 記錄員
    expect(topRole(['referee', 'scorer'])).toBe('scorer');
    expect(topRole(['booth', 'checkin'])).toBe('checkin');
    expect(topRole(['scorer', 'admin'])).toBe('admin');
    expect(topRole(['admin', 'super_admin'])).toBe('super_admin');
  });

  test('⭐ topRole 遇到沒見過的角色不會爆，也不會把它當成最高', () => {
    // 對接時 FC 可能傳來我們還不認識的自訂角色（FC 支援 customRoles）。
    // 當成未知丟掉，不要猜——猜錯的方向是「給了不該給的權限」。
    expect(topRole(['scorer', 'wizard'])).toBe('scorer');
    expect(topRole(['wizard'])).toBe(null);
    expect(topRole([])).toBe(null);
    expect(topRole()).toBe(null);
  });

  test('roleLabel 不認得就原樣回傳，不會顯示 undefined', () => {
    expect(roleLabel('wizard')).toBe('wizard');
  });
});

describe('T36-4 刻意分歧的地方要留紀錄', () => {
  test('⭐ 這裡是 roles 陣列，不是 FC 的單一 role 字串', () => {
    // 現場一個人真的會同時是記錄員與裁判，而且賽務角色還有「指派場地」
    // 這個維度，壓不成 FC 的單一字串。
    // 這一條沒有斷言可寫，用文件本身當證據：config.js 必須寫明這件事，
    // 免得下一個人以為是漏抄。
    // fileURLToPath：Windows 上 new URL().pathname 會是 /D:/…，
    // 丟給 fs 會 ENOENT（tests/unit/icons.test.js 踩過同一個坑）
    const src = fs.readFileSync(fileURLToPath(new URL('../../js/config.js', import.meta.url)), 'utf8');
    expect(src).toContain('FC-Football');
    expect(src).toContain('staff/{uid}.roles');
    expect(src).toMatch(/只用來排序與顯示/);
  });

  test('FC 有、這裡用不到的角色仍保留在字典裡（對接時要看得懂）', () => {
    for (const k of ['coach', 'venue_owner', 'user']) expect(ROLE_INFO).toHaveProperty(k);
  });
});
