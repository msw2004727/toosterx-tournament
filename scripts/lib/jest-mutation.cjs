const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createSession, anchorLocation, writeSource } = require('./mutation-session.cjs');
const { selectMutants, runProcess } = require('./e2e-mutation.cjs');

function classifyJest({report, processResult, contract, baselineKeys=null, baseline=false}) {
  const invalid = reason => ({classification:'test_environment_error',reason});
  if(processResult.error||processResult.signal||processResult.timedOut||processResult.aborted) return invalid('abnormal process');
  if(!report||!Array.isArray(report.testResults)||report.numRuntimeErrorTestSuites!==0) return invalid('missing/malformed report or runtime errors');
  if(report.testResults.some(s=>s.testExecError||!Array.isArray(s.assertionResults))) return invalid('suite setup or runtime failure');
  if(report.testResults.flatMap(s=>s.assertionResults).some(t=>t.status==='failed'&&!new RegExp(contract.grep).test(t.fullName)))return invalid('unrelated test failed');
  const selected = report.testResults.flatMap(s=>s.assertionResults.map(t=>({...t,file:s.name})))
    .filter(t=>new RegExp(contract.grep).test(t.fullName));
  const keys=selected.map(t=>`${t.file}:${t.fullName}`).sort();
  if(selected.length<contract.minTests||new Set(keys).size!==keys.length) return invalid('zero/missing/duplicate selected tests');
  if(baselineKeys&&JSON.stringify(keys)!==JSON.stringify(baselineKeys)) return invalid('test selection changed');
  const failures=[];
  for(const test of selected){
    if(test.invocations!==1||test.retryReasons?.length)return invalid('retry or missing invocation evidence');
    if(test.status==='passed'&&!test.failureMessages?.length)continue;
    if(baseline)return invalid('normal baseline failed');
    if(test.status!=='failed'||!test.failureMessages?.length)return invalid('skipped or failed without evidence');
    for(const message of test.failureMessages){
      const normal=message.replaceAll('\\','/');
      const expected=contract.expectedLocations?.some(l=>{
        const escaped=l.file.replaceAll('\\','/').replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        return [...normal.matchAll(new RegExp(`${escaped}:(\\d+):\\d+`,'g'))].some(m=>Number(m[1])>=l.start&&Number(m[1])<=l.end);
      });
      if(!expected||!(/expect\(/.test(message)||message.includes('Expected request to fail'))
          ||/Exceeded timeout|thrown:|ECONNREFUSED|beforeAll|afterAll|Jest worker|Cannot find module|SyntaxError/.test(message))return invalid('unrelated failure or missing expected assertion location');
      failures.push({test:test.fullName,message});
    }
  }
  if(!failures.length){
    if(processResult.exitCode!==0||report.success!==true)return invalid('exit/report disagrees with selected passes');
    return {classification:baseline?'baseline_passed':'survived',reason:'selected tests passed',keys};
  }
  if(processResult.exitCode!==1||report.success!==false)return invalid('unexpected exit/report status');
  return {classification:'caught',reason:'only expected defect assertions failed',keys,failures};
}

async function runJestMutants({mutants,ids,outputRoot='test-results/mutation-consistency'}){
  if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('Only a demo Firestore Emulator is supported');
  if(process.env.MUTATION_FILTER)throw Error('Use exact --only IDs');
  mutants=selectMutants(mutants,ids);
  const cwd=process.cwd(),runId=`${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}`;
  const root=path.resolve(outputRoot,runId);fs.mkdirSync(root,{recursive:true});
  const paths=[...new Set(execFileSync('git',['ls-files','-co','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))].sort();
  const hash=v=>createHash('sha256').update(v).digest('hex');
  const config={runId,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,
    sourceHash:hash(paths.map(f=>`${f}\0${hash(fs.readFileSync(f))}`).join('\n')),jest:require('jest/package.json').version,
    projectId:process.env.GCLOUD_PROJECT,platform:process.platform,arch:process.arch,
    firestoreHost:process.env.FIRESTORE_EMULATOR_HOST,storageHost:process.env.FIREBASE_STORAGE_EMULATOR_HOST??null,retries:0,timeoutMs:120000};
  fs.writeFileSync(path.join(root,'configuration.json'),JSON.stringify(config,null,2));
  const session=createSession(mutants.map(m=>m.file)),controller=new AbortController(),interrupt=()=>controller.abort();
  for(const signal of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])process.on(signal,interrupt);
  const results=[],baselines=new Map();
  const save=(directory,result)=>{fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));};
  async function execute(m,directory,baseline,baselineKeys){
    const reportPath=path.join(directory,'report.json');
    const processResult=await runProcess({executable:process.execPath,cwd,directory,timeoutMs:config.timeoutMs,abortSignal:controller.signal,
      args:['--experimental-vm-modules',require.resolve('jest/bin/jest'),'--runInBand','--runTestsByPath',m.spec,'--testNamePattern',m.grep,'--json','--outputFile',reportPath],
      env:{...process.env,...session.env,FORCE_COLOR:'0'}});
    let report=null;try{report=JSON.parse(fs.readFileSync(reportPath,'utf8'));}catch{}
    const result={id:m.id,config,process:processResult,selection:{spec:m.spec,grep:m.grep},...classifyJest({report,processResult,contract:m,baseline,baselineKeys})};save(directory,result);return result;
  }
  try{
    for(const m of mutants){
      if(controller.signal.aborted)break;
      const original=session.backups.get(m.file).toString('utf8');let at;
      try{at=anchorLocation(original,m);}catch(e){const r={id:m.id,classification:'anchor_invalid',reason:e.message};results.push(r);save(path.join(root,m.id),r);continue;}
      const key=JSON.stringify([m.spec,m.grep]);
      if(!baselines.has(key))baselines.set(key,await execute(m,path.join(root,`baseline-${m.id}`),true));
      const baseline=baselines.get(key);
      if(baseline.classification!=='baseline_passed'){
        const r={id:m.id,classification:'test_environment_error',reason:`invalid baseline: ${baseline.reason}`};results.push(r);save(path.join(root,m.id),r);break;
      }
      let result;try{writeSource(m.file,original.slice(0,at)+m.to+original.slice(at+m.from.length));result=await execute(m,path.join(root,m.id),false,baseline.keys);}
      finally{writeSource(m.file,session.backups.get(m.file));}
      results.push(result);console.log(`${m.id}: ${result.classification} (${(result.process.durationMs/1000).toFixed(1)}s)`);
    }
  }finally{
    let restorationError=null;try{session.dispose();}catch(e){restorationError=e.message;}
    for(const signal of ['SIGINT','SIGTERM','SIGHUP','SIGBREAK'])process.removeListener(signal,interrupt);
    fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify({config,restorationError,selected:mutants.map(m=>m.id),results,
      complete:!restorationError&&results.length===mutants.length,counts:results.reduce((a,r)=>({...a,[r.classification]:(a[r.classification]??0)+1}),{})},null,2));
    console.log(`Evidence: ${root}`);if(restorationError)throw Error(restorationError);
  }
  return results.length===mutants.length&&results.every(r=>r.classification==='caught')?0:1;
}
module.exports={classifyJest,runJestMutants};
