/**
 * 結果管線的變異測試（需要 Firestore Emulator）
 * ------------------------------------------------------------------
 * 執行：npm run test:mutation:fn
 *   （外層由 firebase emulators:exec 起一次 Emulator，這裡只跑 jest）
 *
 * tests/functions/ 那 18 條整合測試全綠，只代表「happy path 接得起來」。
 * 這裡要證的是它們**抓得到接錯線**——尤其是 fail-closed 那幾條：
 * fail-open 的程式碼在正常情況下跑起來跟正確的一模一樣，
 * 只有在資料缺漏的那一天才會現形，而那一天通常是比賽當天。
 */
const { runMutants } = require('./lib/mutate.cjs');

const MUTANTS = [
  { name:'FN#TWITCH-SOURCE 後端把 Twitch 分享寫成 YouTube', file:'functions/stream-shares.js',
    from:"...source, createdAt: FieldValue.serverTimestamp()", to:"...source, provider: 'youtube', createdAt: FieldValue.serverTimestamp()",
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/stream-shares.test.js --silent' },
  { name:'FN#TWITCH-NAME LINE 名稱截斷切斷 emoji', file:'functions/stream-shares.js',
    from:"name.trim().slice(0, 80).replace(/[\\uD800-\\uDBFF]$/, '')", to:'name.trim().slice(0, 80)',
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/stream-shares.test.js --silent' },
  { name: 'FN#SCORER-TEAM 球隊隱藏設定未套用新榜列', file: 'functions/pipeline.js',
    from: 'events.filter(e => teams[e.teamId]?.display?.scorerBoard !== false)', to: 'events',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/scorer-policy.test.js --testNamePattern=SCORER-TEAM --silent' },
  { name: 'FN#SCORER-TEAM-KEPT 其他組別重算保留隱藏球隊舊榜列', file: 'functions/pipeline.js',
    from: "(boardId !== 'scorers' || teams[r.teamId]?.display?.scorerBoard !== false)", to: 'true',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/scorer-policy.test.js --testNamePattern=SCORER-TEAM --silent' },
  { name: 'FN#SCORER-TEAM-TRIGGER 球隊隱藏設定變更未重算', file: 'functions/index.js',
    from: 'before.display?.scorerBoard !== after?.display?.scorerBoard', to: 'false',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/scorer-policy.test.js --testNamePattern=SCORER-TEAM --silent' },
  { name:'FN#ADDLOCK 上鎖隊長仍可新增球員',file:'functions/team-player-add.js',
    from:'if (!admin && team.managementLocked === true)',to:'if (false)',
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-player-add.test.js --testNamePattern=ADD-LOCK --silent' },
  { name:'FN#ADDAUTH 非隊長可新增別隊球員',file:'functions/team-player-add.js',
    from:'if (!admin && (!team || team.captainUid !== uid))',to:'if (false)',
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-player-add.test.js --testNamePattern=ADD-AUTH --silent' },
  { name:'FN#ADDPROJECTION 新球員漏建公開名冊',file:'functions/team-player-add.js',
    from:"tx.create(teamRef.collection('roster').doc(member.memberId), rosterProjection",to:"false && tx.create(teamRef.collection('roster').doc(member.memberId), rosterProjection",
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-player-add.test.js --testNamePattern=ADD-ATOMIC --silent' },
  { name:'FN#ADDRETRY 重送跳過回執而重複新增',file:'functions/team-player-add.js',
    from:'if (receipt.exists) {',to:'if (false) {',
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-player-add.test.js --testNamePattern=ADD-RETRY --silent' },
  { name:'FN#STAFFCLOCK 賽務員修改時間被後端擋下', file:'functions/clock-edit.js',
    from:"['scorer', 'staff'].includes(r)", to:"['scorer'].includes(r)",
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/clock-edit.test.js --silent' },
  { name:'FN#STAFFEVENT 賽務員事件修正被後端擋下', file:'functions/timeline-edit.js',
    from:"['scorer', 'staff'].includes(r)", to:"['scorer'].includes(r)",
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/timeline-edit.test.js --silent' },
  { name: 'FN#TM5 上鎖後隊長仍可更名', file: 'functions/team-name.js',
    from: 'if (!admin && team.managementLocked === true)', to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/functions/team-management.test.js --silent' },
  { name: 'FN#TM1 上鎖後隊長仍可寫入', file: 'functions/member-identity.js',
    from: "if (!admin && team.managementLocked === true)", to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/functions/team-management.test.js --silent' },
  { name: 'FN#TM2 隊長可修改別隊名冊', file: 'functions/member-identity.js',
    from: 'if (!admin && (!team || team.captainUid !== uid))', to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/functions/team-management.test.js --silent' },
  { name: 'FN#TM3 指派隊長放寬為管理員', file: 'functions/team-management.js',
    from: "permitted(staff.data(), ['super_admin'])", to: "permitted(staff.data(), ['admin', 'super_admin'])",
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/functions/team-management.test.js --silent' },
  { name: 'FN#TM4 一鍵操作漏掉其他球隊', file: 'functions/team-management.js',
    from: 'all === true ? targets.docs : [targets]', to: 'all === true ? targets.docs.slice(0, 1) : [targets]',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/functions/team-management.test.js --silent' },

  {name:'FN#CSVIMPORTCOUNT 純球隊列錯算球員人數',file:'functions/team-import.js',
    from:'playerCount: prepared.reduce((n, team) => n + team.members.length, 0)',to:'playerCount: rows.length',
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-import.test.js --testNamePattern=CSVPARTIAL --silent'},
  { name:'FN#SCORER-POLICY 重建看板忽略禁用統計', file:'functions/pipeline.js',
    from:'enabled: divisionSnap.data()?.stats?.scorers !== false',to:'enabled: true',
    testCmd:'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/scorer-policy.test.js --silent' },
  { name: 'FN#CLOCK-STALE 時鐘更新後仍可覆寫', file: 'functions/clock-edit.js',
    from: 'canonical(expected) !== canonical(clockEditBasis(match))', to: 'false',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/clock-edit.test.js --silent' },
  { name: 'FN#CLOCK-VENUE 未指派場地仍可修改時間', file: 'functions/clock-edit.js',
    from: 'venues.length && !venues.includes(match.venueId)', to: 'false',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/clock-edit.test.js --silent' },
  { name: 'FN#TIMELINE-STALE stale event overwrites newer data', file: 'functions/timeline-edit.js',
    from: 'canonical(expected?.event) !== canonical(timelineEditBasis(before))', to: 'false',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/timeline-edit.test.js --testNamePattern=EDIT-STALE --silent' },
  { name: 'FN#TIMELINE-LOCK finished events can be edited in LIVE', file: 'functions/timeline-edit.js',
    from: "if (context === 'live' && (!['live', 'halftime'].includes(match.status) || match.lock?.locked !== false))", to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/timeline-edit.test.js --testNamePattern=EDIT-AUTH --silent' },
  { name: 'FN#CANCEL-REBASE 保留名單未更新寫入世代', file: 'functions/management.js',
    from: 'doc:{resetRevision:resultPatch.resetRevision}', to: 'doc:{resetRevision:resultPatch.resetRevision-1}',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/consistency.test.js --testNamePattern=CANCEL1 --silent' },
  { name: 'FN#CANCEL-KEEP 撤銷誤開賽誤刪檢錄出場名單', file: 'functions/management.js',
    from: "(action==='match.reset'?children:[children[0]]).flatMap(s=>s.docs)", to: 'children.flatMap(s=>s.docs)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/consistency.test.js --testNamePattern=CANCEL1 --silent' },
  { name: 'FN#RESET-LEGACY 新版管理端阻擋舊版未歸零場次', file: 'functions/management.js',
    from: 'canonical({...expected,resetRevision:expected?.resetRevision??0})', to: 'canonical(expected)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/consistency.test.js --testNamePattern=RESET3 --silent' },
  { name: 'FN#RESET-ARCHIVE 歸零未清理事件與檢錄', file: 'functions/management.js',
    from: 'for(const d of deleted)writes.push({ref:d.ref,delete:true});', to: 'for(const d of [])writes.push({ref:d.ref,delete:true});',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/consistency.test.js --testNamePattern=RESET1 --silent' },
  { name: 'FN#MEMBERNAME 修改姓名未同步公開名冊', file: 'functions/member-identity.js',
    from: 'rosterProjection({ ...member, ...patch, memberId }', to: 'rosterProjection({ ...member, ...patch, name: member.name, memberId }',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-import.test.js --testNamePattern=MEMBERNAME --silent' },
  { name: 'FN#MANUAL-MOVE 已開打場次可直接改時間', file: 'functions/management.js',
    from: "['schedule.move','schedule.shift','schedule.place'].includes(action)&&manualMatchLocked(m)",
    to: "['schedule.shift','schedule.place'].includes(action)&&manualMatchLocked(m)",
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/manual-schedule.test.js --testNamePattern=MOVE-GUARD --silent' },
  { name: 'FN#MANUAL-STALE 整批發布覆寫其他人新版', file: 'functions/manual-schedule.js',
    from: '(division.scheduleRevision??0)!==draft.expectedRevision', to: 'false',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/manual-schedule.test.js --testNamePattern=版本 --silent' },
  { name: 'FN#MANUAL-AUDIT 发布與稽核分離', file: 'functions/manual-schedule.js',
    from: 'writeAudit(eventId,audit,tx,auditRef);', to: '',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/manual-schedule.test.js --testNamePattern=稽核 --silent' },
  { name: 'FN#TEAMNAME-STALE 舊版本覆蓋他人隊名', file: 'functions/team-name.js',
    from: 'canonical(teamNameBasis(team)) !== canonical(expected)', to: 'false',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-name.test.js --silent' },
  { name: 'FN#TEAMNAME-AUTH 更名不查管理員或所屬隊長身分', file: 'functions/team-name.js',
    from: 'if (!admin && (!team || team.captainUid !== uid))', to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-name.test.js --silent' },
  { name: 'FN#STREAM-LINE 非 LINE 身份也能分享直播', file: 'functions/stream-shares.js',
    from: "const isLine = request.auth.token?.firebase?.sign_in_provider === 'custom';", to: 'const isLine = true;',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/stream-shares.test.js --silent' },
  { name: 'FN#STREAM-OWNER 他人也能移除直播分享', file: 'functions/stream-shares.js',
    from: "if (action === 'remove' && !isAdmin && (!isLine || !owner.exists || owner.data().ownerUid !== uid))", to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/stream-shares.test.js --silent' },
  { name: 'FN#SOP-1 文字發布可夾帶計分設定', file: 'functions/challenge-release.js',
    from: 'allowed.includes(key) && ', to: '',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/challenge.test.js --testNamePattern=SOP --silent' },
  { name: 'FN#S7-01 七項結算不標記規則版本', file: 'functions/pipeline.js',
    from: 'luckyDrawRuleVersion: ruleVersion,', to: 'luckyDrawRuleVersion: null,',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/challenge.test.js --testNamePattern=七項 --silent' },
  { name: 'FN#S7-02 作廢紀錄仍集章', file: 'functions/pipeline.js',
    from: 'const hasLiveScore = attempts.some(a => completesChallenge(a, challenge));',
    to: 'const hasLiveScore = attempts.length > 0;',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/challenge.test.js --testNamePattern=七項 --silent' },
  { name: 'FN#PRE1 刪除比賽不重算積分榜', file: 'functions/index.js',
    from: 'if (group.exists) await recalcStandingForMatch', to: 'if (false) await recalcStandingForMatch',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/pipeline.test.js --testNamePattern=刪除最後一場 --silent' },
  { name: 'FN#PRE2 作廢紅黃牌不重算積分榜', file: 'functions/index.js',
    from: 'await recalcStandingForMatch({ eventId, match: { ...match, matchId } });', to: '',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/pipeline.test.js --testNamePattern=完賽後作廢 --silent' },
  { name: 'FN#PRE3 玩家進度讀取移出交易', file: 'functions/pipeline.js',
    from: 'const snap = await tx.get(ref);\n    const attempts = await loadPlayerAttempts',
    to: 'const snap = await ref.get();\n    const attempts = await loadPlayerAttempts',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/challenge.test.js --testNamePattern=同一玩家 --silent' },
  { name: 'FN#PRE4 移除失敗重試', file: 'functions/index.js',
    from: "document: 'events/{eventId}/matches/{matchId}', retry: true", to: "document: 'events/{eventId}/matches/{matchId}', retry: false",
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/pipeline.test.js --testNamePattern=明確啟用失敗重試 --silent' },
  { name: 'FN#DISC5 沒有讀取組別的退賽保留政策', file: 'functions/pipeline.js',
    from: 'const withdrawalPolicy = divisionSnap.data()?.withdrawalPolicy;', to: 'const withdrawalPolicy = undefined;' },
  { name: 'FN#DISC1 刪除場次不更新公開榜', file: 'functions/index.js',
    from: '// 刪除與重開也要移除舊統計；', to: 'if (!after) return; // 刪除與重開也要移除舊統計；' },
  { name: 'FN#DISC2 重開比賽仍留舊分數', file: 'functions/index.js',
    from: '[before, after].some(m => DECIDED.includes(m?.status))', to: '[after].some(m => DECIDED.includes(m?.status))' },
  { name: 'FN#DISC3 完賽後作廢事件沒有更新榜單', file: 'functions/index.js',
    from: 'if (match?.divisionId && DECIDED.includes(match.status)) {', to: 'if (false) {' },
  { name: 'FN#DISC4 刪除球隊沒有更新榜單', file: 'functions/index.js',
    from: "if (before && (changedAny(before, after, ['name', 'shortName', 'divisionId', 'status', 'withdrawn'])\n        || before.display?.scorerBoard !== after?.display?.scorerBoard)) {", to: 'if (false) {' },
  {
    name: 'FN#JER1 球員 ID 又綁背號', file: 'functions/team-import.js',
    from: 'const memberId = `p-${team.teamId.slice(4)}-${index + 1}`;', to: 'const memberId = `p-${m.jerseyNo}`;'
  },
  {
    name: 'FN#JER2 修改漏掉同隊重號檢查', file: 'functions/member-identity.js',
    from: 'fields.jerseyNo != null && membersSnap.docs.some', to: 'false && membersSnap.docs.some'
  },
  {
    name: 'FN#JER3 改號後未開賽陣容仍留舊背號', file: 'functions/member-identity.js',
    from: '...(jerseyChanged ? { jerseyNo: fields.jerseyNo } : {})', to: '...(jerseyChanged ? { jerseyNo: previous.jerseyNo } : {})'
  },
  {
    name: 'FN#CSV5 背景 trigger 錯誤恢復跨隊退件', file: 'functions/index.js',
    from: 'const r = await syncRosterFor({ eventId, teamId, memberId });',
    to: "if (!before && after?.idLast4) { const same = await db().collectionGroup('members').where('idLast4', '==', after.idLast4).get(); if (same.docs.some(d => d.ref.path.startsWith('events/' + eventId + '/teams/') && d.ref.parent.parent.id !== teamId && d.data().birthDate === after.birthDate)) { await db().doc('events/' + eventId + '/teams/' + teamId + '/members/' + memberId).update({ status: 'rejected' }); return; } } const r = await syncRosterFor({ eventId, teamId, memberId });"
  },
  {
    name: 'FN#CSV3 補件不擋舊版本覆蓋', file: 'functions/member-identity.js',
    from: '(member.identityRevision ?? 0) !== revision', to: 'false'
  },
  {
    name: 'FN#CSV4 補件錯誤恢復跨隊限制', file: 'functions/member-identity.js',
    from: 'const previous = { birthDate:', to: "const duplicate = await tx.get(db().collectionGroup('members').where('idLast4', '==', fields.idLast4)); if (duplicate.docs.some(d => d.ref.path !== memberRef.path && d.data().birthDate === fields.birthDate)) fail('already-exists', '同人跨隊'); const previous = { birthDate:"
  },
  {
    name: 'FN#CSV1 非管理員也能匯入', file: 'functions/team-import.js',
    from: "['admin', 'super_admin'].includes(r)", to: "['admin', 'super_admin', 'scorer'].includes(r)"
  },
  {
    name: 'FN#CSV2 伺服器匯入錯誤恢復跨隊限制', file: 'functions/team-import.js',
    from: 'const prepared = plan.teams.map', to: "const allMembers = await Promise.all(teamSnap.docs.map(t => tx.get(t.ref.collection('members')))); if (plan.teams.some(t => t.members.some(m => allMembers.some(s => s.docs.some(d => m.birthDate && m.idLast4 && d.data().birthDate === m.birthDate && d.data().idLast4 === m.idLast4))))) fail('already-exists', '同人跨隊'); const prepared = plan.teams.map"
  },
  {
    name: 'FN#CSV-CAP 匯入後第 16 人起又被自動退件', file: 'functions/pipeline.js',
    from: "if (imported?.source === 'csv' && imported.captainUid === null && imported.rosterLocked === true)",
    to: 'if (false)',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/team-import.test.js --testNamePattern=超過 --silent'
  },
  {
    name: 'FN#CSV-CAP-SOURCE 一般球隊偽造 CSV 標記就繞過上限', file: 'functions/pipeline.js',
    from: "imported?.source === 'csv' && imported.captainUid === null && imported.rosterLocked === true",
    to: "imported?.source === 'csv'",
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/registration.test.js --testNamePattern=偽造 --silent'
  },
  {
    name: 'FN#1 rankingRule 找不到就套預設（fail-open → 用錯規則排出一份看似正常的積分榜）',
    file: 'functions/store.js',
    from: '  if (!rule) throw new Error(`config/rankingRules 沒有 ${rankingRuleId}`);',
    to: "  if (!rule) return { points: { win: 3, draw: 1, loss: 0 }, criteria: ['points'] };"
  },
  {
    name: 'FN#2 小組設定讀不到就跳過重算（積分榜安靜地停在舊版）',
    file: 'functions/pipeline.js',
    from: '  if (!group) throw new Error(`找不到小組設定：${divisionId}/${stageId}/${groupId}`);',
    to: '  if (!group) return null;'
  },
  {
    name: 'FN#3 晉級解算不看前置條件（分組賽還沒打完就把 A1 填進冠軍賽）',
    file: 'functions/pipeline.js',
    from: '  if (!gate.ready && (!force || division.manualHold === true)) {',
    to: '  if (false) {'
  },
  {
    name: 'FN#4 最終排名沒算完也照樣發布（公開端掛出錯的名次）',
    file: 'functions/pipeline.js',
    from: '  if (!complete) return { published: false, missing, ranking };',
    to: '  if (false) return { published: false, missing, ranking };'
  },
  {
    name: 'FN#5 積分榜不帶隊名（公開端每一列都要自己再查一次 teams）',
    file: 'functions/pipeline.js',
    from: '    teamMeta: teamMetaOf(teams),',
    to: '    teamMeta: {},'
  },
  {
    name: 'FN#6 對帳結論沒變也照寫（跟 onMatchWritten 互相打，每顆進球白花一次寫入）',
    file: 'functions/pipeline.js',
    from: '  if (match.scoreMismatch === mismatch) return { changed: false, mismatch, derived: r.derived };',
    to: '  if (false) return { changed: false, mismatch, derived: r.derived };'
  },
  {
    name: 'FN#7 射手榜不過濾未完賽場次（進行中的比賽就先進榜）',
    file: 'functions/pipeline.js',
    from: '  const counted = countedMatchIdsOf(matches, { teams, withdrawalPolicy });',
    to: '  const counted = new Set(matches.map(m => m.matchId));'
  },
  {
    name: 'FN#8 看板用事件上的真名（未滿 13 歲的球員真名被公開掛出去，R-PRIV-001）',
    file: 'functions/pipeline.js',
    from: "      name: r?.displayName ?? null,          // ← 已遮蔽的公開名，查不到就留 null",
    to: "      name: r?.displayName ?? e.playerName ?? null,"
  },
  {
    name: 'FN#9 重建看板時把整份 rows 蓋掉（一個組別完賽，其他五組的榜全消失）',
    file: 'functions/pipeline.js',
    from: "    const kept = (snap.data()?.rows || []).filter(r => r.divisionId !== divisionId\n        && teams[r.teamId]?.divisionId === r.divisionId\n        && (boardId !== 'scorers' || teams[r.teamId]?.display?.scorerBoard !== false));",
    to: "    const kept = [];"
  },
  {
    name: 'FN#10 看板寫成每組一份（規格是單一文件，首頁只監聽一份）',
    file: 'functions/pipeline.js',
    from: "  const ref = evRef(eventId).collection('boards').doc(boardId);",
    to: "  const ref = evRef(eventId).collection('boards').doc(`${boardId}__${divisionId}`);"
  },
  {
    name: 'FN#11 賽事日期讀不到時給一個很晚的基準日（所有人都算成年，兒童真名外洩）',
    file: 'functions/pipeline.js',
    from: `  return typeof d === 'string' ? d : '1900-01-01';`,
    to: `  return typeof d === 'string' ? d : '2999-01-01';`
  },
  {
    name: 'FN#12 不是 approved 時不刪投影（被移除的隊員留在公開名冊上）',
    file: 'functions/pipeline.js',
    from: `    tx.delete(rosterRef);   // 不存在也成功；提交錯誤傳出，由 trigger 重試`,
    to: `    // noop`
  },
  {
    name: 'FN#13 重複申請退掉先送的那一筆（後來的把先來的擠掉）',
    file: 'functions/pipeline.js',
    from: `  pending.sort((a, b) => (ms(a) - ms(b)) || a.id.localeCompare(b.id, 'en'));`,
    to: `  pending.sort((a, b) => (ms(b) - ms(a)) || b.id.localeCompare(a.id, 'en'));`
  },
  {
    name: 'FN#14 已核准人數把待審的也算進去',
    file: 'functions/pipeline.js',
    from: `    .collection('members').where('status', '==', 'approved');`,
    to: `    .collection('members');`
  },
  {
    name: 'FN#15 config/liff 讀不到就套一個預設 channelId（fail-open，等於誰的 token 都收）',
    file: 'functions/line.js',
    from: `  if (!channelId) throw new Error('config/liff.channelId 不存在，無法驗證 LINE 登入');`,
    to: `  if (!channelId) return { channelId: '0000000000', liffId: null };`
  },
  {
    name: 'FN#16 名錄相信呼叫端傳的 roles（登入時就能自稱大總管）',
    file: 'functions/line.js',
    from: `  const roles = staff?.roles ?? [];`,
    to: `  const roles = arguments[0]?.roles ?? staff?.roles ?? [];`
  },

  // ── 挑戰系統管線（M6-a）─────────────────────────────────────
  {
    name: 'FN#17 ⭐ 抽獎張數用累加（觸發器重放就多發一張，而券收不回來）',
    file: 'functions/pipeline.js',
    from: `    tx.update(ref, {
      completedChallengeIds: completed,
      luckyDrawEntries: entries,`,
    to: `    tx.update(ref, {
      completedChallengeIds: completed,
      luckyDrawEntries: FieldValue.increment(1),`
  },
  {
    name: 'FN#18 ⭐ 一關全部作廢時不從完成清單移除（玩家留著那張券）',
    file: 'functions/pipeline.js',
    from: `    } else if (cur.includes(challengeId)) {
      completed = cur.filter(id => id !== challengeId);      // 全部作廢 → 退回
    }`,
    to: `    }`
  },
  {
    name: 'FN#19 ⭐ 排行榜的 totalPlayers 用截斷後的列數（第 51 名之後算不出名次）',
    file: 'functions/pipeline.js',
    from: `      topN: LEADERBOARD_TOP_N,
      totalPlayers,`,
    to: `      topN: LEADERBOARD_TOP_N,
      totalPlayers: rows.length,`
  },
  {
    name: 'FN#20 ⭐ 關卡統計把作廢的也算進去（活動成效報告虛胖）',
    file: 'functions/pipeline.js',
    from: `    const live = attempts.filter(a => a?.voided !== true);
    const stats = {`,
    to: `    const live = attempts;
    const stats = {`
  },
  {
    name: 'FN#21 ⭐ 關卡設定讀不到就套一份預設（算錯的排行榜跟算對的長得一樣）',
    file: 'functions/pipeline.js',
    from: `  const challenge = await loadChallenge(eventId, challengeId);`,
    to: `  const challenge = await loadChallenge(eventId, challengeId).catch(() => ({ rankingRule: 'higher' }));`
  },
  {
    name: "FN#24 ⭐ 人數上限把隊職員也算成球員（滿編的隊登記不了領隊）",
    file: 'functions/pipeline.js',
    from: "  const players = snap.docs.filter(d => isPlayer(d.data()));\n  if (players.length <= maxPlayers) return { rejected: [] };",
    to: "  const players = snap.docs;\n  if (players.length <= maxPlayers) return { rejected: [] };"
  },
  {
    name: "FN#25 ⭐ playerCount 數的是全部已核准的人（rules 會提早擋掉隊職員）",
    file: 'functions/pipeline.js',
    from: "  const playerCount = snap.docs.filter(d => isPlayer(d.data())).length;",
    to: "  const playerCount = snap.size;"
  },
  {
    name: "FN#26 ⭐ 聯絡方式不比對憑證（知道代號就改得動別人的電話）",
    file: 'functions/pipeline.js',
    from: "  if (createHash('sha256').update(k).digest('hex') !== hash) {",
    to: "  if (false) {"
  },
  {
    name: "FN#27 ⭐ 聯絡方式不檢查手機格式（市話存進去，通知打不到）",
    file: 'functions/pipeline.js',
    from: "  if (!normalized) throw new Error('手機號碼要是 09 開頭的 10 碼');",
    to: ""
  },
  {
    name: '#FN28 ⭐ 配發挑戰卡不看帳號已經有的那一張（同一個人每登入一次多一張卡）',
    file: 'functions/pipeline.js',
    from: `    if (existing) {
      const p = await tx.get(playerRef(eventId, existing));`,
    to: `    if (false) {
      const p = await tx.get(playerRef(eventId, existing));`
  },
  {
    name: '#FN30 ⭐ 配卡回傳未正規化的 LINE 名稱（回應與卡片暱稱不同）',
    file: 'functions/pipeline.js',
    from: '    return { playerId, nickname: player.nickname, created: true };',
    to: '    return { playerId, nickname: name, created: true };',
    testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/challenge.test.js -t FC16g --silent'
  },
  {
    name: '#FN29 ⭐ 聯絡方式不檢查卡主（知道代號的登入者就能改別人的電話）',
    file: 'functions/pipeline.js',
    from: `    if (!u.exists || u.data().gamePassId !== id) throw new Error('這張卡不是你的：請用領卡時的 LINE 帳號登入');`,
    to: `    if (false) throw new Error('這張卡不是你的：請用領卡時的 LINE 帳號登入');`
  }
];

// 想過但沒有加的一條：把 ensureApp() 的 `getApps()[0] ??` 拿掉。
// 實測 firebase-admin v13 重複呼叫 initializeApp() 並不會丟錯，
// 所以那個守衛不是承重牆，變異也就抓不到——留一條永遠漏掉的變異
// 只會讓整份報告失去意義，不如寫清楚為什麼沒有它。

module.exports = { MUTANTS };
if (require.main === module) process.exit(runMutants({
  mutants: MUTANTS,
  // 原有四個套件保持完整；新一致性案例與可信變異由独立指令驗證。
  testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/pipeline.test.js tests/functions/challenge.test.js tests/functions/registration.test.js tests/functions/team-import.test.js --silent',
  title: '結果管線｜變異測試'
}));
