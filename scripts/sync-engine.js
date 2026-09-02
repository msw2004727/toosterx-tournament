#!/usr/bin/env node
/**
 * 把 js/engine/ 同步一份到 functions/engine/
 * ------------------------------------------------------------------
 * 為什麼需要這個腳本（R-ENG-001：積分／排名邏輯只能有一份實作）：
 *
 *   1. Firebase 部署時**只會上傳 firebase.json 的 functions.source 那個目錄**。
 *      `js/engine/` 在 functions/ 外面，`import '../../js/engine/standing.js'`
 *      本機模擬器過得去、部署上去就是 MODULE_NOT_FOUND。
 *   2. 前端沒有打包工具，`js/engine/` 必須留在網站根目錄底下讓瀏覽器直接載。
 *      所以不能把它搬進 functions/。
 *
 * 結論：`js/engine/` 是唯一的真相來源，`functions/engine/` 是**建置產物**——
 * 進 .gitignore、每次部署／起模擬器／跑測試前重新產生。
 *
 * ⚠️ 不要編輯 functions/engine/ 底下的任何檔案，下一次同步就會被蓋掉。
 *
 * 用法：
 *   node scripts/sync-engine.js          同步
 *   node scripts/sync-engine.js --check  只檢查是否一致（不寫入，CI 用）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'js/engine';
const DEST = 'functions/engine';

const sources = readdirSync(SRC).filter(f => f.endsWith('.js')).sort();
if (!sources.length) {
  console.error(`❌ ${SRC} 底下沒有任何 .js，同步中止`);
  process.exit(1);
}

const check = process.argv.includes('--check');

if (check) {
  const drift = [];
  for (const f of sources) {
    const to = join(DEST, f);
    if (!existsSync(to)) { drift.push(`${f}（缺少）`); continue; }
    if (readFileSync(join(SRC, f), 'utf8') !== readFileSync(to, 'utf8')) drift.push(`${f}（內容不同）`);
  }
  // 多出來的檔案也算漂移：引擎刪掉一個模組，複本卻還留著會讓 import 假裝還能用
  const extra = existsSync(DEST)
    ? readdirSync(DEST).filter(f => f.endsWith('.js') && !sources.includes(f))
    : [];
  for (const f of extra) drift.push(`${f}（來源已不存在）`);

  if (drift.length) {
    console.error('❌ functions/engine 與 js/engine 不一致：');
    for (const d of drift) console.error('   -', d);
    console.error('   跑 `npm run sync:engine` 重新產生。');
    process.exit(1);
  }
  console.log(`✅ functions/engine 與 js/engine 一致（${sources.length} 個檔案）`);
  process.exit(0);
}

// 先整個刪掉再重建：留著舊檔的話，引擎刪掉某個模組之後複本仍然存在，
// functions 會繼續 import 到一個「已經不該存在」的實作。
rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });

for (const f of sources) {
  writeFileSync(join(DEST, f), readFileSync(join(SRC, f), 'utf8'), 'utf8');
}

// 放一張明顯的告示，避免有人在 functions/engine 底下改東西（改了會被下次同步吃掉）
writeFileSync(join(DEST, 'DO-NOT-EDIT.md'),
  '# 這個目錄是自動產生的\n\n' +
  '來源是 `js/engine/`，由 `scripts/sync-engine.js` 複製過來（R-ENG-001）。\n' +
  '在這裡改東西，下一次 `npm run sync:engine` 就會被蓋掉。要改請改 `js/engine/`。\n',
  'utf8');

console.log(`✅ ${SRC} → ${DEST}（${sources.length} 個檔案）`);
