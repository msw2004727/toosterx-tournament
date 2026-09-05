#!/usr/bin/env node
/**
 * 變異錨點檢查（唯讀，兩秒跑完）
 * ------------------------------------------------------------------
 * 每一條變異都靠一段**逐字比對**的原始碼（`from`）定位。那段程式碼一改，
 * 錨點就對不上，那條變異從此**什麼都不守**——而且報告上印的是
 * `⚠️ 找不到要變異的程式碼`，很容易被當成「漏掉」或被 grep 濾掉。
 *
 * 這一支把「錨點還對不對」從 25 分鐘縮短成兩秒。2026-09-05 就是因為改了
 * `players` 的 `allow update`（拿掉 contact），RU#34 的錨點失效，
 * 跑完一整輪 rules 變異才發現。
 *
 * ⚠️ **唯讀。** 這個檔案不寫任何原始碼——會寫的只有 `scripts/lib/mutate.cjs`，
 *    因為只有它有標記檔與守衛（R-TEST-002）。想跑變異就跑 `npm run test:mutation`，
 *    不要自己寫一支「只跑幾條」的臨時腳本：那種腳本的還原路徑出錯時
 *    沒有任何東西會發現。
 *
 * ⚠️ **不可以 `require()` 那幾個 mutation-*.cjs**：它們結尾是
 *    `process.exit(runMutants(...))`，require 等於真的跑一次整套。
 *    所以這裡純粹把檔案當文字解析。
 */
const fs = require('node:fs');
const path = require('node:path');

// ⚠️ 變異正在跑的時候，原始碼**本來就是被改壞的**——這時候比對錨點會得到
//    一堆假的「過期」。2026-09-05 第一次跑這支就中了（兩條 firestore.rules
//    的錨點看起來過期，其實只是那一刻檔案正被改寫）。
if (fs.existsSync('.mutation-in-progress.json')) {
  console.log('⏳ 變異測試正在執行中，原始碼此刻是被改壞的狀態。');
  console.log('   這時候比對錨點量到的不是你以為的那一份，請等它結束再跑。');
  process.exit(2);
}

const SPECS = [
  'scripts/mutation-check.cjs',
  'scripts/mutation-e2e.cjs',
  'scripts/mutation-fn.cjs',
  'scripts/mutation-rules.cjs'
];

/** 從 i 讀一個字面值（單引號／雙引號／樣板字串都吃得下） */
function readString(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === String.fromCharCode(92)) { j++; continue; }   // 反斜線：跳過被逸出的字元
    if (src[j] === q) {
      try { return { value: eval(src.slice(i, j + 1)), end: j + 1 }; }
      catch { return null; }
    }
  }
  return null;
}

/** `key: <字面值>`，或 `key: IDENT`（用檔案裡的 const 解析） */
function readField(src, from, key, consts) {
  const at = src.indexOf(`${key}: `, from);
  if (at < 0) return null;
  const start = at + key.length + 2;
  const lit = readString(src, start);
  if (lit) return lit.value;
  const m = /^([A-Za-z_$][\w$]*)/.exec(src.slice(start));
  return m && consts[m[1]] !== undefined ? consts[m[1]] : null;
}

let total = 0;
let stale = 0;
const cache = {};

for (const spec of SPECS) {
  const src = fs.readFileSync(spec, 'utf8');

  // 先收集檔案頂端的 `const F = '...'` 這種常數
  const consts = {};
  for (const m of src.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=\s*('[^']*'|"[^"]*")/gm)) {
    consts[m[1]] = eval(m[2]);
  }

  let bad = 0;
  for (let i = 0; ;) {
    const at = src.indexOf('name: ', i);
    if (at < 0) break;
    const name = readString(src, at + 6);
    if (!name) { i = at + 6; continue; }
    i = name.end;

    const file = readField(src, i, 'file', consts);
    const fromAt = src.indexOf('from: ', i);
    const from = fromAt < 0 ? null : readString(src, fromAt + 6)?.value;
    if (!file || from == null) continue;

    total++;
    cache[file] ??= fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (cache[file] === null) {
      stale++; bad++;
      console.log(`  ❌ ${name.value}\n     目標檔不存在：${file}`);
    } else if (!cache[file].includes(from)) {
      stale++; bad++;
      console.log(`  ❌ ${name.value}\n     ${file} 裡找不到：${JSON.stringify(from.slice(0, 72))}`);
    }
  }
  console.log(`${bad === 0 ? '✅' : '❌'} ${path.basename(spec)}${bad ? `　${bad} 條錨點過期` : ''}`);
}

if (stale) {
  console.log(`\n❌ ${total} 條裡有 ${stale} 條錨點過期。`);
  console.log('   那幾條變異現在什麼都不守——把 `from` 更新成目前的程式碼，');
  console.log('   或者那段邏輯真的不見了就把整條變異刪掉。');
  process.exit(1);
}
console.log(`\n✅ ${total} 條變異的錨點全部對得上`);
