#!/usr/bin/env node
/**
 * 正式站設定 bootstrap
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/bootstrap-prod.mjs --project feda-cup-2026 --dry-run   只列出會寫什麼
 *   node scripts/bootstrap-prod.mjs --project feda-cup-2026 --yes       真的寫入
 *   node scripts/bootstrap-prod.mjs --project feda-cup-demo             對 demo 演練（不用 --yes）
 *
 * 這一支跟 `scripts/seed.js` 是兩件事：
 *   ・seed.js 灌**假資料**（38 隊、75 場、492 名球員），依 R-SEED-001 只准對 demo 跑。
 *   ・這一支只灌**設定**：組別、場地、五個關卡、抽獎規則、賽程參數、LINE、
 *     報名開關、角色權限、空的排行榜。**一支球隊、一筆成績都不會有。**
 *
 * 設定的形狀從 `scripts/seed/build.js` 拿（同一份 builder，不寫第二份），
 * 再把「示範用」的欄位改成正式站的值：
 *   ・`seedData: true` 一律拿掉——seed.js --reset 是依這個旗標刪文件的，
 *     正式站的設定絕對不可以被那一支刪掉
 *   ・組別 `schedulePublished: false`、`teamCount: 0`——賽程要等真的報名進來才產生
 *   ・`config/env` 是 prod、`allowSelfServeStaff: false`——「切換身分」只有 demo 有
 *   ・`config/liff` 換成正式站的 Channel
 *   ・`config/registration` 預設**關閉**，由總管在後台打開並設截止日
 *
 * 三條安全規矩：
 *   1. **只補不存在的文件，永遠不覆蓋。** 重跑第二次不會把總管在後台調過的
 *      東西打回預設值（2026-09-03 種子就這樣關掉過一次開放中的報名）。
 *   2. 對不含 "demo" 的專案要加 `--yes`，而且會先印出清單再寫。
 *   3. 路徑白名單：不在名單上的集合一律不寫，就算 builder 產出來也丟掉。
 *
 * 認證：`gcloud auth application-default login`，或 GOOGLE_APPLICATION_CREDENTIALS。
 */
import { buildSeed } from './seed/build.js';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const PROJECT = val('--project');
const DRY = has('--dry-run');
const YES = has('--yes');

/** 正式站的 LINE Login Channel（跟 js/firebase-config.js 的 LIFF_PROD 一致） */
const LIFF_PROD = { liffId: '2011382367-7GvTaaXv', channelId: '2011382367' };
const LIFF_DEMO = { liffId: '2011382448-5wfKxpsM', channelId: '2011382448' };

/** 只有這些路徑樣式會被寫入。{id} 是任意文件 id。 */
const ALLOW = [
  'config/{id}',
  'events/{id}',
  'events/{id}/divisions/{id}',
  'events/{id}/venues/{id}',
  'events/{id}/challenges/{id}',
  'events/{id}/leaderboards/{id}',
  'rolePermissions/{id}'
];

const patternOf = path => path.split('/').map((s, i) => (i % 2 === 1 ? '{id}' : s)).join('/');

/** 拿掉 seedData，並依路徑把示範值換成正式站的值 */
function toProd(d, isDemo) {
  const data = { ...d.data };
  delete data.seedData;

  if (d.path === 'config/env') {
    return { env: isDemo ? 'demo' : 'prod', allowSelfServeStaff: isDemo,
      note: isDemo ? '示範環境' : '正式環境。allowSelfServeStaff 一定要是 false——「切換身分」只有 demo 有。' };
  }
  if (d.path === 'config/liff') {
    const l = isDemo ? LIFF_DEMO : LIFF_PROD;
    return { ...l, note: '由 scripts/bootstrap-prod.mjs 寫入，值跟 js/firebase-config.js 一致' };
  }
  if (d.path === 'config/registration') {
    // 預設關閉。開放與截止日由總管在 #/admin/registration 設，
    // 或用 scripts/set-registration.mjs（closesAt 一定要是 Timestamp）
    return { ...data, open: false, opensAt: null, closesAt: null };
  }
  if (/^events\/[^/]+$/.test(d.path)) {
    return { ...data, flags: { ...(data.flags || {}), registrationOpen: false } };
  }
  if (/^events\/[^/]+\/divisions\/[^/]+$/.test(d.path)) {
    return { ...data, teamCount: 0, schedulePublished: false, finalRankingPublished: false, finalRanking: null, draw: null };
  }
  if (/^events\/[^/]+\/venues\/[^/]+$/.test(d.path)) {
    return { ...data, activeMatchId: null };
  }
  if (/^events\/[^/]+\/challenges\/[^/]+$/.test(d.path)) {
    return { ...data, stats: { players: 0, attempts: 0 } };
  }
  if (/^events\/[^/]+\/leaderboards\/[^/]+$/.test(d.path)) {
    return { ...data, rows: [], totalPlayers: 0, version: 0, ladder: { values: [], times: [] } };
  }
  if (/^rolePermissions\//.test(d.path)) {
    return { ...data, note: '由 scripts/bootstrap-prod.mjs 依 js/config.js 的 PERMISSIONS 產生；總管可逐條調整' };
  }
  return data;
}

