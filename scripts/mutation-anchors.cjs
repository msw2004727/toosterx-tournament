#!/usr/bin/env node
/** 唯讀：實際定義數、錨點與嚴格 runner 的測試／斷言映射。 */
const fs = require('node:fs');
const path = require('node:path');
const { selectMutants } = require('./lib/e2e-mutation.cjs');
const { anchorLocation } = require('./lib/mutation-session.cjs');
if (fs.existsSync('.mutation-in-progress.json')) {
  console.error('Mutation is active or left a backup; resolve mutation-guard before checking anchors');
  process.exit(2);
}
let total = 0, stale = 0;
// require.main 守衛使讀取定義沒有執行副作用；不解析字串裡的 name: 假項目。
for (const file of ['mutation-check', 'mutation-fn', 'mutation-rules']) {
  const mutants = require(`./${file}.cjs`).MUTANTS;
  for (const m of mutants) {
    total++;
    if (!m.from || !fs.existsSync(m.file) || !fs.readFileSync(m.file, 'utf8').includes(m.from)) {
      stale++; console.error(`${m.name}: missing target/anchor`);
    }
  }
  console.log(`${file}.cjs: ${mutants.length} definitions checked`);
}
for (const file of ['mutation-e2e', 'mutation-consistency']) {
  const definitions = require(`./${file}.cjs`).MUTANTS;
  const mutants = selectMutants(file === 'mutation-e2e' ? definitions.map(m => {
    const id = /^#(\w+)\s/.exec(m.name)?.[1];
    return { ...m, id, ...require('./mutation-e2e-contracts.cjs')[id] };
  }) : definitions);
  for (const m of mutants) {
    total++;
    try { anchorLocation(fs.readFileSync(m.file, 'utf8'), m); }
    catch (e) { stale++; console.error(`${m.id}: ${e.message}`); }
  }
  console.log(`${file}.cjs: ${mutants.length} mappings, assertions and anchors checked`);
}
// 12 項是既有定義的嚴格重驗，不能重複計入總數。
selectMutants(require(path.resolve('scripts/mutation-audit.cjs')).MUTANTS);
if (stale) { console.error(`${stale} invalid anchors`); process.exit(1); }
console.log(`\n✅ ${total} 條實際變異定義全部有效`);
