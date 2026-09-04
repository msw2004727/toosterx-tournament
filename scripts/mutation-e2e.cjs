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
  }
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'npx playwright test tests/e2e/demo-switch.spec.js tests/e2e/my-home.spec.js tests/e2e/admin-perms.spec.js --project=chromium-mobile --reporter=dot',
  title: '前端時序｜E2E 變異測試'
}));
