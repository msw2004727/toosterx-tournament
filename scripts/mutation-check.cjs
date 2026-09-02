/**
 * 變異測試：把每個修好的缺陷「改回錯的」，確認測試真的抓得到。
 *
 * 一個「跑得綠」的測試套件不代表它有鑑別力。審查時已證實原本的 115 個測試
 * 完全抓不到其中三個缺陷，所以每補一個修正就必須反向驗證一次。
 *
 * 用法：node scripts/mutation-check.cjs
 */
const fs = require('fs');
const { execSync } = require('child_process');

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
  }
];

const backups = new Map();
const read = f => fs.readFileSync(f, 'utf8');
for (const m of new Set(MUTANTS.map(x => x.file))) backups.set(m, read(m));

let caught = 0;
const escaped = [];

for (const m of MUTANTS) {
  const orig = read(m.file);
  if (!orig.includes(m.from)) {
    console.log(`⚠️  ${m.name}\n    找不到要變異的程式碼，這條變異失效了，請更新腳本`);
    escaped.push(m.name + '（變異失效）');
    continue;
  }
  fs.writeFileSync(m.file, orig.replace(m.from, m.to), 'utf8');
  let failed = false;
  try {
    execSync('npm run test:unit --silent', { stdio: 'pipe' });
  } catch {
    failed = true;
  }
  fs.writeFileSync(m.file, backups.get(m.file), 'utf8');

  if (failed) { console.log(`✅ 抓到　${m.name}`); caught++; }
  else { console.log(`❌ 漏掉　${m.name}`); escaped.push(m.name); }
}

// 還原後必須仍是綠的
execSync('npm run test:unit --silent', { stdio: 'pipe' });

console.log(`\n${caught} / ${MUTANTS.length} 個變異被測試抓到`);
if (escaped.length) {
  console.log('漏掉的變異（代表測試沒有鑑別力）：');
  for (const e of escaped) console.log('  -', e);
  process.exit(1);
}
console.log('全部變異都被抓到，測試具備鑑別力。');
