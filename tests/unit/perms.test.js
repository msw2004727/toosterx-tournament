/**
 * T42 角色階層與權限矩陣
 * ------------------------------------------------------------------
 * 主辦 2026-09-03 指定：**向上包含**
 *
 *   挑戰攤位 < 檢錄員 < 裁判 < 記錄員 < 管理員 < 總管
 *
 * 加上「每一個獨立功能都要有權限開關，總管可以手動開關」。
 *
 * 這一組守的東西全部是「錯了也跑得動」的：多給一階不會報錯，
 * 少給一階只是按鈕不見了——兩種都要等到現場才會被發現。
 */

import { createRequire } from 'node:module';
import {
  ROLE_INFO, STAFF_CHAIN, impliedRoles, hasRoleAtLeast, topRole,
  PERMISSIONS, PERMISSION_BY_CODE, PERMISSION_GROUPS,
  defaultPermsOf, effectivePerms, FEATURES
} from '../../js/config.js';
import { editableRole } from '../../js/engine/perms.js';

const require = createRequire(import.meta.url);

const perms = (roles, matrix) => [...effectivePerms(roles, matrix)];

describe('T42-1 繼承鏈', () => {
  test('⭐ 順序就是主辦指定的那一條', () => {
    expect(STAFF_CHAIN).toEqual(['booth', 'checkin', 'referee', 'scorer', 'admin', 'super_admin']);
  });

  test('⭐ 高階展開成鏈上所有更低的角色', () => {
    expect(impliedRoles(['scorer'])).toEqual(['booth', 'checkin', 'referee', 'scorer']);
    expect(impliedRoles(['checkin'])).toEqual(['booth', 'checkin']);
    expect(impliedRoles(['booth'])).toEqual(['booth']);
    expect(impliedRoles(['super_admin'])).toEqual(STAFF_CHAIN);
  });

  test('多個角色取最高的那一個展開', () => {
    expect(impliedRoles(['booth', 'admin'])).toEqual(['booth', 'checkin', 'referee', 'scorer', 'admin']);
    expect(impliedRoles(['scorer', 'checkin'])).toEqual(['booth', 'checkin', 'referee', 'scorer']);
  });

  test('⭐ 鏈外的角色原樣保留，不會被展開', () => {
    // venue_owner 是 FC 的角色、level 3，數值正好夾在記錄員(2.4)與
    // 管理員(4)之間。若用 level 比大小，一個從 FC 同步過來的「場主」
    // 會自動拿到記錄員的全部權限——那個人可能只是租場地的老闆。
    expect(impliedRoles(['venue_owner'])).toEqual(['venue_owner']);
    expect(impliedRoles(['captain'])).toEqual(['captain']);
    expect(impliedRoles(['coach'])).toEqual(['coach']);
  });

  test('⭐ 完全不認識的角色不會被當成任何身分', () => {
    expect(impliedRoles(['wizard'])).toEqual(['wizard']);
    expect(hasRoleAtLeast(['wizard'], 'booth')).toBe(false);
  });

  test('鏈上的角色與鏈外的可以並存', () => {
    expect(impliedRoles(['captain', 'checkin'])).toEqual(['booth', 'checkin', 'captain']);
  });

  test('空的或壞掉的輸入不會爆', () => {
    expect(impliedRoles()).toEqual([]);
    expect(impliedRoles([])).toEqual([]);
    expect(impliedRoles(null)).toEqual([]);
    expect(impliedRoles('scorer')).toEqual([]);      // 字串不是陣列
  });

  test('hasRoleAtLeast 認得繼承來的身分', () => {
    expect(hasRoleAtLeast(['scorer'], 'checkin')).toBe(true);
    expect(hasRoleAtLeast(['checkin'], 'scorer')).toBe(false);
    expect(hasRoleAtLeast(['admin'], 'booth')).toBe(true);
  });
});

