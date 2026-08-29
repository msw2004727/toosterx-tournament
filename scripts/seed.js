#!/usr/bin/env node
/**
 * 種子資料｜38 隊假資料
 * ------------------------------------------------------------------
 * 用法：
 *   node scripts/seed.js --project feda-cup-demo
 *   node scripts/seed.js --project feda-cup-demo --reset   先清空再灌
 *
 * ⚠️ 安全鎖：專案 ID 不含 "demo" 時直接中止，避免誤灌正式資料庫。
 * 狀態：TODO(M1)
 */
const args = process.argv.slice(2);
const project = args[args.indexOf('--project') + 1];

if (!project || !project.includes('demo')) {
  console.error('❌ 只允許對含有 "demo" 的專案灌種子資料。目前：', project);
  process.exit(1);
}

console.log('TODO(M1): 建立 6 組別、38 隊、約 600 位球員、5 個挑戰關卡與完整賽程');
