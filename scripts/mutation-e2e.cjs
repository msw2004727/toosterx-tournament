#!/usr/bin/env node
/**
 * 變異測試｜只有 E2E 抓得到的那幾條
 * ------------------------------------------------------------------
 * 有些缺陷是「畫面層的時序」，純函式測不到：
 *   ・切換身分之後沒有重載身分 → 權限停在 null
 *   ・身分卡的名字沒有退回 staff.name → 顯示「（沒有名稱）」
 * 這些只有真的跑一次瀏覽器才驗得出來，所以另外開一支執行器。
 *
 * ⚠️ 只跑**目標 spec 的單一寬度**（每條約 5 秒）。跑整套 E2E 的話
 *    一條變異要三分鐘，沒有人會等——而不會有人跑的測試等於沒有測試。
 *
 *   node scripts/mutation-e2e.cjs
 */
const { runMutants } = require('./lib/mutate.cjs');

const MUTANTS = [
  {
    name: '#E1 切換身分後寫完 staff 不重載身分（切了卻一個權限都沒有）',
    file: 'js/modules/demo/index.js',
    from: `  await reloadIdentity();`,
    to: ``
  },
  {
    name: '#E2 身分卡不退回 staff 名字（demo 匿名帳號顯示「沒有名稱」）',
    file: 'js/modules/account/my.js',
    from: `const name = state.profile?.displayName || u.displayName || s?.name || '（沒有名稱）';`,
    to: `const name = state.profile?.displayName || u.displayName || '（沒有名稱）';`
  },
  {
    name: '#E3 專屬首頁不依權限過濾功能（每個人都看到全部入口）',
    file: 'js/modules/account/my.js',
    from: `    const mine = FEATURES.filter(f => can(f.code));`,
    to: `    const mine = FEATURES;`
  },
  {
    name: '#E4 ⭐ 權限開關整份覆蓋（同一個角色其他權限被靜靜抹掉）',
    file: 'js/modules/admin/data.js',
    from: `  }, { merge: true });`,
    to: `  });`
  },
  {
    name: '#E5 ⭐ 替身 SDK 的 merge 退回淺層（會證明「整份覆蓋」是對的）',
    file: 'tests/e2e/fake-firebase.js',
    from: `    store.set(ref.path, opts?.merge ? deepMerge(store.get(ref.path) || {}, next) : next);`,
    to: `    store.set(ref.path, opts?.merge ? { ...(store.get(ref.path) || {}), ...next } : next);`
  },
  {
    // 以下三條：can() **有呼叫**，但結果被忽略。靜態掃描（T42-8）看不出來，
    // 只有真的跑一次瀏覽器、確認「關掉之後按鈕不見了」才抓得到。
    name: '#E6 ⭐ 問了 match.finish 卻不理結果（關掉之後按鈕照樣在）',
    file: 'js/modules/staff/live.js',
    from: `    if (!can('match.finish')) {`,
    to: `    if (!can('match.finish') && false) {`
  },
  {
    name: '#E7 ⭐ 問了 matchsheet.write 卻永遠放行',
    file: 'js/modules/staff/sheet.js',
    from: `    const mayEdit = can('matchsheet.write');`,
    to: `    const mayEdit = can('matchsheet.write') || true;`
  },
  {
    name: '#E8 ⭐ 問了 member.read 卻永遠顯示個資',
    file: 'js/modules/staff/checkin.js',
    from: `          can('member.read')`,
    to: `          can('member.read') || true`
  },
  {
    name: '#E9 ⭐ 檢錄名單不把球員排前面（檢錄員先看到三位大人）',
    file: 'js/modules/staff/checkin-data.js',
    from: `  return sortForCheckin(rows);`,
    to: `  return rows;`
  },
  {
    // 以下兩條改的是**替身**：替身行為與真的 Firestore 不一致時，
    // 它會主動證明錯的東西是對的（2026-09-04 的 merge 與排序都中過）。
    name: '#E10 ⭐ 替身把 null 排最大（真 Firestore 是最小，會蓋掉排序缺陷）',
    file: 'tests/e2e/fake-firebase.js',
    from: `  if (a == null) return -1;
  if (b == null) return 1;`,
    to: `  if (a == null) return 1;
  if (b == null) return -1;`
  },
  {
    name: '#E11 ⭐ 替身不懂 Timestamp（orderBy 時間完全沒有作用）',
    file: 'tests/e2e/fake-firebase.js',
    from: `  if (v && typeof v.seconds === 'number') return v.seconds * 1000 + (v.nanoseconds ?? 0) / 1e6;`,
    to: ``
  },
  {
    name: '#E12 ⭐ 稽核的名字只查 users（腳本建的總管與自助身分印 uid）',
    file: 'js/modules/admin/data.js',
    from: `  for (const d of staff?.docs ?? []) if (d.data().name) people[d.id] = d.data().name;`,
    to: ``
  },
  {
    name: '#E13 ⭐ 報名開關重畫時不把打到一半的日期傳回去（空白的截止日永遠填不進去）',
    file: 'js/modules/admin/registration.js',
    from: `        parts: state.parts[dateKey],
`,
    to: ``
  },
  {
    name: '#E14 ⭐ 報名開關重畫後不還原焦點（打「24」變成打了「2」就得再點一次）',
    file: 'js/modules/admin/registration.js',
    from: `    restoreFocus(focusId, caret);`,
    to: ``
  },
  {
    name: '#E15 ⭐ 我報名的球員少了 where guardianUid（替身會列出別人家的小孩；真的 Firestore 整個查詢被擋）',
    file: 'js/modules/account/my.js',
    from: `        collectionGroup(db(), 'members'),
        where('guardianUid', '==', u.uid)
      ));`,
    to: `        collectionGroup(db(), 'members')
      ));`
  },
  {
    name: '#E16 ⭐ 逾時的申訴不先講後果就受理（規章第二十條的 30 分鐘在畫面上形同虛設）',
    file: 'js/modules/admin/match.js',
    from: `    if (w.ready && !w.withinWindow) {`,
    to: `    if (false) {`
  },
  {
    name: '#E17 ⭐ 沒有憑證的卡也畫聯絡方式表單（送出一定失敗，玩家以為系統壞了）',
    file: 'js/modules/challenge/me.js',
    from: `    const hasKey = !!pass.contactKey;`,
    to: `    const hasKey = true;`
  }
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'npx playwright test tests/e2e/demo-switch.spec.js tests/e2e/my-home.spec.js tests/e2e/admin-perms.spec.js tests/e2e/perm-effect.spec.js tests/e2e/checkin.spec.js tests/e2e/admin-audits.spec.js tests/e2e/admin-registration.spec.js tests/e2e/admin-match.spec.js tests/e2e/challenge.spec.js --project=chromium-mobile --reporter=dot',
  title: '前端時序｜E2E 變異測試'
}));
