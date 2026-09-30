const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {classifyJest}=require('../../scripts/lib/jest-mutation.cjs');
const file=path.resolve('fixture.test.js');
const contract={grep:'^MC1 ',minTests:1,expectedLocations:[{file,start:20,end:20}]};
const processResult={exitCode:1};
const report=(status='failed',message=`expect(received).toBe(expected)\n at Object.<anonymous> (${file}:20:4)`)=>({success:status==='passed',numRuntimeErrorTestSuites:0,
  testResults:[{name:file,assertionResults:[{fullName:'MC1 expected defect',status,invocations:1,retryReasons:[],failureMessages:status==='passed'?[]:[message]}]}]});
const category=(r,p=processResult,extra={})=>classifyJest({report:r,processResult:p,contract,...extra}).classification;
test('Jest accepts expected assertions and distinguishes baseline and survivor',()=>{
  assert.equal(category(report()),'caught');assert.equal(category(report('passed'),{exitCode:0}),'survived');
  assert.equal(category(report('passed'),{exitCode:0},{baseline:true}),'baseline_passed');
  assert.equal(category(report('failed',`Expected request to fail\n at (${file}:20:8)`)),'caught');
});
test('Jest rejects malformed reports, skipped/zero/duplicate/changed selection and unrelated errors',()=>{
  for(const r of [null,{},report('pending'),report('failed','transport failed'),report('failed',`expect(x)\n at (${file}:21:4)`),report('failed',`Exceeded timeout expect(x)\n at (${file}:20:4)`)])assert.equal(category(r),'test_environment_error');
  const zero=report();zero.testResults[0].assertionResults=[];assert.equal(category(zero),'test_environment_error');
  const duplicate=report();duplicate.testResults[0].assertionResults.push(duplicate.testResults[0].assertionResults[0]);assert.equal(category(duplicate),'test_environment_error');
  const mixed=report();mixed.testResults[0].assertionResults.push({fullName:'unrelated',status:'failed',failureMessages:['bad']});assert.equal(category(mixed),'test_environment_error');
  const setup=report();setup.testResults[0].testExecError={message:'setup failed'};assert.equal(category(setup),'test_environment_error');
  for(const change of [{invocations:2},{invocations:undefined},{retryReasons:['previous failure']}]){
    const retried=report();Object.assign(retried.testResults[0].assertionResults[0],change);assert.equal(category(retried),'test_environment_error');
  }
  assert.equal(category(report(),processResult,{baselineKeys:['different']}),'test_environment_error');
  for(const p of [{exitCode:2},{exitCode:1,error:'ENOENT'},{exitCode:1,timedOut:true},{exitCode:1,signal:'SIGINT'},{exitCode:1,aborted:true}])assert.equal(category(report(),p),'test_environment_error');
});
