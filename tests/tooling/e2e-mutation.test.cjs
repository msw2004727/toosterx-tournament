const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { classify, selectMutants, runProcess } = require('../../scripts/lib/e2e-mutation.cjs');
const { createSession, anchorLocation, LOCK } = require('../../scripts/lib/mutation-session.cjs');
const contract = { minTests: 1, failure: '[M:E55]' };
const processResult = { exitCode: 1 };
function report(status = 'failed', message = 'expect(received) [M:E55] assertion wait expired') {
  return { errors: [], suites: [{ specs: [{ file: 'fixture.spec.js', title: 'geometry', tests: [{ projectName: 'chromium-mobile',
    expectedStatus: 'passed', results: [{ status, errors: status === 'passed' ? [] : [{ message }] }] }] }] }] };
}
const category = (r, p = processResult, extra = {}) => classify({ report: r, processResult: p, contract, ...extra }).classification;
const temporary = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feda-mutation-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; };

test('expected assertion wait is caught; passing mutant survived', () => {
  assert.equal(category(report()), 'caught');
  assert.equal(category(report('passed'), { exitCode: 0 }), 'survived');
  assert.equal(category(report('passed'), { exitCode: 0 }, { baseline: true }), 'baseline_passed');
});
test('zero, malformed, missing, skipped, retries, duplicate and selection mismatch are invalid', () => {
  for (const r of [null, {}, { errors: [], suites: [] }, { errors: [], suites: [{ specs: 3 }] }]) assert.equal(category(r), 'test_environment_error');
  for (const status of ['timedOut','skipped','interrupted']) assert.equal(category(report(status)), 'test_environment_error');
  const retried = report(); retried.suites[0].specs[0].tests[0].results.push({ status: 'passed' });
  assert.equal(category(retried), 'test_environment_error');
  const duplicate = report(); duplicate.suites[0].specs.push(duplicate.suites[0].specs[0]);
  assert.equal(category(duplicate), 'test_environment_error');
  assert.equal(category(report(), processResult, { baselineKeys: ['different test'] }), 'test_environment_error');
});
test('global, unrelated and infrastructure errors never count as caught', () => {
  for (const msg of ['expect(x) unrelated', 'Test timeout of 30000ms [M:E55] expect(x)', 'browserType.launch [M:E55] expect(x)', 'Target page closed [M:E55] expect(x)'])
    assert.equal(category(report('failed',msg)), 'test_environment_error');
  const mixed = report(); mixed.suites[0].specs[0].tests[0].results[0].errors.push({ message:'unrelated assertion' });
  assert.equal(category(mixed), 'test_environment_error');
  const global = report(); global.errors.push({ message:'worker died' }); assert.equal(category(global), 'test_environment_error');
  for (const p of [{exitCode:2}, {exitCode:1,timedOut:true}, {exitCode:1,signal:'SIGTERM'}, {exitCode:1,aborted:true}, {exitCode:null,error:'ENOENT'}])
    assert.equal(category(report(),p), 'test_environment_error');
  assert.equal(category(report('passed'),{exitCode:1}), 'test_environment_error');
  assert.equal(category(report(),processResult,{baseline:true}), 'test_environment_error');
});
test('assertion source location must match the declared contract', () => {
  const c = { ...contract, expectedLocations:[{file:path.resolve('fixture.spec.js'),start:20,end:22}] };
  const r=report(); const e=r.suites[0].specs[0].tests[0].results[0].errors[0];
  e.location={file:'fixture.spec.js',line:21}; assert.equal(classify({report:r,processResult,contract:c}).classification,'caught');
  e.location.line=23; assert.equal(classify({report:r,processResult,contract:c}).classification,'test_environment_error');
});
test('exact ID selection rejects unknown IDs, missing mappings and missing assertions', t => {
  const dir=temporary(t), spec=path.join(dir,'case.js'); fs.writeFileSync(spec,'[M:E55] [M:E5] expect(value).toBe(1)');
  const mutants=['E5','E55'].map(id=>({id,spec,grep:'fixture',failure:`[M:${id}]`,minTests:1}));
  assert.deepEqual(selectMutants(mutants,'E5').map(m=>m.id),['E5']);
  for(const ids of ['E','E5,E5','missing']) assert.throws(()=>selectMutants(mutants,ids));
  assert.throws(()=>selectMutants([{id:'E5'}]));
  assert.throws(()=>selectMutants([{...mutants[0],failure:'missing assertion'}]));
  assert.throws(()=>selectMutants([{...mutants[0],assertions:['expect(missing)']} ]));
});
test('missing, multiple and no-op anchors fail; explicit occurrence is deterministic', () => {
  assert.equal(anchorLocation('anchor end',{from:'anchor',to:'mutant'}),0);
  for(const m of [{from:'missing',to:'a'},{from:'a',to:'b'},{from:'aa',to:'aa'}]) assert.throws(()=>anchorLocation('aaaa',m));
  assert.equal(anchorLocation('a a',{from:'a',to:'b',anchorCount:2,occurrence:1}),2);
  assert.throws(()=>anchorLocation('a a',{from:'a',to:'b',anchorCount:2,occurrence:2}));
});
test('exclusive lock preserves local edits and restores bytes, not Git HEAD', t => {
  const dir=temporary(t); const original=Buffer.from('local uncommitted\n中文\n'); fs.writeFileSync(path.join(dir,'source.js'),original);
  const s=createSession(['source.js'],dir); assert.throws(()=>createSession(['source.js'],dir));
  fs.writeFileSync(path.join(dir,'source.js'),'mutant'); s.dispose();
  assert.deepEqual(fs.readFileSync(path.join(dir,'source.js')),original); assert.equal(fs.existsSync(path.join(dir,LOCK)),false);
});
test('guard handles live tokens, stale locks, corrupt reports and legacy backups conservatively', t => {
  const dir=temporary(t); fs.writeFileSync(path.join(dir,'source.js'),'local\n');
  const guard=path.resolve('scripts/mutation-guard.cjs'); const run=env=>spawnSync(process.execPath,[guard],{cwd:dir,env:{...process.env,FEDA_MUTATION_RUN:'',FEDA_MUTATION_TOKEN:'',...env}});
  const s=createSession(['source.js'],dir);
  assert.equal(run({FEDA_MUTATION_RUN:'1'}).status,1); assert.equal(run(s.env).status,0); s.dispose();
  fs.writeFileSync(path.join(dir,LOCK),JSON.stringify({pid:0,files:{'source.js':'legacy local\n'}}));
  fs.writeFileSync(path.join(dir,'source.js'),'bad'); assert.equal(run().status,1); assert.equal(fs.readFileSync(path.join(dir,'source.js'),'utf8'),'legacy local\n');
  fs.writeFileSync(path.join(dir,LOCK),'{broken'); assert.equal(run().status,1); assert.equal(fs.existsSync(path.join(dir,LOCK)),true);
  fs.writeFileSync(path.join(dir,LOCK),JSON.stringify({version:2,pid:0,files:{'source.js':Buffer.from('erase').toString('base64'),'../escape':'%%%'}}));
  assert.equal(run().status,1); assert.equal(fs.readFileSync(path.join(dir,'source.js'),'utf8'),'legacy local\n');
});
test('process launch, timeout, abort and large output retain distinct evidence', async t => {
  const dir=temporary(t); const run=(args,extra={})=>runProcess({executable:process.execPath,args,cwd:dir,env:process.env,directory:path.join(dir,String(Math.random())),...extra});
  const missing=await run([], {executable:path.join(dir,'no-executable')}); assert.ok(missing.error); assert.notEqual(missing.exitCode,0);
  const timed=await run(['-e','setInterval(()=>{},1000)'],{timeoutMs:150}); assert.equal(timed.timedOut,true);
  const control=new AbortController(); setTimeout(()=>control.abort(),150);
  const aborted=await run(['-e','setInterval(()=>{},1000)'],{abortSignal:control.signal}); assert.equal(aborted.aborted,true);
  const output=path.join(dir,'large'); const large=await run(['-e',`process.stdout.write('x'.repeat(4*1024*1024));process.stderr.write('evidence')`],{directory:output});
  assert.equal(large.exitCode,0); assert.equal(fs.statSync(path.join(output,'stdout.log')).size,4*1024*1024);
  assert.equal(fs.readFileSync(path.join(output,'stderr.log'),'utf8'),'evidence');
  const broken=path.join(dir,'broken');fs.mkdirSync(path.join(broken,'stdout.log'),{recursive:true});
  const outputFailure=await run(['-e',`process.stdout.write('evidence');setInterval(()=>{},1000)`],{directory:broken});assert.match(outputFailure.error,/log output/);
});
