#!/usr/bin/env node
/**
 * 變異殘留守衛
 * ------------------------------------------------------------------
 * 變異測試會把原始碼「改回錯的」再跑一次測試。正常結束時它會還原，
 * 但被 SIGKILL 砍掉時（例如從外面砍 emulator 的行程）還原沒有機會執行，
 * 原始碼就停在被改壞的狀態。
 *
 * 2026-09-03 實際發生過：firestore.rules 停在變異狀態，被 commit 並部署，
 * 結果是「Admin 可以指派身分」與「檢錄紀錄可以刪除」兩個真的漏洞上線。
 * 那一次是 CI 紅燈才發現的——而 CI 是推上去之後才跑。
 *
 * 這支掛在每一個測試指令的最前面（package.json 的 pretest:*），
 * 看到殘留就自動還原並中止，讓人不可能在被改壞的樹上跑測試或提交。
 *
 *   node scripts/mutation-guard.cjs
 */
const fs = require('fs');

const LOCK = '.mutation-in-progress.json';

// ⚠️ 變異執行器自己跑的那幾次要放行。
//    它跑的就是 `npm run test:unit`，而那條指令前面掛著這支守衛——
//    不放行的話每一條變異都會因為守衛而失敗，看起來「全部被抓到」，
//    等於整個變異測試變成一盞永遠是綠的燈（R-TEST-001 講的就是這種）。
if (process.env.FEDA_MUTATION_RUN === '1') process.exit(0);

if (!fs.existsSync(LOCK)) process.exit(0);

let backups;
try {
  backups = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
} catch (e) {
  console.error(`\n❌ ${LOCK} 讀不出來（${e.message}）。`);
  console.error('   這代表上一次變異測試被中斷，而且原始檔案的備份也壞了。');
  console.error('   請用 `git status` 檢查有沒有非預期的改動，必要時 git checkout 還原。\n');
  process.exit(1);
}

console.error('\n❌ 偵測到上一次變異測試沒有正常結束（可能是被強制中止）。');
console.error('   以下檔案可能停在「被改壞」的狀態，現在自動還原：\n');

let changed = 0;
for (const [file, original] of Object.entries(backups)) {
  const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (now === original) {
    console.error(`   ・${file}　（本來就是對的）`);
  } else {
    fs.writeFileSync(file, original, 'utf8');
    console.error(`   ・${file}　⚠️ 已還原`);
    changed++;
  }
}
fs.unlinkSync(LOCK);

console.error(`\n   還原了 ${changed} 個檔案。請重新執行剛才的指令。`);
console.error('   ⚠️ 如果你在這之後已經 commit 過，請務必檢查那次 commit 的 diff。\n');
process.exit(1);
