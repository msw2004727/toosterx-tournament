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
    from: '  if (!gate.ready && !force) {',
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
    from: '  const counted = countedMatchIdsOf(matches);',
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
    from: "    const kept = (snap.data()?.rows || []).filter(r => r.divisionId !== divisionId);",
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
    from: `    await rosterRef.delete().catch(() => {});   // 本來就沒有也算成功`,
    to: `    // noop`
  },
  {
    name: 'FN#13 重複申請退掉先送的那一筆（後來的把先來的擠掉）',
    file: 'functions/pipeline.js',
    from: `    .filter(d => d.id !== memberId && d.data().status === 'pending');`,
    to: `    .filter(d => d.id !== memberId);`
  },
  {
    name: 'FN#14 已核准人數把待審的也算進去',
    file: 'functions/pipeline.js',
    from: `    .collection('members').where('status', '==', 'approved').get();`,
    to: `    .collection('members').get();`
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
  }
];

// 想過但沒有加的一條：把 ensureApp() 的 `getApps()[0] ??` 拿掉。
// 實測 firebase-admin v13 重複呼叫 initializeApp() 並不會丟錯，
// 所以那個守衛不是承重牆，變異也就抓不到——留一條永遠漏掉的變異
// 只會讓整份報告失去意義，不如寫清楚為什麼沒有它。

process.exit(runMutants({
  mutants: MUTANTS,
  testCmd: 'node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/functions/ --silent',
  title: '結果管線｜變異測試'
}));
