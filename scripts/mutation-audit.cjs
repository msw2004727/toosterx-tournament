const {runJestMutants}=require('./lib/jest-mutation.cjs');
const unit=require('./mutation-check.cjs').MUTANTS,fn=require('./mutation-fn.cjs').MUTANTS,rules=require('./mutation-rules.cjs').MUTANTS;
const item=(definitions,name,spec,grep,assertions,minTests=1)=>{
  const original=definitions.find(m=>m.name.startsWith(name+' '));if(!original)throw Error(`missing ${name}`);
  return {...original,id:name.replaceAll('#',''),spec,grep,failure:grep,assertions,minTests};
};
const ruleSpec='tests/firestore-rules/prelaunch.test.js',pipelineSpec='tests/functions/pipeline.test.js';
const MUTANTS=[
  item(unit,'#PRE1','tests/unit/router.test.js','^同一路由快速', ['expect(currentUnsubscribe).not.toHaveBeenCalled()']),
  item(unit,'#PRE2','tests/unit/service-worker.test.js','^成功瀏覽的 HTML',['await expect(sw.request(path, { html }).then(r => r?.text())).resolves.toBe(\'network\')']),
  item(unit,'#AF11','tests/unit/audit-fixes.test.js','D-03 攤位.*查詢有對應',['expect(hit).toBeTruthy()']),
  item(fn,'FN#PRE1',pipelineSpec,'刪除最後一場後',['expect((await standing()).rows.every(r => r.played === 0)).toBe(true)']),
  item(fn,'FN#PRE2',pipelineSpec,'完賽後作廢紅黃牌與進球',['expect((await standing()).rows.find(r => r.teamId === \'t1\').fairPlayPoints).toBe(0)']),
  item(fn,'FN#PRE3','tests/functions/challenge.test.js','^同一玩家在兩個攤位',['expect(result.completedChallengeIds.sort()).toEqual(ids.sort())','expect(result.luckyDrawEntries).toBe(2)']),
  item(fn,'FN#PRE4',pipelineSpec,'^結果與名冊觸發器明確啟用',['expect(handler.__endpoint.eventTrigger.retry).toBe(true)']),
  item(rules,'RU#PRE1',ruleSpec,'^賽務事件不能寫到',['await assertFails(setDoc(ref(authed(env, \'u-scorer\'), \'matches\', id, \'timeline\', \'e\'), {'],2),
  item(rules,'RU#PRE2',ruleSpec,'^鎖定場次不能補登',['await assertFails(setDoc(ref(db, \'matches\', MATCH, \'timeline\', \'new\'), { matchId: MATCH, createdBy: \'u-scorer\' }))']),
  item(rules,'RU#PRE3',ruleSpec,'^挑戰成績建立時間',['await assertFails(setDoc(target, { ...data, createdAt: Timestamp.fromMillis(Date.now() + 86400000) }))']),
  item(rules,'RU#PRE4',ruleSpec,'^出場名單限制',['await assertFails(setDoc(ref(db, \'matchSheets\', `${id}__${teamId}`), { matchId: id, teamId, players: [] }))']),
  item(rules,'RU#PRE5',ruleSpec,'^舊 registrations 路徑',['await assertFails(setDoc(target, { status: \'pending\' }))'])
];
module.exports={MUTANTS};
if(require.main===module)runJestMutants({mutants:MUTANTS,outputRoot:'test-results/mutation-audit'}).then(c=>{process.exitCode=c;},e=>{console.error(e);process.exitCode=1;});