async function main() {
  if (!PROJECT) {
    console.error('❌ 缺少 --project <projectId>');
    process.exit(1);
  }
  const isDemo = PROJECT.includes('demo');
  if (!isDemo && !YES && !DRY) {
    console.error(`❌ 對正式專案（${PROJECT}）寫入要加 --yes。先用 --dry-run 看清單。`);
    process.exit(1);
  }

  const { docs } = buildSeed();
  const picked = docs.filter(d => ALLOW.includes(patternOf(d.path)));
  const dropped = docs.length - picked.length;

  const plan = picked.map(d => ({ path: d.path, data: toProd(d, isDemo) }));

  // 白名單以外的東西一筆都不能有：多一個字都是 bug
  for (const p of plan) {
    if (!ALLOW.includes(patternOf(p.path))) throw new Error(`白名單外的路徑：${p.path}`);
    if (JSON.stringify(p.data).includes('"seedData"')) throw new Error(`seedData 沒拿乾淨：${p.path}`);
  }

  console.log(`\n🧭 ${isDemo ? 'DEMO 演練' : '正式站'}：${PROJECT}`);
  console.log(`   設定文件 ${plan.length} 筆（builder 另外產出的 ${dropped} 筆假資料已丟掉）\n`);
  const byPattern = {};
  for (const p of plan) byPattern[patternOf(p.path)] = (byPattern[patternOf(p.path)] || 0) + 1;
  for (const [k, v] of Object.entries(byPattern)) console.log(`   ${String(v).padStart(3)}  ${k}`);

  if (DRY) {
    console.log('\n✅ --dry-run：沒有連線、沒有寫入。');
    return;
  }

  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');
  initializeApp({ projectId: PROJECT, credential: applicationDefault() });
  const db = getFirestore();

  // 只補不存在的：先查哪些已經在了
  const exists = new Set();
  for (let i = 0; i < plan.length; i += 100) {
    const refs = plan.slice(i, i + 100).map(p => db.doc(p.path));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s, j) => { if (s.exists) exists.add(plan[i + j].path); });
  }
  const toWrite = plan.filter(p => !exists.has(p.path));

  if (exists.size) {
    console.log(`\nℹ️  已存在、保留不覆蓋（${exists.size} 筆）：`);
    for (const p of [...exists].slice(0, 12)) console.log(`     ${p}`);
    if (exists.size > 12) console.log(`     …還有 ${exists.size - 12} 筆`);
  }
  if (!toWrite.length) {
    console.log('\n✅ 沒有要補的文件，什麼都沒寫。');
    return;
  }

  console.log(`\n🚀 寫入 ${toWrite.length} 筆到 ${PROJECT} …`);
  for (let i = 0; i < toWrite.length; i += 400) {
    const batch = db.batch();
    for (const p of toWrite.slice(i, i + 400)) {
      batch.set(db.doc(p.path), {
        ...p.data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
      }, { merge: false });
    }
    await batch.commit();
  }
  console.log('✅ 完成。接下來：');
  console.log('   1. 用 LINE 登入一次，拿到 uid');
  console.log(`   2. node scripts/grant-super-admin.mjs --project ${PROJECT} --uid U… --name 名字`);
  console.log('   3. 在 #/admin/registration 開放報名並設截止日');
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
