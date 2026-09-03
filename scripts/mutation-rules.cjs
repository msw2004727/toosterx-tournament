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
    from: `          && d.roles.hasOnly(['scorer', 'referee', 'checkin', 'booth', 'admin']);`,
    to: `          && d.roles.hasOnly(['scorer', 'referee', 'checkin', 'booth', 'admin', 'super_admin']);`
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
    from: `                             ( request.resource.data.get('guardianUid', '') == uid()
                               && request.resource.data.status == 'pending' )`,
    to: `                             ( request.resource.data.get('guardianUid', '') == uid() )`
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
    from: `          allow read: if isCheckin()
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
  },
  {
    name: 'RU#13 教練直接新增不檢查是不是隊長（任何人都能塞人進別人的名單）',
    file: F,
    from: `                             || ( isCaptainOf(teamId) && coachAddedMemberOk() )`,
    to: `                             || ( isAuth() && coachAddedMemberOk() )`
  },
  {
    name: 'RU#14 教練新增的那筆不檢查 addedBy（可冒他人名義新增）',
    file: F,
    from: `            && request.resource.data.get('addedBy', '') == uid()`,
    to: ``
  },
  {
    name: 'RU#15 教練新增的那筆允許帶 guardianUid（那位家長就能改這筆）',
    file: F,
    from: `            && request.resource.data.get('guardianUid', null) == null;`,
    to: `            ;`
  },
  {
    name: 'RU#16 隊長改得動家長填的內容（不再只能同意／婉拒）',
    file: F,
    from: `        return resource.data.get('source', '') == 'coach'
            && !rosterFrozen(tid)`,
    to: `        return !rosterFrozen(tid)`
  },
  {
    name: 'RU#17 編輯順手改得動 status（removed 的人可以被放回名單）',
    file: F,
    from: `            && unchanged('status')
            && onlyChanged(['name', 'birthDate', 'idLast4', 'jerseyNo',`,
    to: `            && onlyChanged(['status', 'name', 'birthDate', 'idLast4', 'jerseyNo',`
  },
  {
    name: 'RU#18 名單凍結後隊長還能編輯自己填的那幾筆',
    file: F,
    from: `      function coachMemberEditOk(tid) {
        return resource.data.get('source', '') == 'coach'
            && !rosterFrozen(tid)`,
    to: `      function coachMemberEditOk(tid) {
        return resource.data.get('source', '') == 'coach'`
  },
  {
    name: 'RU#19 檢錄併進 isScorer（每個檢錄志工都能改比分）',
    file: F,
    from: `    function isScorer()     { return myRoles().hasAny(['admin', 'super_admin',
                                                        'scorer', 'referee']); }`,
    to: `    function isScorer()     { return myRoles().hasAny(['admin', 'super_admin',
                                                        'scorer', 'referee', 'checkin']); }`
  },
  {
    name: 'RU#20 檢錄不檢查 scannedBy 是自己（可冒名記檢錄）',
    file: F,
    from: `        allow create: if isCheckin()
                      && request.resource.data.scannedBy == uid()`,
    to: `        allow create: if isCheckin()`
  },
  {
    name: 'RU#21 檢錄文件 id 可以自訂（同場同人會出現兩筆結果不同的紀錄）',
    file: F,
    from: `                      && checkinId == request.resource.data.matchId + '__'
                                      + request.resource.data.memberId;`,
    to: `                      ;`
  },
  {
    name: 'RU#22 檢錄紀錄可以刪除（誰放行了誰查不到）',
    file: F,
    from: `        allow update: if isAdmin()
                      || ( isCheckin()
                           && onlyChanged(['result', 'failReason', 'note',
                                           'method', 'scannedBy', 'scannedAt', 'syncedAt'])
                           && request.resource.data.scannedBy == uid() );
        allow delete: if false;
      }

      match /venues/{venueId} {`,
    to: `        allow update: if isAdmin()
                      || ( isCheckin()
                           && onlyChanged(['result', 'failReason', 'note',
                                           'method', 'scannedBy', 'scannedAt', 'syncedAt'])
                           && request.resource.data.scannedBy == uid() );
        allow delete: if isCheckin();
      }

      match /venues/{venueId} {`
  },
  {
    name: 'RU#23 檢錄修改的欄位白名單放行 memberId（等於偽造另一筆）',
    file: F,
    from: `                           && onlyChanged(['result', 'failReason', 'note',
                                           'method', 'scannedBy', 'scannedAt', 'syncedAt'])`,
    to: `                           && onlyChanged(['result', 'failReason', 'note', 'memberId', 'matchId',
                                           'method', 'scannedBy', 'scannedAt', 'syncedAt'])`
  },
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/firestore-rules/ --silent',
  title: 'firestore.rules｜變異測試'
}));
