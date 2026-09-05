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
  },

  // ══ 驗收整合修正（2026-09-06）：tests/e2e/audit-fixes.spec.js ＋ admin-match ＋ admin-schedule ══
  {
    name: '#E18 ⭐ 檢錄台讀回不存在的 homeTeamId（名單永遠載不出來；驗收 D-01）',
    file: 'js/modules/staff/checkin.js',
    from: `      const teamId = state.match?.[side]?.teamId;`,
    to: `      const teamId = state.match?.[side + 'TeamId'];`
  },
  {
    name: '#E19 ⭐ 登入頁先訂閱再看 user()（已登入時 onAuth 的同步回呼撞到 TDZ，整頁空白；D-02）',
    file: 'js/modules/account/login.js',
    from: `  if (user()) { navigate(next); return; }
  const off = onAuth(u => { if (u) { off(); navigate(next); } });`,
    to: `  const off = onAuth(u => { if (u) { off(); navigate(next); } });
  if (user()) return;`
  },
  {
    name: '#E20 ⭐ 現場代建不把輸入區歸零（0 分送不出去；D-04）',
    file: 'js/modules/booth/booth.js',
    from: `    state.attempts = [];
    resetInput();`,
    to: `    state.attempts = [];`
  },
  {
    name: '#E21 ⭐ 攤位「最近登錄」的 onError 吞掉（缺索引時整區靜靜消失；D-03）',
    file: 'js/modules/booth/booth.js',
    from: `      err => { console.warn('[booth] 最近登錄', err); state.recentError = data.explain(err, '讀不到最近登錄的清單。'); render(); });`,
    to: `      () => {});`
  },
  {
    name: '#E22 ⭐ 已開打仍可重新抽籤（草稿一產生就覆蓋已打完的分組；D-09）',
    file: 'js/modules/admin/schedule.js',
    from: `          class: 'btn btn--lg', type: 'button', disabled: !!state.busy || !canRegenerate(existing()).ok,`,
    to: `          class: 'btn btn--lg', type: 'button', disabled: !!state.busy,`
  },
  {
    name: '#E23 ⭐ 棄賽鈕反灰不說原因（D-12）',
    file: 'js/modules/admin/match.js',
    from: `            !woG.ok ? el('p', { class: 'adm__permMeta', id: 'walkover-reason', text: woG.reason }) : null,`,
    to: `            null,`
  },
  {
    name: '#E24 ⭐ 賽務首頁的檢錄鈕不看權限（攤位人員按了只會看到沒有權限；D-13）',
    file: 'js/modules/staff/home.js',
    from: `    if (can('checkin.write')) {`,
    to: `    if (true) {`
  },
  {
    name: '#E25 ⭐ 404 不換分頁標題（D-14）',
    file: 'js/core/router.js',
    from: `    document.title = '找不到頁面｜FEDA CUP 2026';
`,
    to: ``
  },
  {
    name: '#E26 ⭐ 單節組別也印「半場 x-y」（D-07）',
    file: 'js/modules/public/match.js',
    from: `    const ht = (state.division?.periods ?? 2) > 1 && m.htScore && m.htScore.home != null`,
    to: `    const ht = m.htScore && m.htScore.home != null`
  },
  {
    name: '#E27 ⭐ 主題切換鈕退回 34px（320px 上點不到；D-15）',
    file: 'css/components.css',
    from: `  min-height:var(--tap);min-width:var(--tap);padding:0 10px;border-radius:var(--r-full);`,
    to: `  min-height:34px;padding:0 10px;border-radius:var(--r-full);`
  },
  {
    name: '#E28 ⭐ 重開不讀事件流（timeline 打到下半場也退回第一期；D-06）',
    file: 'js/modules/admin/match.js',
    from: `      patch: buildReopenPatch(user()?.uid, events),`,
    to: `      patch: buildReopenPatch(user()?.uid),`
  },
  {
    name: '#E29 ⭐ 賽務台的球員選單也列出教練（D-08）',
    file: 'js/modules/staff/live.js',
    from: `      if (!isPlayerRow(p)) return false;          // 教練不會進球，也不會吃牌（驗收 D-08）
`,
    to: ``
  },
  {
    name: '#E30 ⭐ 名冊不重排（Firestore 把沒背號的隊職員排在最前面；D-08）',
    file: 'js/modules/staff/data.js',
    from: `  return sortRosterForMatch(snap.docs.map(d => ({ memberId: d.id, ...d.data() })));`,
    to: `  return snap.docs.map(d => ({ memberId: d.id, ...d.data() }));`
  },
  {
    name: '#E31 ⭐ 出場名單給隊職員畫先發／替補鈕（D-08）',
    file: 'js/modules/staff/sheet.js',
    from: `      if (!isPlayerRow(p)) {`,
    to: `      if (false) {`
  }
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'npx playwright test tests/e2e/demo-switch.spec.js tests/e2e/my-home.spec.js tests/e2e/admin-perms.spec.js tests/e2e/perm-effect.spec.js tests/e2e/checkin.spec.js tests/e2e/admin-audits.spec.js tests/e2e/admin-registration.spec.js tests/e2e/admin-match.spec.js tests/e2e/challenge.spec.js tests/e2e/admin-schedule.spec.js tests/e2e/audit-fixes.spec.js --project=chromium-mobile --reporter=dot',
  title: '前端時序｜E2E 變異測試'
}));
