/**
 * 變異測試的共用執行器
 * ------------------------------------------------------------------
 * 「跑得綠」不等於「有鑑別力」。這個檔案負責同一件事的兩種用法：
 *   scripts/mutation-check.cjs  引擎與前端（跑 test:unit）
 *   scripts/mutation-fn.cjs     結果管線（跑 tests/functions/，需要 Emulator）
 *
 * 作法：把修好的缺陷「改回錯的」，確認測試真的會紅。
 */
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * @param {object} o
 * @param {Array<{name:string, file:string, from:string, to:string}>} o.mutants
 * @param {string} o.testCmd  每個變異都會跑一次的指令；非零結束碼代表「抓到了」
 * @param {string} [o.title]
 * @returns {number} process exit code
 */
function runMutants({ mutants, testCmd, title = '變異測試' }) {
  const read = f => fs.readFileSync(f, 'utf8');
  const backups = new Map();
  for (const f of new Set(mutants.map(x => x.file))) backups.set(f, read(f));

  // 有變異失敗時要還原所有檔案，否則會留下壞掉的原始碼
  const restoreAll = () => { for (const [f, s] of backups) fs.writeFileSync(f, s, 'utf8'); };
  process.on('exit', restoreAll);
  process.on('SIGINT', () => { restoreAll(); process.exit(130); });

  console.log(`\n${title}：${mutants.length} 條\n`);

  let caught = 0;
  const escaped = [];

  for (const m of mutants) {
    const orig = read(m.file);
    if (!orig.includes(m.from)) {
      console.log(`⚠️  ${m.name}\n    找不到要變異的程式碼，這條變異失效了，請更新腳本`);
      escaped.push(m.name + '（變異失效）');
      continue;
    }
    fs.writeFileSync(m.file, orig.replace(m.from, m.to), 'utf8');
    let failed = false;
    try {
      execSync(testCmd, { stdio: 'pipe' });
    } catch {
      failed = true;
    }
    fs.writeFileSync(m.file, backups.get(m.file), 'utf8');

    if (failed) { console.log(`✅ 抓到　${m.name}`); caught++; }
    else { console.log(`❌ 漏掉　${m.name}`); escaped.push(m.name); }
  }

  // 還原後必須仍是綠的——否則代表還原本身出了問題
  try {
    execSync(testCmd, { stdio: 'pipe' });
  } catch (e) {
    console.error('\n❌ 還原之後測試仍是紅的，原始碼可能沒有被正確還原');
    return 1;
  }

  console.log(`\n${caught} / ${mutants.length} 個變異被測試抓到`);
  if (escaped.length) {
    console.log('漏掉的變異（代表測試沒有鑑別力）：');
    for (const e of escaped) console.log('  -', e);
    return 1;
  }
  console.log('全部變異都被抓到，測試具備鑑別力。');
  return 0;
}

module.exports = { runMutants };
