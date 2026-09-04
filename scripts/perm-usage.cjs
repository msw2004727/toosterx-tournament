#!/usr/bin/env node
/**
 * 盤點：`js/config.js` 的每一條權限碼，前端到底有沒有人讀？
 * ------------------------------------------------------------------
 * 2026-09-04 在真站上實測時發現：權限開關把 `match.finish` 關掉之後，
 * 賽務台的「完賽送出」按鈕**還在**——因為那一頁根本沒有問過 `can()`。
 *
 * 一條沒有人讀的權限碼，在權限開關那一頁就是一個按了不會有效果的切換。
 * 那正是這個專案最不能容忍的一種故障（「按了沒反應是最難回報的」）。
 *
 * 這支腳本把「權限字典」與「實際用法」對起來，`tests/unit/perms.test.js`
 * 會呼叫它。純讀檔，不改任何東西。
 *
 *   node scripts/perm-usage.cjs        # 印出報告
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * `js/core/firebase.js` 提供的幾支包裝函式也算「讀了那條權限」。
 * 少了這一層，盤點會把 live.js 誤判成沒有做權限判斷（第一次就誤判了）。
 */
const WRAPPERS = {
  'match.score.write': 'canScore',
  'checkin.write': 'canCheckin',
  'match.confirm': 'canConfirm'
};

/** 字典與判斷入口本身不算「使用」——它們是定義的地方 */
const DEFINITION_FILES = ['js/config.js', 'js/core/firebase.js'];

function jsFiles(dir, out = []) {
  for (const f of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${f.name}`;
    if (f.isDirectory()) jsFiles(rel, out);
    else if (f.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/** @returns {Record<string, string[]>} 權限碼 → 讀到它的檔案 */
function usageByCode(codes) {
  const files = jsFiles('js').filter(f => !DEFINITION_FILES.includes(f));
  const out = {};
  for (const code of codes) {
    out[code] = files.filter(f => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      if (src.includes(`can('${code}')`)) return true;
      const w = WRAPPERS[code];
      return Boolean(w) && new RegExp(`\\b${w}\\s*\\(`).test(src);
    });
  }
  return out;
}

module.exports = { usageByCode, WRAPPERS };

if (require.main === module) {
  const src = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
  const codes = [...src.matchAll(/\{\s*code:\s*'([^']+)'[^}]*minRole:/g)].map(m => m[1]);
  const usage = usageByCode(codes);
  let missing = 0;
  for (const [code, files] of Object.entries(usage)) {
    if (!files.length) missing += 1;
    console.log(`${files.length ? '✅' : '❌'} ${code.padEnd(24)} ${files.join(', ') || '(沒有任何地方讀)'}`);
  }
  console.log(`\n${codes.length - missing} / ${codes.length} 條權限碼有人讀`);
  process.exit(missing ? 1 : 0);
}
