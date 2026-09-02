/**
 * firestore.rules 的變異測試（需要 Firestore Emulator）
 * ------------------------------------------------------------------
 * 執行：npm run test:mutation:rules
 *   （外層由 firebase emulators:exec 起一次 Emulator，這裡只跑 jest）
 *
 * 權限規則是最容易寫出「假守衛」的地方：放寬一條線，happy path 完全不受影響，
 * 測試照樣全綠，只有真正被攻擊的那一天才會知道。所以每一條權限邊界都要
 * 反向驗證一次——把它拆掉，看有沒有測試會紅。
 */
const { runMutants } = require('./lib/mutate.cjs');

const F = 'firestore.rules';

const MUTANTS = [
  {
    name: 'RU#1 身分改回 Admin 也能寫（Admin 可以把自己升成大總管）',
    file: F,
    from: `      allow create: if isSuperAdmin() && staffRolesAssignable(request.resource.data);`,
    to: `      allow create: if isAdmin();\n      allow update: if isAdmin();`
  },
  {
    name: 'RU#2 角色白名單含 super_admin（介面就能造出第二個大總管）',
    file: F,
    from: `          && d.roles.hasOnly(['scorer', 'referee', 'booth', 'admin']);`,
    to: `          && d.roles.hasOnly(['scorer', 'referee', 'booth', 'admin', 'super_admin']);`
  },
  {
    name: 'RU#3 報名設定讀不到就當開著（fail-open）',
    file: F,
    from: `      return exists(p)
        && get(p).data.get('open', false) == true`,
    to: `      return !exists(p)
        || get(p).data.get('open', false) == true`
  },
  {
    name: 'RU#4 報名只看 open 旗標，不看起訖日（過了截止日照樣能報）',
    file: F,
    from: `        && (get(p).data.get('opensAt', null) == null || request.time >= get(p).data.opensAt)
        && (get(p).data.get('closesAt', null) == null || request.time <= get(p).data.closesAt);`,
    to: `        && true;`
  },
  {
    name: 'RU#5 建隊不檢查 captainUid 是不是自己（可以冒名建隊）',
    file: F,
    from: `                      && request.resource.data.captainUid == uid()
                      && request.resource.data.status == 'draft'`,
    to: `                      && request.resource.data.status == 'draft'`
  },
  {
    name: 'RU#6 隊長的欄位白名單多了 rosterLocked（送出後自己把鎖打開）',
    file: F,
    from: `                            'announcement', 'status', 'captainUid', 'captainName',
                            'submittedAt', 'updatedAt', 'updatedBy'])`,
    to: `                            'announcement', 'status', 'captainUid', 'captainName',
                            'submittedAt', 'updatedAt', 'updatedBy', 'rosterLocked'])`
  },
  {
    name: 'RU#7 凍結只看 rosterLocked，不看 status（送出後名單還能改）',
    file: F,
    from: `        return !(t.get('status', 'draft') in ['draft', 'rejected'])
            || t.get('rosterLocked', false) == true;`,
    to: `        return t.get('rosterLocked', false) == true;`
  },
  {
    name: 'RU#8 加入申請不強制 pending（申請人自己核准自己）',
    file: F,
    from: `                        && request.resource.data.status == 'pending'
                        && regOpen()`,
    to: `                        && regOpen()`
  },
  {
    name: 'RU#9 名單可以刪除（移除應該是改 status，不是刪文件）',
    file: F,
    from: `          // 移除是把 status 改成 'removed'，不刪文件（docs/10 §4）
          allow delete: if false;`,
    to: `          allow delete: if isAdmin();`
  },
  {
    name: 'RU#10 名單開放給所有登入者讀（生日與身分證後四碼在這份文件上）',
    file: F,
    from: `          allow read: if isScorer()
                      || isCaptainOf(teamId)
                      || (isAuth() && resource.data.get('guardianUid', '') == uid());`,
    to: `          allow read: if isAuth();`
  },
  {
    name: 'RU#11 users 允許自帶 roles（登入時就能自稱 admin）',
    file: F,
    from: `                         && !('roles' in request.resource.data) );`,
    to: `                         && true );`
  },
  {
    name: 'RU#12 隊長的狀態機允許 approved（自己核准自己的報名）',
    file: F,
    from: `        return (from == 'draft'     && to in ['draft', 'submitted'])
            || (from == 'submitted' && to in ['submitted', 'draft'])`,
    to: `        return (from == 'draft'     && to in ['draft', 'submitted'])
            || (from == 'submitted' && to in ['submitted', 'draft', 'approved'])`
  }
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/firestore-rules/ --silent',
  title: 'firestore.rules｜變異測試'
}));