describe('T42-2 level 與階層一致（但只用來顯示）', () => {
  test('⭐ 鏈上的 level 由低到高遞增', () => {
    const levels = STAFF_CHAIN.map(r => ROLE_INFO[r].level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  test('⭐ 主辦指定的順序：裁判 < 記錄員', () => {
    // 這是 2026-09-03 的調整。改動前 referee(2.6) > scorer(2.4)。
    expect(ROLE_INFO.referee.level).toBeLessThan(ROLE_INFO.scorer.level);
    expect(ROLE_INFO.booth.level).toBeLessThan(ROLE_INFO.checkin.level);
    expect(ROLE_INFO.checkin.level).toBeLessThan(ROLE_INFO.referee.level);
  });

  test('topRole 拿最高的（顯示身分用）', () => {
    expect(topRole(['booth', 'scorer'])).toBe('scorer');
    expect(topRole(['referee', 'checkin'])).toBe('referee');
  });
});

describe('T42-3 預設權限（依 minRole ＋ 繼承）', () => {
  test('⭐ 挑戰攤位只有一項', () => {
    expect(defaultPermsOf('booth')).toEqual(['challenge.attempt.write']);
  });

  test('⭐ 檢錄員拿得到挑戰攤位的，加上檢錄與看個資', () => {
    const p = perms(['checkin']);
    expect(p).toContain('challenge.attempt.write');
    expect(p).toContain('checkin.write');
    expect(p).toContain('member.read');
    expect(p).not.toContain('matchsheet.write');
  });

  test('⭐ 裁判多了出場名單，但記不了分', () => {
    const p = perms(['referee']);
    expect(p).toContain('matchsheet.write');
    expect(p).not.toContain('match.score.write');
    expect(p).not.toContain('match.period');
  });

  test('⭐ 記錄員記得了分，但覆核不了', () => {
    // 覆核是「第二雙眼睛」，記分的人自己覆核自己等於沒有覆核
    const p = perms(['scorer']);
    expect(p).toContain('match.score.write');
    expect(p).toContain('match.finish');
    expect(p).toContain('match.period');
    expect(p).not.toContain('match.confirm');
  });

  test('⭐ 管理員覆核得了，但發不了身分', () => {
    const p = perms(['admin']);
    expect(p).toContain('match.confirm');
    expect(p).toContain('team.manage');
    expect(p).not.toContain('staff.assign');
    expect(p).not.toContain('perms.manage');
  });

  test('⭐ 總管拿到全部', () => {
    expect(perms(['super_admin'])).toHaveLength(PERMISSIONS.length);
  });

  test('⭐ 沒有身分的人一項都沒有', () => {
    expect(perms([])).toEqual([]);
    expect(perms(['user'])).toEqual([]);
    expect(perms(['captain'])).toEqual([]);
    expect(perms(['venue_owner'])).toEqual([]);
  });

  test('⭐ 權限數量隨階層嚴格遞增', () => {
    // 「層級越高權限越大功能越多」——主辦的原話。
    // 兩階一樣多就代表中間那一階沒有存在的意義。
    const counts = STAFF_CHAIN.map(r => effectivePerms([r]).size);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeGreaterThan(counts[i - 1]);
    }
  });

  test('⭐ 低階的權限一定是高階的子集', () => {
    for (let i = 1; i < STAFF_CHAIN.length; i++) {
      const lower = effectivePerms([STAFF_CHAIN[i - 1]]);
      const higher = effectivePerms([STAFF_CHAIN[i]]);
      for (const code of lower) expect(higher.has(code)).toBe(true);
    }
  });
});

describe('T42-4 總管的逐條開關', () => {
  test('關掉一條，那個角色就沒有', () => {
    const m = { scorer: { perms: { 'match.finish': false } } };
    expect(perms(['scorer'], m)).not.toContain('match.finish');
    expect(perms(['scorer'], m)).toContain('match.score.write');   // 其他不受影響
  });

  test('開啟一條原本沒有的（把權限往下放）', () => {
    const m = { referee: { perms: { 'match.score.write': true } } };
    expect(perms(['referee'], m)).toContain('match.score.write');
  });

  test('⭐ 開與關同時出現時「開」優先', () => {
    // 一個人身兼兩個角色、其中一個被關掉某項時，不該讓他比單一角色更弱。
    // 反過來設計（關優先）會讓「多給一個身分」變成一種懲罰。
    const m = { checkin: { perms: { 'checkin.write': false } }, scorer: { perms: { 'checkin.write': true } } };
    expect(perms(['scorer'], m)).toContain('checkin.write');
  });

  test('⭐ 總管不受開關影響（不然會把自己鎖在門外）', () => {
    // 「調整權限開關」本身也是一條權限。關掉之後就再也打不開了。
    const m = { super_admin: { perms: { 'perms.manage': false, 'staff.assign': false } } };
    expect(perms(['super_admin'], m)).toHaveLength(PERMISSIONS.length);
  });

  test('⭐ 讀不到矩陣時走預設，不是全部關閉', () => {
    // 全部關閉的話，設定讀取失敗的當下賽務的按鈕會全部消失，
    // 現場會以為系統壞了。真正的防線是 rules，不是這份矩陣。
    for (const m of [undefined, null, {}, { scorer: {} }, { scorer: { perms: null } }]) {
      expect(perms(['scorer'], m)).toContain('match.score.write');
    }
  });

  test('矩陣裡不認識的權限碼會被忽略', () => {
    const m = { scorer: { perms: { 'nuke.everything': true } } };
    expect(perms(['scorer'], m)).not.toContain('nuke.everything');
  });
});

describe('T42-5 權限與功能清單的一致性', () => {
  test('權限碼不重複', () => {
    const codes = PERMISSIONS.map(p => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('每一條的 minRole 都在鏈上', () => {
    for (const p of PERMISSIONS) expect(STAFF_CHAIN).toContain(p.minRole);
  });

  test('每一條都有分組，而且分組在顯示順序裡', () => {
    for (const p of PERMISSIONS) expect(PERMISSION_GROUPS).toContain(p.group);
  });

  test('⭐ 專屬首頁的每一個功能都對得到權限碼', () => {
    // 對不到的話那顆按鈕會永遠不出現，而且不會有任何錯誤
    for (const f of FEATURES) expect(PERMISSION_BY_CODE[f.code]).toBeDefined();
  });

  test('⭐ 破壞性操作要標記出來（它們同時寫在 firestore.rules）', () => {
    const must = ['match.score.write', 'match.finish', 'match.confirm',
                  'match.score.override', 'staff.assign', 'perms.manage'];
    for (const code of must) expect(PERMISSION_BY_CODE[code].destructive).toBe(true);
  });

  test('唯讀類的不該被標成破壞性', () => {
    expect(PERMISSION_BY_CODE['audit.read'].destructive).toBeUndefined();
    expect(PERMISSION_BY_CODE['member.read'].destructive).toBeUndefined();
  });
});

describe('T42-6 種子資料與程式碼的權限矩陣一致', () => {
  test('⭐ config/rolePermissions 的初始值就是預設權限', async () => {
    // 手寫第二份會分岔，而分岔不會有錯誤訊息：介面依 can() 畫按鈕，
    // 資料庫那份被讀出來覆寫，兩邊不一樣時看起來只像「權限怪怪的」。
    // 2026-09-03 之前就是分岔的（裁判有覆核權、沒有 checkin 這個角色）。
    const { buildSeed } = await import('../../scripts/seed/build.js');
    const docs = buildSeed().docs.filter(d => d.path.startsWith('rolePermissions/'));

    expect(docs.map(d => d.path.split('/')[1]).sort()).toEqual([...STAFF_CHAIN].sort());
    for (const d of docs) {
      const role = d.path.split('/')[1];
      expect(Object.keys(d.data.perms).sort()).toEqual([...defaultPermsOf(role)].sort());
    }
  });

  test('種子裡沒有萬用字元權限（`*` 不是一條真的權限碼）', async () => {
    const { buildSeed } = await import('../../scripts/seed/build.js');
    const docs = buildSeed().docs.filter(d => d.path.startsWith('rolePermissions/'));
    for (const d of docs) expect(Object.keys(d.data.perms)).not.toContain('*');
  });
});

describe('T42-7 使用者名錄（身分授權那一頁列的就是它）', () => {
  test('⭐ 每一筆都有名字', async () => {
    // `onTeamWritten` 會把 teamCount 寫進 users/{captainUid}，
    // 所以隊長的文件本來就會存在——種子不補名字的話，
    // 身分授權頁在 demo 上會出現三十幾列只有一串 uid 的空白項目。
    const { buildSeed } = await import('../../scripts/seed/build.js');
    const users = buildSeed().docs.filter(d => d.path.startsWith('users/'));
    const nameless = users.filter(d => !d.data.displayName).map(d => d.path);
    expect(nameless).toEqual([]);
  });

  test('⭐ 每一位隊長都在名錄裡', async () => {
    const { buildSeed } = await import('../../scripts/seed/build.js');
    const { docs } = buildSeed();
    const uids = new Set(docs.filter(d => d.path.startsWith('users/')).map(d => d.data.uid));
    const captains = docs
      .filter(d => /\/teams\/[^/]+$/.test(d.path) && d.data.captainUid)
      .map(d => d.data.captainUid);
    expect(captains.length).toBeGreaterThan(0);
    for (const c of captains) expect(uids).toContain(c);
  });

  test('留幾位「登入過但還沒有身分」的人（不然那一頁示範不到主要動作）', async () => {
    const { buildSeed } = await import('../../scripts/seed/build.js');
    const { docs } = buildSeed();
    const staffUids = new Set(docs.filter(d => d.path.startsWith('staff/')).map(d => d.data.uid));
    const unassigned = docs
      .filter(d => d.path.startsWith('users/') && !staffUids.has(d.data.uid));
    expect(unassigned.length).toBeGreaterThan(0);
  });
});

describe('T42-8 ⭐ 權限碼與實際用法必須對得起來', () => {
  // 2026-09-04 在真站上實測抓到：主辦把 `match.finish` 關掉之後，
  // 賽務台的「完賽送出」按鈕**照樣在**——因為那一頁從來沒問過 can()。
  //
  // 一條沒有人讀的權限碼，在權限開關那一頁就是一個按了不會有效果的切換。
  // 所以 `pending: true` 的意思被釘死成「真的沒有任何畫面在讀它」，
  // 兩邊一分岔就撞紅：功能接上 can() 卻忘了拿掉旗標會紅，
  // 加了一條權限卻忘了接也會紅。
  const { usageByCode } = require('../../scripts/perm-usage.cjs');
  const usage = usageByCode(PERMISSIONS.map(p => p.code));

  test('⭐ 沒標 pending 的，一定有畫面在讀', () => {
    const broken = PERMISSIONS
      .filter(p => !p.pending && usage[p.code].length === 0)
      .map(p => p.code);
    expect(broken).toEqual([]);
  });

  test('⭐ 標了 pending 的，一定沒有畫面在讀', () => {
    const stale = PERMISSIONS
      .filter(p => p.pending && usage[p.code].length > 0)
      .map(p => `${p.code}（已接上 ${usage[p.code].join(', ')}，請拿掉 pending）`);
    expect(stale).toEqual([]);
  });

  test('pending 的那幾條在權限開關頁上不可調整', () => {
    for (const p of PERMISSIONS.filter(x => x.pending)) {
      expect(editableRole(p, p.minRole).ok).toBe(false);
    }
  });
});
