#!/usr/bin/env node
/**
 * 種子資料 CLI
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/seed.js --dry-run                        只印統計，不連線
 *   node scripts/seed.js --project feda-cup-demo          寫入 demo 專案
 *   node scripts/seed.js --project feda-cup-demo --reset  先清空種子資料再寫
 *   node scripts/seed.js --emulator                       寫入本機 Emulator
 *
 * ⚠️ 安全鎖：專案 ID 不含 "demo" 一律中止，避免誤灌正式資料庫。
 * ⚠️ --reset 只刪除帶有 seedData:true 的文件，不會動到現場產生的真實資料。
 *
 * 認證：GOOGLE_APPLICATION_CREDENTIALS 指向服務帳戶金鑰，
 *       或先跑 `gcloud auth application-default login`。
 */

import { buildSeed, EVENT_ID } from './seed/build.js';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const DRY = has('--dry-run');
const RESET = has('--reset');
const EMULATOR = has('--emulator');
const PROJECT = val('--project') || (EMULATOR ? 'demo-local' : undefined);

const fmtTime = d =>
  d ? new Intl.DateTimeFormat('zh-TW', {
        timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short'
      }).format(d)
    : '—';

function report(stats) {
  console.log('\n📋 種子資料統計');
  console.log('─'.repeat(52));
  console.log(`  文件總數        ${stats.totalDocs}`);
  console.log(`  球隊            ${stats.teams}`);
  console.log(`  球員與職員      ${stats.members}（公開投影 ${stats.roster}）`);
  console.log(`  場次            ${stats.matches}`);
  console.log(`  積分榜          ${stats.standings}`);
  console.log(`  挑戰關卡        ${stats.challenges}`);
  console.log(`  工作人員        ${stats.staff}`);
  console.log('─'.repeat(52));
  console.log('  各組別場次');
  for (const [d, n] of Object.entries(stats.matchesByDivision)) {
    console.log(`    ${d.padEnd(12)} ${n} 場`);
  }
  console.log('  各日場次');
  for (const [d, n] of Object.entries(stats.matchesByDate)) {
    console.log(`    ${d}   ${n} 場`);
  }
  console.log('─'.repeat(52));
  console.log(`  首場開賽        ${fmtTime(stats.firstKickoff)}`);
  console.log(`  末場開賽        ${fmtTime(stats.lastKickoff)}`);
  console.log('─'.repeat(52));
  console.log('  排程自檢');
  const ok = n => (n === 0 ? '✅' : '❌');
  console.log(`    ${ok(stats.teamConflicts)} 同隊同時段衝突    ${stats.teamConflicts}`);
  console.log(`    ${ok(stats.venueConflicts)} 場地同時段衝突    ${stats.venueConflicts}`);
  console.log(`    ℹ️ 待晉級（placeholder）場次  ${stats.placeholderMatches}`);
  const dist = Object.entries(stats.groupMatchDist)
    .map(([n, teams]) => `${teams} 隊各 ${n} 場`).join('、');
  console.log(`    ℹ️ 分組賽場次分布  ${dist}`);
  console.log('');
  if (stats.teamConflicts || stats.venueConflicts) {
    throw new Error('排程有衝突，請檢查 scheduleDay()');
  }
}

async function main() {
  const { docs, stats } = buildSeed();
  report(stats);

  if (DRY) {
    console.log('✅ --dry-run：只做驗算，沒有連線也沒有寫入。\n');
    return;
  }

  if (!PROJECT) {
    console.error('❌ 缺少 --project <projectId>（或加 --emulator）');
    process.exit(1);
  }
  if (!EMULATOR && !PROJECT.includes('demo')) {
    console.error(`❌ 安全鎖：只允許對含有 "demo" 的專案灌種子資料。目前：${PROJECT}`);
    console.error('   若真的要寫入正式環境，請改用管理後台的匯入功能。');
    process.exit(1);
  }

  if (EMULATOR && !process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  }

  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  initializeApp({
    projectId: PROJECT,
    credential: EMULATOR ? undefined : applicationDefault()
  });
  const db = getFirestore();

  if (RESET) {
    console.log('🧹 清除舊的種子資料…');
    const removed = await resetSeed(db);
    console.log(`   已刪除 ${removed} 筆\n`);
  }

  console.log(`🚀 寫入 ${PROJECT} …`);
  let written = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    for (const d of docs.slice(i, i + 400)) {
      batch.set(db.doc(d.path), withTimestamps(d.data, FieldValue), { merge: false });
    }
    await batch.commit();
    written += Math.min(400, docs.length - i);
    process.stdout.write(`\r   ${written} / ${docs.length}`);
  }
  console.log('\n✅ 完成\n');
}

function withTimestamps(data, FieldValue) {
  return { ...data, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
}

/** 只刪 seedData:true 的文件，現場真實資料不受影響 */
async function resetSeed(db) {
  const targets = [
    `events/${EVENT_ID}/matches`,
    `events/${EVENT_ID}/standings`,
    `events/${EVENT_ID}/teams`,
    `events/${EVENT_ID}/challenges`,
    `events/${EVENT_ID}/leaderboards`,
    `events/${EVENT_ID}/venues`,
    `events/${EVENT_ID}/divisions`,
    `events/${EVENT_ID}/players`,
    `events/${EVENT_ID}/attempts`,
    'staff'
  ];
  let n = 0;
  for (const col of targets) {
    n += await deleteCollection(db, col);
  }
  return n;
}

async function deleteCollection(db, path, depth = 0) {
  if (depth > 3) return 0;
  const snap = await db.collection(path).get();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 300) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(i, i + 300)) {
      for (const sub of await doc.ref.listCollections()) {
        n += await deleteCollection(db, sub.path, depth + 1);
      }
      batch.delete(doc.ref);
      n += 1;
    }
    await batch.commit();
  }
  return n;
}

main().catch(err => {
  console.error('\n❌ 失敗：', err.message);
  process.exit(1);
});
