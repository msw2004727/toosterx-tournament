/**
 * 變異測試：把每個修好的缺陷「改回錯的」，確認測試真的抓得到。
 *
 * 一個「跑得綠」的測試套件不代表它有鑑別力。審查時已證實原本的 115 個測試
 * 完全抓不到其中三個缺陷，所以每補一個修正就必須反向驗證一次。
 *
 * 用法：node scripts/mutation-check.cjs
 */
const { runMutants } = require('./lib/mutate.cjs');

const MUTANTS = [
  {
    name: '#1 用 Number() 判比分（null → 0，會判成 0:0 平手）',
    file: 'js/engine/tally.js',
    from: `return typeof v === 'number' && Number.isFinite(v) ? v : null;`,
    to: `const n = Number(v); return Number.isFinite(n) ? n : null;`
  },
  {
    name: '#2 行為分分堆鍵不含 matchId（跨場合併）',
    file: 'js/engine/ranking.js',
    from: `const key = [c.matchId ?? '?', team, c.playerId ?? 'unknown'].join('|');`,
    to: `const key = [team, c.playerId ?? 'unknown'].join('|');`
  },
  {
    name: '#2b 用 seq 原始值判斷紅牌前是否有黃牌',
    file: 'js/engine/ranking.js',
    from: `    const priorYellow = list
      .slice(0, redAt)
      .some(c => c.cardType === 'yellow' || c.cardType === 'second_yellow');`,
    to: `    const red = list[redAt];
    const priorYellow = list.some(c =>
      (c.cardType === 'yellow' || c.cardType === 'second_yellow') &&
      (c.seq ?? 0) < (red.seq ?? 0));`
  },
  {
    name: '#3 ready 不算可寫入狀態（解算後就再也重跑不了）',
    file: 'js/engine/advancement.js',
    from: `const WRITABLE_STATUSES = ['scheduled', 'checkin', 'ready'];`,
    to: `const WRITABLE_STATUSES = ['scheduled', 'checkin'];`
  },
  {
    name: '#4 重算不沿用人工裁定',
    file: 'js/engine/standing.js',
    from: `  const pins = manualPins ?? (manualOverride.enabled ? manualPinsOf(prev) : null);`,
    to: `  const pins = manualPins ?? null;`
  },
  {
    name: '#5 canResolve 缺資料時放行（fail-open）',
    file: 'js/engine/advancement.js',
    from: `  if (!Array.isArray(stageMatches) || stageMatches.length === 0) {`,
    to: `  if (false) {`
  },
  {
    name: '#6 mercyRule 的 cap 沒有下限',
    file: 'js/engine/tally.js',
    from: `    const cap = Math.max(1, Math.trunc(mercy.cap ?? 7));   // cap 來自後台設定，必須有下限`,
    to: `    const cap = mercy.cap ?? 7;`
  },
  {
    name: '#7 棄賽積分從比分推，忽略 awardPoints 設定',
    file: 'js/engine/tally.js',
    from: `  const forced = sc.points?.[side];`,
    to: `  const forced = undefined;`
  },
  {
    name: '#8 keepAsWalkover 不判未賽場次',
    file: 'js/engine/tally.js',
    from: `    if (!sc && !voidWithdrawn && !isCompleted(m)) {`,
    to: `    if (false) {`
  },
  {
    name: '#9 射手榜不擋 goalType==="own"',
    file: 'js/engine/awards.js',
    from: `    if (e.goalType === 'own') continue;`,
    to: `    if (false) continue;`
  },
  {
    name: '#11 行為分不過濾「真的被計入」的場次',
    file: 'js/engine/standing.js',
    from: `  const cards = (opts.cardEvents || []).filter(c => c.matchId && countedMatchIds.has(c.matchId));`,
    to: `  const cards = (opts.cardEvents || []);`
  },
  {
    name: '#12a diffRanking 不看消失的隊伍',
    file: 'js/engine/standing.js',
    from: `    changed: moved.length + removed.length + added.length > 0,`,
    to: `    changed: moved.length > 0,`
  },
  {
    name: '#12b 循環賽階段回報「解算完成」',
    file: 'js/engine/advancement.js',
    from: `  if (!stage.slots?.length) {`,
    to: `  if (false) {`
  },
  {
    name: '§6.4 迷你對戰表改用全組（T07 陷阱）',
    file: 'js/engine/ranking.js',
    from: `      const sub = orderTied(bucket, ctx, 0);`,
    to: `      const sub = { ordered: [...bucket], unresolved: false };`
  },

  // ── M3.5：主題、圖示、三分鐘自撤回 ──────────────────────
  {
    name: '#13 離線也給撤回（會在恢復連線時被 rules 擋掉 → 假成功）',
    file: 'js/modules/staff/live-actions.js',
    from: `  if (online !== true || pendingWrite === true) {`,
    to: `  if (false) {`
  },
  {
    name: '#14 用 Number() 換算送出時間（null → 1970 → 誤判「已超過三分鐘」）',
    file: 'js/modules/staff/live-actions.js',
    from: `  if (v == null) return null;`,
    to: `  if (v == null) return Number(v);`
  },
  {
    name: '#15 誰都能撤回別人送出的完賽',
    file: 'js/modules/staff/live-actions.js',
    from: `  if (!uid || match.scoreSubmittedBy !== uid) {`,
    to: `  if (false) {`
  },
  {
    name: '#16 覆核之後仍可自撤回（改動已認可的成績）',
    file: 'js/modules/staff/live-actions.js',
    from: `  if (match.status === 'confirmed') return no('主辦已覆核這場成績，要更正請找管理員。');`,
    to: ``
  },
  {
    name: '#17 撤回一律退回下半場（延長賽／PK 會被退錯期別）',
    file: 'js/modules/staff/live-actions.js',
    from: `  return best?.periodId ?? 'h2';`,
    to: `  return 'h2';`
  },
  {
    name: '#18 主題偏好把 system 正規化成 light（使用者再也回不去跟隨系統）',
    file: 'js/core/theme.js',
    from: `  return THEME_PREFS.includes(raw) ? raw : 'system';`,
    to: `  return THEME_PREFS.includes(raw) ? raw : 'light';`
  },
  {
    name: '#19 明確選了淺色仍被系統的深色蓋過去',
    file: 'js/core/theme.js',
    from: `  if (pref === 'light' || pref === 'dark') return pref;`,
    to: `  if (pref === 'dark') return pref;`
  },
  {
    name: '#20 EVENT_ICON 改回 emoji（跨平台形狀不一、深色無法換色）',
    file: 'js/modules/staff/live-actions.js',
    from: `  goal: 'goal', own_goal: 'goal', penalty_scored: 'goal', penalty_missed: 'close',`,
    to: `  goal: '⚽', own_goal: 'goal', penalty_scored: 'goal', penalty_missed: 'close',`
  },
  {
    name: '#21 rules 的 finishMustLock() 被架空（完賽可以不上鎖 → 已完賽的比分無限期可改）',
    file: 'firestore.rules',
    from: `      return request.resource.data.status != 'finished'
          || request.resource.data.lock.locked == true;`,
    to: `      return true;`
  },
  {
    name: '#22 分支 (B) 沒有呼叫 finishMustLock()（函式寫對了也沒用）',
    file: 'firestore.rules',
    from: `               && serverStampedSubmit()
               && finishMustLock() )`,
    to: `               && serverStampedSubmit() )`
  },
  {
    name: '#23 撤回的 lock map 漏寫 lockedAt（巢狀 map 整包取代 → 欄位被刪掉）',
    file: 'js/modules/staff/live-actions.js',
    from: `    lock: { locked: false, lockedAt: null, lockedBy: null },`,
    to: `    lock: { locked: false, lockedBy: null },`
  },
  {
    name: '#24 烏龍球記給自己（比分會少一分，而且沒有任何錯誤）',
    file: 'js/engine/timeline.js',
    from: `    const credit = e.type === 'own_goal'
      ? (e.side === 'home' ? 'away' : 'home')
      : e.side;`,
    to: `    const credit = e.side;`
  },
  {
    name: '#25 對帳用 Number() 換算比分（沒填比分 → 0，跟沒有事件剛好「一致」）',
    file: 'js/engine/timeline.js',
    from: `  return typeof v === 'number' && Number.isFinite(v) ? v : null;`,
    to: `  const n = Number(v); return Number.isFinite(n) ? n : null;`
  },
  {
    name: '#26 PK 大戰的罰球算進射手榜（一場 5:4 的 PK 讓九個人各多一球）',
    file: 'js/engine/awards.js',
    from: `    if (e.periodId === 'pk') continue;`,
    to: `    if (false) continue;`
  },
  {
    name: '#27 遮蔽名保留名字最後一字（遮蔽力更弱，且與公開名冊不一致）',
    file: 'js/engine/privacy.js',
    from: `  if (s.length <= 2) return s;
  return s.slice(0, 2) + '＊';`,
    to: `  if (s.length <= 1) return s;
  if (s.length === 2) return s[0] + '○';
  return s[0] + '○'.repeat(s.length - 2) + s.at(-1);`
  },
  // ── M5：公開端（純函式，跑 tests/unit/public-*.test.js）──────
  {
    name: '#P1 沒有時間的場次排最前面（會被當成下一場）',
    file: 'js/modules/public/selectors.js',
    from: `    if (ta == null) return 1;\n    if (tb == null) return -1;`,
    to: `    if (ta == null) return -1;\n    if (tb == null) return 1;`
  },
  {
    name: '#P2 未來的 finished 場次也算「剛結束」',
    file: 'js/modules/public/selectors.js',
    from: `    .filter(m => {\n      const t = toMillis(m?.scoreSubmittedAt) ?? toMillis(m?.kickoffAt);\n      return t == null || t <= nowMs;\n    })`,
    to: `    .filter(() => true)`
  },
  {
    name: '#P3 關注的球隊不置頂',
    file: 'js/modules/public/selectors.js',
    from: `    .sort((a, b) => (followed(b) ? 1 : 0) - (followed(a) ? 1 : 0))`,
    to: ``
  },
  {
    name: '#P4 晉級區用陣列位置判斷，不是用 rank',
    file: 'js/modules/public/selectors.js',
    from: `      qualified: qualifyCount > 0 && Number.isFinite(r?.rank) && r.rank <= qualifyCount,`,
    to: `      qualified: qualifyCount > 0 && i < qualifyCount,`
  },
  {
    name: '#P5 rank 為 null 時不標 unresolved（等於默默給了名次）',
    file: 'js/modules/public/selectors.js',
    from: `      unresolved: r?.rank == null || r?.hasUnresolvedTie === true,`,
    to: `      unresolved: r?.hasUnresolvedTie === true,`
  },
  {
    name: '#P6 吞掉 hasUnresolvedTie',
    file: 'js/modules/public/selectors.js',
    from: `    hasUnresolvedTie: doc?.hasUnresolvedTie === true,`,
    to: `    hasUnresolvedTie: false,`
  },
  {
    name: '#P7 積分欄位用 Number() 硬轉（壞資料會被當成數字）',
    file: 'js/modules/public/selectors.js',
    from: `function num(v, fallback = 0) {\n  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;\n}`,
    to: `function num(v, fallback = 0) {\n  const n = Number(v);\n  return Number.isFinite(n) ? n : fallback;\n}`
  },
  {
    name: '#P8 名單直接整包丟出去，不過白名單',
    file: 'js/modules/public/selectors.js',
    from: `  for (const k of PUBLIC_MEMBER_FIELDS) if (doc?.[k] !== undefined) out[k] = doc[k];`,
    to: `  Object.assign(out, doc || {});`
  },
  {
    name: '#P9 直播 status:off 被忽略（Admin 關不掉，破圖）',
    file: 'js/modules/public/selectors.js',
    from: `  const off = s => !s || s.status === 'off' || s.enabled === false;`,
    to: `  const off = s => !s;`
  },
  {
    name: '#P10 直播改用 youtube.com（第三方 Cookie 回來了）',
    file: 'js/modules/public/selectors.js',
    from: `    return \`https://www.youtube-nocookie.com/embed/\${encodeURIComponent(ms.videoId)}\``,
    to: `    return \`https://www.youtube.com/embed/\${encodeURIComponent(ms.videoId)}\``
  },
  {
    name: '#P11 沒有背號的球員被當成 0 號排最前面',
    file: 'js/modules/public/selectors.js',
    from: `    (num(a?.jerseyNo, 9999) - num(b?.jerseyNo, 9999)) ||`,
    to: `    (num(a?.jerseyNo) - num(b?.jerseyNo)) ||`
  },
  {
    name: '#P12 時間未定的場次也套上時段標題（標題騙人）',
    file: 'js/modules/public/selectors.js',
    from: `      const g = { key, label: ms == null ? '時間未定' : hhmmOf(Number(key)), matches: [] };`,
    to: `      const g = { key, label: hhmmOf(Number(key)), matches: [] };`
  },
  {
    name: '#P12b 無時間的場次各自成群，不會合併',
    file: 'js/modules/public/selectors.js',
    from: `    const key = ms == null ? 'unknown' : String(Math.floor(ms / size) * size);`,
    to: `    const key = ms == null ? 'unknown-' + (m?.matchId ?? '') : String(Math.floor(ms / size) * size);`
  },
  {
    name: '#P13 關注清單沒有上限（被當成書籤存到爆）',
    file: 'js/modules/public/follows.js',
    from: `.slice(0, 200);`,
    to: `;`
  },
  {
    name: '#P14 篩選的「我的關注」沒寫進網址（分享出去就掉了）',
    file: 'js/modules/public/selectors.js',
    from: `  if (f.onlyFollowed) p.set('follow', '1');`,
    to: ``
  },
  {
    name: '#P15 名單沒有經過 publicMember（第二道隱私防線被拿掉）',
    file: 'js/modules/public/team.js',
    from: `    state.roster = sortRoster(raw.map(publicMember));`,
    to: `    state.roster = sortRoster(raw);`
  },
  {
    name: '#P17 兒童組守衛讀不存在的欄位（division.youth，永遠不會生效）',
    file: 'js/modules/public/selectors.js',
    from: `    .filter(d => d?.display?.scorerBoard === false && d?.divisionId)`,
    to: `    .filter(d => d?.youth === true && d?.divisionId)`
  },
  {
    name: '#P18 youthScorerBoard 用寬鬆比較（字串 "false" 也會解除隱藏）',
    file: 'js/modules/public/selectors.js',
    from: `  if (featureFlags?.youthScorerBoard === true) return new Set();`,
    to: `  if (featureFlags?.youthScorerBoard) return new Set();`
  },
  {
    name: '#P19 生日缺漏時當成成年（fail-open → 沒填生日的兒童以真名公開）',
    file: 'js/engine/privacy.js',
    from: `  if (!b || !a) return true;`,
    to: `  if (!b || !a) return false;`
  },
  {
    name: '#P20 年齡不看「生日還沒到」（差一天滿 13 的小孩會被當成已滿）',
    file: 'js/engine/privacy.js',
    from: `  if (a.m < b.m || (a.m === b.m && a.d < b.d)) age -= 1;`,
    to: `  if (false) age -= 1;`
  },
  {
    name: '#P21 公開投影改成「整份帶過去再蓋掉」（members 的私密欄位全外洩）',
    file: 'js/engine/privacy.js',
    from: `    memberId: member?.memberId ?? null,`,
    to: `    ...member,
    memberId: member?.memberId ?? null,`
  },
  {
    name: '#P22 照片同意用寬鬆比較（"沒說不要" 也算同意）',
    file: 'js/engine/privacy.js',
    from: `    photoUrl: photoConsent === true ? (member?.photoUrl ?? null) : null,`,
    to: `    photoUrl: photoConsent ? (member?.photoUrl ?? null) : null,`
  },
  {
    name: '#P23 LINE 登入不檢查 aud（別的應用程式發的 token 也能登入我們的系統）',
    file: 'functions/line.js',
    from: `  if (!aud.includes(String(channelId))) throw new Error('這個 token 不是發給本應用程式的');`,
    to: `  if (false) throw new Error('這個 token 不是發給本應用程式的');`
  },
  {
    name: '#P25 已安裝了還是畫「安裝」鈕（按下去什麼都不會發生）',
    file: 'js/core/install.js',
    from: `  if (b.installed || isStandalone()) return { installed: true, canInstall: false, mode: null };`,
    to: `  if (b.installed) return { installed: true, canInstall: false, mode: null };`
  },
  {
    name: '#P26 iPad 只看 UA（iPadOS 13+ 偽裝成 Mac，會被判成裝不了）',
    file: 'js/core/install.js',
    from: `  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;`,
    to: `  return false;`
  },
  {
    name: '#P27 原生安裝事件用完不丟掉（第二次按會丟 InvalidStateError）',
    file: 'js/core/install.js',
    from: `  b.deferred = null;
  emit();
  try {`,
    to: `  try {`
  },
  {
    name: '#P28 index.html 不攔 beforeinstallprompt（安裝鈕永遠不出現）',
    file: 'index.html',
    from: `  window.addEventListener('beforeinstallprompt', function (e) {`,
    to: `  window.addEventListener('__disabled_beforeinstallprompt', function (e) {`
  },
  {
    name: '#P29 頁首拿掉「我的」（建完隊就再也找不到自己的球隊）',
    file: 'js/core/appbar.js',
    from: `  { href: '#/my', iconName: 'person', label: '我的', isCurrent: atMy }`,
    to: ``
  },
  {
    name: '#P37 圖示網址不帶版號（被毒化的邊緣快取繞不開，安裝選項照樣不出現）',
    file: 'manifest.json',
    from: `"/img/icon-192.png?v=`,
    to: `"/img/icon-192.png#v=`
  },
  {
    name: '#P38 sw.js 預先快取的圖示網址與 manifest 不同鍵（離線抓不到）',
    file: 'sw.js',
    from: `.map(n => \`/img/\${n}.png?v=\${CACHE_NAME.replace('feda-cup-', '')}\`)`,
    to: `.map(n => \`/img/\${n}.png\`)`
  },
  {
    name: '#P34 super_admin 的階層與 FC 不同（對接時同一個人變成兩種身分）',
    file: 'js/config.js',
    from: `  super_admin: { level: 5, label: '總管',     fc: true },`,
    to: `  super_admin: { level: 9, label: '大總管',   fc: true },`
  },
  {
    name: '#P35 賽務角色的 level 撞到 FC 的整數（兩邊排序衝突）',
    file: 'js/config.js',
    from: `  scorer:      { level: 2.4, label: '記錄員',   fc: false },`,
    to: `  scorer:      { level: 3, label: '記錄員',   fc: false },`
  },
  {
    name: '#P36 topRole 把不認得的角色當成最高（對接時給出不該給的權限）',
    file: 'js/config.js',
    from: `  [...roles].filter(r => ROLE_INFO[r]).sort((a, b) => ROLE_INFO[b].level - ROLE_INFO[a].level)[0] ?? null;`,
    to: `  [...roles].sort((a, b) => (ROLE_INFO[b]?.level ?? 99) - (ROLE_INFO[a]?.level ?? 99))[0] ?? null;`
  },
  {
    name: '#P32 自助身分白名單放行 super_admin（登入一次就能發身分給任何人）',
    file: 'firestore.rules',
    // ⚠️ 帶上前一行才定位得到：staffRolesAssignable() 有一模一樣的一行，
    //    只寫 hasOnly 那一行會打到它（第一版就是這樣，變異逃掉了）。
    from: `        && d.roles.size() > 0
        // ⚠️ **不含 super_admin**`,
    to: `        && d.roles.size() > 0
        && d.roles.hasOnly(['scorer', 'referee', 'booth', 'admin', 'super_admin'])
        // ⚠️ **不含 super_admin**`
  },
  {
    name: '#P32b 大總管可指派的角色包含 super_admin（大總管不再唯一）',
    file: 'firestore.rules',
    from: `      return d.roles is list && d.roles.size() > 0
          && d.roles.hasOnly(['scorer', 'referee', 'booth', 'admin']);`,
    to: `      return d.roles is list && d.roles.size() > 0
          && d.roles.hasOnly(['scorer', 'referee', 'booth', 'admin', 'super_admin']);`
  },
  {
    name: '#P33 介面提供了 rules 不放行的身分（選了才被擋，看起來像壞掉）',
    file: 'js/modules/demo/index.js',
    from: `  { value: 'admin',   note: '賽務全權．覆核完賽、改判、審核報名' },`,
    to: `  { value: 'super_admin', note: 'x' },`
  },
  {
    name: '#P30 用 startsWith 判「我的」（#/mystats 也會反白）',
    file: 'js/core/appbar.js',
    from: `export const atMy = (hash = location.hash) => hash === '#/my' || hash.startsWith('#/my?');`,
    to: `export const atMy = (hash = location.hash) => hash.startsWith('#/my');`
  },
  {
    name: '#P31 賽務端也畫全站頁首（畫面上兩個主題切換）',
    file: 'js/core/appbar.js',
    from: `export const HIDDEN_PREFIXES = ['#/staff'];`,
    to: `export const HIDDEN_PREFIXES = [];`
  },
  {
    name: '#P24 LINE 登入不檢查簽發者（任何人自己簽一個 token 都能用）',
    file: 'functions/line.js',
    from: `  if (payload.iss !== LINE_ISSUER) throw new Error(\`簽發者不是 LINE（iss=\${payload.iss}）\`);`,
    to: `  if (false) throw new Error('x');`
  }
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'npm run test:unit --silent',
  title: '引擎與前端｜變異測試'
}));
