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
 * 變異進行中的標記。
 *
 * ⚠️ 2026-09-03：跑 test:mutation:rules 時我從外面把 emulator 的行程砍掉，
 *    子行程收到的是攔不住的 kill，`process.on('exit')` 的還原沒有機會執行——
 *    firestore.rules 就停在**被改壞**的狀態，而且被 commit 並部署上去了
 *    （Admin 可以指派身分、檢錄紀錄可以刪除）。CI 有紅，但那是推上去之後的事。
 *
 * 所以除了訊號處理，還留一個檔案在磁碟上：裡面是每一個被動過的檔案的原始內容。
 * `node scripts/mutation-guard.cjs` 看到它就會還原並以非零結束碼中止，
 * 而那支被掛在每一個測試指令與 CI 的最前面。
 */
const LOCK = '.mutation-in-progress.json';

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

  // ⚠️ CRLF 會讓**多行**的變異樣式全部對不上，而單行的照樣對得上——
  //    看起來像「腳本過期了」，其實是環境問題（2026-09-03 在 Windows 上
  //    被 core.autocrlf=true 咬過：27 條有 18 條變成「找不到要變異的程式碼」）。
  //    .gitattributes 已經把行尾釘成 LF，這裡再擋一次，因為錯誤訊息差很多。
  const CRLF = String.fromCharCode(13, 10);
  const crlf = [...backups].filter(([, s]) => s.includes(CRLF)).map(([f]) => f);
  if (crlf.length) {
    console.error('\n❌ 這些檔案是 CRLF 行尾，多行的變異樣式會全部對不上：');
    for (const f of crlf) console.error(`   ・${f}`);
    console.error('\n   .gitattributes 已把行尾釘成 LF。請重新取出檔案：');
    console.error('     git rm --cached -r . && git reset --hard\n');
    return 1;
  }

  // 有變異失敗時要還原所有檔案，否則會留下壞掉的原始碼
  // 記下 pid：守衛靠它分辨「變異還在跑」與「上一次被砍掉留下的殘骸」。
  // 沒有這個的話，在另一個視窗跑 npm test 會把正在進行的那一次還原掉。
  fs.writeFileSync(LOCK, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    files: Object.fromEntries(backups)
  }), 'utf8');

  let restored = false;
  const restoreAll = () => {
    if (restored) return;
    restored = true;
    for (const [f, s] of backups) fs.writeFileSync(f, s, 'utf8');
    try { fs.unlinkSync(LOCK); } catch { /* 已經不在就算了 */ }
  };
  process.on('exit', restoreAll);
  // SIGKILL 攔不住，那一種靠上面的 LOCK 檔案與 mutation-guard 收尾
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(sig, () => { restoreAll(); process.exit(130); });
  }

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
      execSync(testCmd, { stdio: 'pipe', env: { ...process.env, FEDA_MUTATION_RUN: '1' } });
    } catch {
      failed = true;
    }
    fs.writeFileSync(m.file, backups.get(m.file), 'utf8');

    if (failed) { console.log(`✅ 抓到　${m.name}`); caught++; }
    else { console.log(`❌ 漏掉　${m.name}`); escaped.push(m.name); }
  }

  // 還原後必須仍是綠的——否則代表還原本身出了問題
  try {
    execSync(testCmd, { stdio: 'pipe', env: { ...process.env, FEDA_MUTATION_RUN: '1' } });
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
