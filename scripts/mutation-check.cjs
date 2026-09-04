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
    from: `  { key: 'me',   href: '#/my', iconName: 'person', label: '我的', isCurrent: atMy }`,
    to: ``
  },
  {
    name: '#R1 學童組比賽時間改回 20 分（規章是 25 分，時鐘會少跑 5 分鐘）',
    file: 'js/engine/formats.js',
    from: `    teamCount: 6, playersOnField: 5, matchDurationMin: 25, periods: 1, ballSize: 4,
    eligibility: { bornOnOrAfter: '2020-09-01', note: '就讀各公、私立小學' },`,
    to: `    teamCount: 6, playersOnField: 5, matchDurationMin: 20, periods: 1, ballSize: 4,
    eligibility: { bornOnOrAfter: '2020-09-01', note: '就讀各公、私立小學' },`
  },
  {
    name: '#R2 拿掉學童組的出生日期門檻（超齡球員報得進來，系統一句話都不會說）',
    file: 'js/engine/formats.js',
    from: `    eligibility: { bornOnOrAfter: '2016-09-01', note: '就讀各公、私立小學' },`,
    to: `    eligibility: { bornOnOrAfter: null, note: '就讀各公、私立小學' },`
  },
  {
    name: '#R3 同分判定插回行為分（規章第十九條沒有這一條）',
    file: 'js/engine/formats.js',
    from: `    'goalsAgainstAsc',    // 4. 被進球數少者
    'drawLots'            // 5. 抽籤（由主辦執行，引擎只標記）`,
    to: `    'goalsAgainstAsc',
    'fairPlay',
    'drawLots'`
  },
  {
    name: '#R4 棄權比分改回 3:0（規章第十八條第 6 款是 0:2）',
    file: 'js/engine/tally.js',
    from: `  scoreFor: 2,
  scoreAgainst: 0,`,
    to: `  scoreFor: 3,
  scoreAgainst: 0,`
  },
  {
    name: '#R5 組別改回分上下半場（規章明訂不分上、下半場）',
    file: 'js/engine/formats.js',
    from: `    teamCount: 8, playersOnField: 9, matchDurationMin: 30, periods: 1, ballSize: 5,
    eligibility: { bornOnOrAfter: null, note: '在學學生之社會人士、機關及公司員工均可自由組隊參加' },
    formatId: 'F8_GROUP_CROSS', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-open',`,
    to: `    teamCount: 8, playersOnField: 9, matchDurationMin: 30, periods: 2, ballSize: 5,
    eligibility: { bornOnOrAfter: null, note: '在學學生之社會人士、機關及公司員工均可自由組隊參加' },
    formatId: 'F8_GROUP_CROSS', rankingRuleId: 'RR_FEDA_2026',
    colorToken: 'div-open',`
  },
  {
    name: '#R6 單一時段的 h1 照半場算補時（25 分的比賽第 13 分鐘就顯示補時）',
    file: 'js/core/clock.js',
    from: `  if (period === 'h1' && periods === 1) return matchDurationMin * 60;`,
    to: ``
  },
  {
    name: '#R7 單一時段時 h1 仍走到中場（比賽卡在中場，沒有按鈕走得出來）',
    file: 'js/core/clock.js',
    from: `  if (periods === 1 && period === 'h1') {
    return tied && drawRule === 'goldenGoal' ? 'et1' : 'ft';
  }`,
    to: ``
  },
  {
    name: '#R8 把仁慈規則加回兒童組（規章沒有這一條，公開端會顯示假比分）',
    file: 'js/engine/formats.js',
    from: `    colorToken: 'div-u6',    order: 1, code: 'U6',
    display: { mercyRule: { enabled: false, cap: 7 }, scorerBoard: false } },`,
    to: `    colorToken: 'div-u6',    order: 1, code: 'U6',
    display: { mercyRule: { enabled: true, cap: 7 }, scorerBoard: false } },`
  },
  {
    name: '#R9 球員人數上限改掉（規章是最多 15 人）',
    file: 'js/engine/formats.js',
    from: `  maxPlayers: 15,          // 「球員最多 15 人」`,
    to: `  maxPlayers: 20,`
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
    from: `  scorer:      { level: 2.4, label: '記錄員',   fc: false }`,
    to: `  scorer:      { level: 3, label: '記錄員',   fc: false }`
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
        && d.roles.hasOnly(['scorer', 'referee', 'checkin', 'booth', 'admin', 'super_admin'])
        // ⚠️ **不含 super_admin**`
  },
  {
    name: '#P32b 大總管可指派的角色包含 super_admin（大總管不再唯一）',
    file: 'firestore.rules',
    from: `      return d.roles is list && d.roles.size() > 0
          && d.roles.hasOnly(['scorer', 'referee', 'checkin', 'booth', 'admin']);`,
    to: `      return d.roles is list && d.roles.size() > 0
          && d.roles.hasOnly(['scorer', 'referee', 'checkin', 'booth', 'admin', 'super_admin']);`
  },
  {
    name: '#P33 介面提供了 rules 不放行的身分（選了才被擋，看起來像壞掉）',
    file: 'js/modules/demo/index.js',
    from: `  { value: 'admin',   note: '記錄員 ＋ 覆核完賽、改判、賽程、審核報名' },`,
    to: `  { value: 'super_admin', note: 'x' },`
  },
  {
    name: '#P30 用 startsWith 判「我的」（#/mystats 也會反白）',
    file: 'js/core/appbar.js',
    from: `export const atMy = (hash = location.hash) => hash === '#/my' || hash.startsWith('#/my?');`,
    to: `export const atMy = (hash = location.hash) => hash.startsWith('#/my');`
  },
  {
    name: '#P31 賽務首頁自己又畫一顆主題切換（頁首已經有了，畫面上會有兩個）',
    file: 'js/modules/staff/home.js',
    from: `      indicator.node`,
    to: `      indicator.node, themeSwitch()`
  },
  {
    name: '#P24 LINE 登入不檢查簽發者（任何人自己簽一個 token 都能用）',
    file: 'functions/line.js',
    from: `  if (payload.iss !== LINE_ISSUER) throw new Error(\`簽發者不是 LINE（iss=\${payload.iss}）\`);`,
    to: `  if (false) throw new Error('x');`
  },
  {
    name: '#R10 年齡門檻用 > 而不是 >=（門檻當天出生的孩子被踢出組別）',
    file: 'js/engine/eligibility.js',
    from: `  if (before(b, l)) {`,
    to: `  if (before(b, l) || (b.y === l.y && b.m === l.m && b.d === l.d)) {`
  },
  {
    name: '#R11 沒填生日就放行（fail-open，超齡的孩子直接混進學童組）',
    file: 'js/engine/eligibility.js',
    from: `  if (!b) {
    return { ok: false, code: 'BIRTHDATE_MISSING', message: '請填出生年月日（民國年）' };
  }`,
    to: `  if (!b) return OK;`
  },
  {
    name: '#R12 學童組的身分證後四碼改成選填（檢錄當天沒有東西可核對）',
    file: 'js/engine/eligibility.js',
    from: `      const last4 = String(member?.idLast4 ?? '').trim();
      if (!/^\\d{4}$/.test(last4)) errors.idLast4 = '請填身分證後四碼（4 個數字）';`,
    to: ``
  },
  {
    name: '#R13 「走不走教練模式」寫死 divisionId（辦第二場就會錯）',
    file: 'js/engine/eligibility.js',
    from: `export const isYouthDivision = division => division?.eligibility?.bornOnOrAfter != null;`,
    to: `export const isYouthDivision = division => ['u6', 'u8', 'u10', 'youth'].includes(division?.divisionId);`
  },
  {
    name: '#R14 球員與隊職員共用同一個人數上限',
    file: 'js/engine/eligibility.js',
    from: `  if (adding === 'player' && players >= limits.maxPlayers) {`,
    to: `  if (list.length >= limits.maxPlayers) {`
  },
  {
    name: '#R15 民國年轉換用 Number()（空字串變成民國 0 年）',
    file: 'js/lib/roc.js',
    from: `  const s = String(v ?? '').trim();
  if (!/^\\d+$/.test(s)) return null;
  return Number(s);`,
    to: `  const n = Number(v);
  return Number.isFinite(n) ? n : null;`
  },
  {
    name: '#R16 民國年偏移寫成 1912（每個人的生日都差一年）',
    file: 'js/lib/roc.js',
    from: `export const ROC_OFFSET = 1911;`,
    to: `export const ROC_OFFSET = 1912;`
  },
  {
    name: '#R17 民國年不檢查日子是否存在（2/30 會被拼成一個假日期）',
    file: 'js/lib/roc.js',
    from: `  const probe = new Date(Date.UTC(ad, mo - 1, day));
  if (probe.getUTCFullYear() !== ad || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== day) return null;`,
    to: ``
  },
  {
    name: '#R18 檢錄進度把隊職員算進分母（檢錄員會一直找不存在的人）',
    file: 'js/modules/staff/checkin-actions.js',
    from: `  const players = list.filter(isPlayer);`,
    to: `  const players = list;`
  },
  {
    name: '#R19 檢錄接受任意 result 值（存進奇怪的狀態）',
    file: 'js/modules/staff/checkin-actions.js',
    from: `    result: CHECKIN_RESULTS.includes(result) ? result : null,`,
    to: `    result: result ?? null,`
  },
  {
    name: '#R20 檢錄自己填時間戳（離線重放時時間就錯了，R-ENG-004）',
    file: 'js/modules/staff/checkin-actions.js',
    from: `    scannedBy: uid,`,
    to: `    scannedBy: uid,
    scannedAt: Date.now(),`
  },
  {
    name: '#R21 開賽人數讀不到門檻就放行（人數不足默默開賽）',
    file: 'js/modules/staff/checkin-actions.js',
    from: `  if (typeof requiredMin !== 'number' || !Number.isFinite(requiredMin)) {
    return { ready: false, reason: '讀不到開賽人數門檻，請找主辦確認' };
  }`,
    to: `  if (typeof requiredMin !== 'number' || !Number.isFinite(requiredMin)) {
    return { ready: true, reason: '' };
  }`
  },
  {
    name: '#R22 暱稱也照年齡遮（小豆子 → 小豆＊，家長以為名字被打錯）',
    file: 'js/engine/privacy.js',
    from: `  if (member?.nameKind === 'nickname') return name;`,
    to: ``
  },
  {
    name: '#R23 用寬鬆比較判 nameKind（黑名單而不是白名單）',
    file: 'js/engine/privacy.js',
    from: `  if (member?.nameKind === 'nickname') return name;`,
    to: `  if (member?.nameKind) return name;`
  },
  {
    name: '#H1 繼承鏈用 level 比大小（FC 的「場主」自動變成記錄員）',
    file: 'js/config.js',
    from: `  return top < 0 ? extras : [...STAFF_CHAIN.slice(0, top + 1), ...extras];`,
    to: `  const lv = Math.max(-1, ...list.map(r => ROLE_INFO[r]?.level ?? -1));
  const byLevel = STAFF_CHAIN.filter(r => ROLE_INFO[r].level <= lv);
  return byLevel.length ? [...byLevel, ...extras] : extras;`
  },
  {
    name: '#H2 繼承只回自己，不含更低階（每個人都要指派一堆身分）',
    file: 'js/config.js',
    from: `  return top < 0 ? extras : [...STAFF_CHAIN.slice(0, top + 1), ...extras];`,
    to: `  return top < 0 ? extras : [STAFF_CHAIN[top], ...extras];`
  },
  {
    name: '#H3 裁判排在記錄員之上（主辦指定的順序反了）',
    file: 'js/config.js',
    from: `export const STAFF_CHAIN = ['booth', 'checkin', 'referee', 'scorer', 'admin', 'super_admin'];`,
    to: `export const STAFF_CHAIN = ['booth', 'checkin', 'scorer', 'referee', 'admin', 'super_admin'];`
  },
  {
    name: '#H4 覆核完賽下放給記錄員（記分的人自己覆核自己）',
    file: 'js/config.js',
    from: `  { code: 'match.confirm',     label: '覆核完賽',       group: '管理', minRole: 'admin', destructive: true, pending: true },`,
    to: `  { code: 'match.confirm',     label: '覆核完賽',       group: '管理', minRole: 'scorer', destructive: true, pending: true },`
  },
  {
    name: '#H5 權限矩陣的「關」優先於「開」（多一個身分反而變弱）',
    file: 'js/config.js',
    from: `    if (sawTrue) on = true;
    else if (sawFalse) on = false;`,
    to: `    if (sawFalse) on = false;
    else if (sawTrue) on = true;`
  },
  {
    name: '#H6 總管也受權限開關影響（可以把自己鎖在門外）',
    file: 'js/config.js',
    from: `  if (mine.includes('super_admin')) return new Set(PERMISSIONS.map(p => p.code));`,
    to: ``
  },
  {
    name: '#H7 讀不到權限矩陣就全部關閉（賽務的按鈕全部消失）',
    file: 'js/config.js',
    from: `    let on = mine.includes(p.minRole);`,
    to: `    let on = mine.includes(p.minRole) && Object.keys(matrix || {}).length > 0;`
  },
  {
    name: '#H11 頁首未登入也顯示「我的」（看不出來自己還沒登入）',
    file: 'js/core/appbar.js',
    from: `export const GUEST_ME = { href: '#/login', iconName: 'person', label: '登入' };`,
    to: `export const GUEST_ME = { href: '#/my', iconName: 'person', label: '我的' };`
  },
  {
    name: '#H12 主題標籤改用 display:none（螢幕閱讀器也讀不到）',
    file: 'css/components.css',
    from: `.theme-switch__label{
  position:absolute;width:1px;height:1px;overflow:hidden;
  clip-path:inset(50%);white-space:nowrap;
}`,
    to: `.theme-switch__label{display:none}`
  },
  {
    name: '#H13 關注篩選被加回來（沒有入口卻留一個永遠是空的篩選器）',
    file: 'js/modules/public/selectors.js',
    from: `    venueId: p.get('venue') || null
  };`,
    to: `    venueId: p.get('venue') || null,
    onlyFollowed: p.get('follow') === '1'
  };`
  },
  {
    name: '#H14 組別丟掉規章正式名稱（家長拿報名表對不上「學童中年級」）',
    file: 'js/engine/formats.js',
    from: `officialName: '學童中年級',`,
    to: ``
  },
  {
    name: '#H15 組別主標籤改回規章名（主辦指定畫面上要用 U 制）',
    file: 'js/engine/formats.js',
    from: `name: 'U10兒童組', shortName: 'U10',`,
    to: `name: '學童中年級', shortName: '中年級',`
  },
  {
    name: '#H16 種子漏搬 officialName（規章名稱進不了資料庫，畫面讀不到）',
    file: 'scripts/seed/build.js',
    from: `      officialName: div.officialName,`,
    to: ``
  },
  {
    name: '#A1 審核不擋超齡（規章第十八條第 3 款：冒名頂替停整隊資格）',
    file: 'js/engine/review.js',
    from: `  if (tooOld.length) {
    add('error', 'TOO_OLD',`,
    to: `  if (tooOld.length) {
    add('warn', 'TOO_OLD',`
  },
  {
    name: '#A2 審核不擋人數超限（規章第十二條 15 人）',
    file: 'js/engine/review.js',
    from: `  } else if (players.length > limits.maxPlayers) {`,
    to: `  } else if (false) {`
  },
  {
    name: '#A3 背號重複只提醒（賽務台會把進球記到錯的球員身上）',
    file: 'js/engine/review.js',
    from: `    add('error', 'DUPLICATE_JERSEY',`,
    to: `    add('warn', 'DUPLICATE_JERSEY',`
  },
  {
    name: '#A4 背號重複標成「規章」（規章其實沒有這一條）',
    file: 'js/engine/review.js',
    from: `      '系統限制');`,
    to: `      '規章第十八條');`
  },
  {
    name: '#A5 學童組不檢查身分證後四碼（檢錄當天核對不了證件）',
    file: 'js/engine/review.js',
    from: `    const noId = players.filter(m => !/^`,
    to: `    const noId = players.filter(m => false && !/^`
  },
  {
    name: '#A6 退回時順手鎖名單（隊長改不動卻看不出為什麼）',
    file: 'js/engine/review.js',
    from: `  return { status: 'rejected', rosterLocked: false, reviewedBy: uid, rejectReason: text.slice(0, 500) };`,
    to: `  return { status: 'rejected', rosterLocked: true, reviewedBy: uid, rejectReason: text.slice(0, 500) };`
  },
  {
    name: '#A7 退回可以不填原因（隊長只看到「被退回」）',
    file: 'js/engine/review.js',
    from: `  if (!text) throw new Error('退回一定要填原因');`,
    to: ``
  },
  {
    name: '#A8 核准不鎖名單（審過的跟通過的會是兩份不同的東西）',
    file: 'js/engine/review.js',
    from: `  return { status: 'approved', rosterLocked: true, reviewedBy: uid, rejectReason: null };`,
    to: `  return { status: 'approved', rosterLocked: false, reviewedBy: uid, rejectReason: null };`
  },
  {
    name: '#A9 檢核把 pending／removed 的人也算進名單',
    file: 'js/engine/review.js',
    from: `  const roster = (Array.isArray(members) ? members : []).filter(m => ACTIVE.includes(m?.status));`,
    to: `  const roster = (Array.isArray(members) ? members : []);`
  },
  {
    name: '#B1 ⭐ 可指派身分多列一個 super_admin（介面上點兩下就有第二個大總管）',
    file: 'js/engine/assign.js',
    from: `export const ASSIGNABLE_ROLES = STAFF_CHAIN.slice(0, -1);`,
    to: `export const ASSIGNABLE_ROLES = [...STAFF_CHAIN];`
  },
  {
    name: '#B2 ⭐ validateAssignment 不擋 super_admin（rules 會擋，但畫面會說成功）',
    file: 'js/engine/assign.js',
    from: `  if (role === 'super_admin') {`,
    to: `  if (false) {`
  },
  {
    name: '#B3 ⭐ staff 文件存展開後的四個角色（看不出他到底被指派了什麼）',
    file: 'js/engine/assign.js',
    from: `    roles: [role],`,
    to: `    roles: impliedRoles([role]),`
  },
  {
    name: '#B4 ⭐ 停用改成刪除意圖（roles 一起清掉，查不到誰記的比分）',
    file: 'js/engine/assign.js',
    from: `export const buildDeactivatePatch = () => ({ active: false });`,
    to: `export const buildDeactivatePatch = () => ({ active: false, roles: [] });`
  },
  {
    name: '#B5 管理員也給指派場地（畫面顯示的限制其實不生效）',
    file: 'js/engine/assign.js',
    from: `export const onlyStaffScoped = role => ASSIGNABLE_ROLES.includes(role) && role !== 'admin';`,
    to: `export const onlyStaffScoped = role => ASSIGNABLE_ROLES.includes(role);`
  },
  {
    name: '#B6 空的 uid 放行（會寫出一份沒有人的身分文件）',
    file: 'js/engine/assign.js',
    from: `    return { ok: false, code: 'NO_UID', message: '請先選一個人。' };`,
    to: `    return { ok: true, code: null, message: '' };`
  },
  {
    name: '#B7 不存在的場地不擋（那個人什麼場次都經手不到）',
    file: 'js/engine/assign.js',
    from: `    const bad = ids.filter(v => !knownVenueIds.includes(v));`,
    to: `    const bad = [];`
  },
  {
    name: '#B8 ⭐ 名錄只列 users（腳本建立的大總管看不到自己）',
    file: 'js/engine/assign.js',
    from: `    const row = byUid.get(s.uid) ?? { uid: s.uid, name: null, venueIds: [] };`,
    to: `    const row = byUid.get(s.uid); if (!row) continue;`
  },
  {
    name: '#B9 有身分的不排前面（總管要在幾百個路人裡找工作人員）',
    file: 'js/engine/assign.js',
    from: `    if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;`,
    to: ``
  },
  {
    name: '#B10 ⭐ 用 level 比大小判賽務身分（FC 的場主會被當成記錄員）',
    file: 'js/engine/assign.js',
    from: `    const chainRole = (s.roles ?? []).find(r => STAFF_CHAIN.includes(r)) ?? null;`,
    to: `    const chainRole = (s.roles ?? []).find(r => (ROLE_INFO[r]?.level ?? -1) >= 2) ?? null;`
  },
  {
    name: '#B11 ⭐ 總管那一列也給改（降下去就再也沒有人指派得了身分）',
    file: 'js/engine/assign.js',
    from: `export const assignableHere = row => row?.role !== 'super_admin';`,
    to: `export const assignableHere = () => true;`
  },
  {
    name: '#B12 ⭐ 管不到的角色被當成「未指派」（殘留身分永遠沒有人清）',
    file: 'js/engine/assign.js',
    from: `export const unmanagedRoles = (roles = []) =>
  (Array.isArray(roles) ? roles : []).filter(r => !STAFF_CHAIN.includes(r));`,
    to: `export const unmanagedRoles = () => [];`
  },
  {
    name: '#B13 名錄不留原始 roles（畫面印不出「其他身分」）',
    file: 'js/engine/assign.js',
    from: `      roles: Array.isArray(s.roles) ? s.roles : [],`,
    to: ``
  },
  {
    name: '#B14 種子不把隊長寫進名錄（授權頁出現三十幾列空白）',
    file: 'scripts/seed/build.js',
    from: `      uid: t.captainUid, displayName: t.captainName, pictureUrl: null,`,
    to: `      uid: t.captainUid, displayName: null, pictureUrl: null,`
  },
  {
    name: '#C1 ⭐ 總管的權限也給調（開關按下去不會有任何效果）',
    file: 'js/engine/perms.js',
    from: `  if (p.minRole === 'super_admin') {`,
    to: `  if (false) {`
  },
  {
    name: '#C2 ⭐ 繼承來的那一階也給調（聯集會蓋回去，開關等於沒作用）',
    file: 'js/engine/perms.js',
    from: `  if (p.minRole !== role) {`,
    to: `  if (false) {`
  },
  {
    name: '#C3 ⭐ 不講「誰不受影響」（主辦以為整個功能被關掉）',
    file: 'js/engine/perms.js',
    from: `  return STAFF_CHAIN.slice(i + 1);`,
    to: `  return [];`
  },
  {
    name: '#C4 「誰不受影響」把自己也算進去（關掉的那一階說自己還可以）',
    file: 'js/engine/perms.js',
    from: `  return STAFF_CHAIN.slice(i + 1);
}`,
    to: `  return STAFF_CHAIN.slice(i);
}`
  },
  {
    name: '#C5 ⭐ on 另外算一份，不用 effectivePerms（畫面說開著、實際上關著）',
    file: 'js/engine/perms.js',
    from: `  const on = role === 'super_admin' ? true : effectivePerms([role], matrix).has(p.code);`,
    to: `  const on = stored !== false;`
  },
  {
    name: '#C6 沒動過的也標成「已調整」（畫面上到處是黃點）',
    file: 'js/engine/perms.js',
    from: `    changed: stored === false,        // 只有「被關掉」算改過；true 就是預設值`,
    to: `    changed: stored !== null,`
  },
  {
    name: '#C7 ⭐ 權限開關整份覆蓋（其他權限的設定被抹掉）',
    file: 'js/engine/perms.js',
    from: `  return { role, patch: { role, perms: { [p.code]: on } } };`,
    to: `  return { role, patch: { role, perms: Object.fromEntries(PERMISSIONS.filter(x => x.minRole === role).map(x => [x.code, x.code === p.code ? on : true])) } };`
  },
  {
    name: '#C8 開關收非 boolean（undefined 寫進去會變成「沒設定」）',
    file: 'js/engine/perms.js',
    from: `  if (typeof on !== 'boolean') throw new Error('權限開關只能是 true 或 false');`,
    to: ``
  },
  {
    name: '#C9 總管的權限不丟錯，安靜地寫進去',
    file: 'js/engine/perms.js',
    from: `  if (role === 'super_admin') throw new Error('總管的權限不能由介面調整');`,
    to: ``
  },
  {
    name: '#D1 ⭐ 校時探測退回保留 ID（每位使用者主控台都紅一條 400）',
    file: 'js/lib/ping.js',
    from: "const PING_PATH = 'events?pageSize=1&mask.fieldPaths=eventId';",
    to: "const PING_PATH = '__ping__/__ping__';"
  },
  {
    name: '#D2 ⭐ 校時探測改打單一文件（空資料庫的正式站會 404）',
    file: 'js/lib/ping.js',
    from: "const PING_PATH = 'events?pageSize=1&mask.fieldPaths=eventId';",
    to: "const PING_PATH = 'events/feda-cup-2026?mask.fieldPaths=eventId';"
  },
  {
    name: '#D3 ⭐ 校時探測改打同源（會被 SW 接走，拿到快取的舊 Date）',
    file: 'js/lib/ping.js',
    from: "const PING_HOST = 'https://firestore.googleapis.com';",
    to: "const PING_HOST = location.origin;"
  },
  {
    name: '#D4 ⭐ 校時失敗回 0（在沒有資料時假裝時鐘完全準）',
    file: 'js/lib/ping.js',
    from: '  if (!dateHeader) return null;',
    to: '  if (!dateHeader) return 0;'
  },
  {
    name: '#C10 ⭐ 出場名單擋在記錄員的權限（裁判就編不了名單）',
    file: 'js/modules/staff/sheet.js',
    from: "    const mayEdit = can('matchsheet.write');",
    to: "    const mayEdit = can('match.score.write');"
  },
  {
    name: '#C11 ⭐ 賽務台不問 match.finish（關掉之後按鈕照樣在）',
    file: 'js/modules/staff/live.js',
    from: "    if (!can('match.finish')) {",
    to: "    if (false) {"
  },
  {
    name: '#C12 ⭐ 檢錄台不問 member.read（關掉個資顯示沒有作用）',
    file: 'js/modules/staff/checkin.js',
    from: "          can('member.read')",
    to: "          true"
  },
  {
    name: '#C13 ⭐ 功能還沒上線的也給調（開關按了不會有效果）',
    file: 'js/engine/perms.js',
    from: '  if (p.pending === true) {',
    to: '  if (false) {'
  },
  {
    name: '#G1 ⭐ 稽核只讀新形狀（demo 上 14 筆舊紀錄整個看不到）',
    file: 'js/engine/audit.js',
    from: "  const entity = raw.entity ?? raw.targetType ?? null;",
    to: "  const entity = raw.entity ?? null;"
  },
  {
    name: '#G2 ⭐ 還沒同步的稽核填本機時間（時間軸失真）',
    file: 'js/engine/audit.js',
    from: "    at: raw.createdAt ?? raw.actor?.at ?? null",
    to: "    at: raw.createdAt ?? raw.actor?.at ?? new Date().toISOString()"
  },
  {
    name: '#G3 ⭐ 不認得的稽核動作被吞掉（發生過的事看不到）',
    file: 'js/engine/audit.js',
    from: "      title = `${a.action ?? '（不明動作）'}：${a.entityLabel} ${a.entityId ?? ''}`.trim();",
    to: "      title = '（其他）';"
  },
  {
    name: '#G4 稽核不顯示退回原因（隊長只會打電話問主辦）',
    file: 'js/engine/audit.js',
    from: "  if (a.reason) detail.push(`原因：${a.reason}`);",
    to: ""
  },
  {
    name: '#G5 ⭐ 搜尋比對原始欄位而不是畫面上那句話',
    file: 'js/engine/audit.js',
    from: "    const d = describeAudit(a, lookup);",
    to: "    const d = { title: a.action ?? '', detail: [] };"
  },
  {
    name: '#G6 ⭐ 搜尋不含「by 誰」（畫面寫著金小麥、搜金小麥 0 筆）',
    file: 'js/engine/audit.js',
    from: "    const hay = [d.title, ...d.detail, actorText(a, lookup), a.actorUid, a.entityId]",
    to: "    const hay = [d.title, ...d.detail, a.actorName, a.actorUid, a.entityId]"
  },
  {
    name: '#G7 「by 誰」不查 lookup（每一列都印 uid）',
    file: 'js/engine/audit.js',
    from: "  return lookup.people?.[a?.actorUid] ?? a?.actorName ?? a?.actorUid ?? '（不明）';",
    to: "  return a?.actorName ?? a?.actorUid ?? '（不明）';"
  },
];

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'npm run test:unit --silent',
  title: '引擎與前端｜變異測試'
}));
