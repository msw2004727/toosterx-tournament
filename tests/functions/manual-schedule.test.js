import { jest } from '@jest/globals';
import { db } from '../../functions/admin.js';
import { publishManualScheduleFor } from '../../functions/manual-schedule.js';
import { manageEventFor } from '../../functions/management.js';
import { createManualDraft, manualPayloadOf } from '../../js/engine/manual-schedule.js';
import { RANKING_RULES } from '../../js/engine/formats.js';
import { genericFormat } from '../../js/engine/schedule.js';
import { context,division,teams,format,venues,cfg,filledDraft,existingDocs } from '../support/manual-fixture.js';

const E='manual-test',base=()=>db().doc(`events/${E}`),div=()=>base().collection('divisions').doc('d'),match=id=>base().collection('matches').doc(id);
const audit=()=>base().collection('audits').where('action','==','schedule.manualPublish').get();
const request=(draft=filledDraft(),extra={},uid='admin')=>({auth:uid?{uid}:null,data:{eventId:E,operationId:'manual-1',draft:manualPayloadOf(draft),reason:'主辦逐場核對確認',...extra}});
const getDocs=async()=> (await base().collection('matches').get()).docs.map(d=>({...d.data(),matchId:d.id}));
async function editDraft(){return createManualDraft({...context,division:{...(await div().get()).data(),divisionId:'d'},teams:(await base().collection('teams').get()).docs.map(d=>({...d.data(),teamId:d.id})),existingMatches:await getDocs()});}
beforeEach(async()=>{
  const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;if(!host||!project?.startsWith('demo-'))throw Error('Emulator required');
  const r=await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});if(!r.ok)throw Error('Reset failed');
  const b=db().batch();b.set(base(),{dates:[division.date]});b.set(div(),division);
  for(const [uid,roles,active] of [['admin',['admin'],true],['super',['super_admin'],true],['scorer',['scorer'],true],['inactive',['admin'],false]])b.set(db().doc(`staff/${uid}`),{roles,active,name:uid});
  b.set(db().doc('config/formats'),{formats:{[format.formatId]:format}});b.set(db().doc('config/rankingRules'),{rules:RANKING_RULES});b.set(db().doc('config/schedule'),cfg);
  for(const t of teams)b.set(base().collection('teams').doc(t.teamId),t);
  for(const v of venues)b.set(base().collection('venues').doc(v.venueId),v);await b.commit();
});
afterEach(()=>jest.restoreAllMocks());

test.each([false,true])('指定統一賽制時不能手動建立其他範本 generated=%s',async generated=>{
  await div().update({requiredFormatId:'F8_GROUP_TOP_SEED_BYE'});
  const d=filledDraft(generated?{format:genericFormat(4),generated:true}:{});
  await expect(publishManualScheduleFor(request(d))).rejects.toMatchObject({code:'failed-precondition'});
  expect(await getDocs()).toHaveLength(0);
  expect((await audit()).empty).toBe(true);
});

test('手動新建完整組別、積分、場次與一次發布，稽核可追溯',async()=>{
  const r=await publishManualScheduleFor(request());expect(r).toMatchObject({divisionId:'d',scheduleRevision:1,published:true,matchCount:8,operationId:'manual-1',auditId:expect.any(String)});
  const docs=await getDocs();expect(docs).toHaveLength(8);expect(docs.every(m=>m.matchId.includes('__g-')&&m.kickoffAt&&m.venueId==='v')).toBe(true);
  expect((await div().get()).data()).toMatchObject({schedulePublished:true,scheduleRevision:1,formatId:format.formatId});
  expect((await base().collection('standings').get()).size).toBe(1);
  const a=(await audit()).docs[0].data();expect(a).toMatchObject({auditId:r.auditId,actor:{uid:'admin'},reason:'主辦逐場核對確認',before:{matches:{}},after:{result:r}});
  expect(Object.values(a.after.writtenDocuments).filter(w=>w.doc.stageId==='group'&&w.doc.home)).toHaveLength(6);
});
test('核准兩隊時通用賽制可整批建立，其他既有賽制不被覆蓋',async()=>{
  const currentTeams=teams.map(t=>({...t,withdrawn:['t3','t4'].includes(t.teamId)}));
  await base().collection('teams').doc('t3').update({withdrawn:true});await base().collection('teams').doc('t4').update({withdrawn:true});
  const d=filledDraft({teams:currentTeams,format:genericFormat(2),generated:true});
  expect((await publishManualScheduleFor(request(d))).matchCount).toBe(1);
  const formats=(await db().doc('config/formats').get()).data().formats;expect(formats[format.formatId]).toEqual(format);expect(formats[d.formatId].teamCount).toBe(2);
});
test.each([null,'scorer','inactive','unknown'])('非管理員或停用角色不得發布 %s',async uid=>{
  await expect(publishManualScheduleFor(request(filledDraft(),{},uid))).rejects.toMatchObject({code:uid?'permission-denied':'unauthenticated'});
  expect(await getDocs()).toHaveLength(0);expect((await audit()).size).toBe(0);
});
test('重送原請求回原收據，不同人或內容不能使用此代碼',async()=>{
  const req=request(),r=await publishManualScheduleFor(req);expect(await publishManualScheduleFor(req)).toEqual(r);expect((await audit()).size).toBe(1);
  await expect(publishManualScheduleFor({...req,data:{...req.data,reason:'不同原因'}})).rejects.toMatchObject({code:'already-exists'});
  await expect(publishManualScheduleFor({...req,auth:{uid:'super'}})).rejects.toMatchObject({code:'already-exists'});
  await db().doc('staff/admin').update({active:false});await expect(publishManualScheduleFor(req)).rejects.toMatchObject({code:'permission-denied'});
});
test('相同版本同時發布，只能一份交易成功',async()=>{
  const out=await Promise.allSettled([publishManualScheduleFor(request()),publishManualScheduleFor(request(filledDraft(),{operationId:'manual-2'}))]);
  expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(out.find(r=>r.status==='rejected').reason.code).toBe('aborted');expect((await audit()).size).toBe(1);
},20000);
test('缺少、重複、偽造場次 ID 與任意比分欄位均拒絕',async()=>{
  for(const mutate of [d=>d.matches.pop(),d=>d.matches[1].matchId=d.matches[0].matchId,d=>d.matches[0].matchId='fake']){
    const d=filledDraft();mutate(d);await expect(publishManualScheduleFor(request(d))).rejects.toMatchObject({code:'invalid-argument'});
  }
  const req=request();req.data.draft.matches[0].score={home:99};await expect(publishManualScheduleFor(req)).rejects.toMatchObject({code:'invalid-argument'});
  expect(await getDocs()).toHaveLength(0);
});
test('自賽、重複對手、KO指定隊伍與撞場均不寫半套安排',async()=>{
  for(const mutate of [d=>d.matches[0].awayTeamId=d.matches[0].homeTeamId,d=>Object.assign(d.matches[1],{homeTeamId:d.matches[0].homeTeamId,awayTeamId:d.matches[0].awayTeamId}),
    d=>d.matches.find(m=>!m.isRoundRobin).homeTeamId='t1',d=>d.matches[1].kickoffAt=d.matches[0].kickoffAt]){
    const d=filledDraft();mutate(d);await expect(publishManualScheduleFor(request(d))).rejects.toMatchObject({code:'failed-precondition'});
  }
  expect(await getDocs()).toHaveLength(0);expect((await div().get()).data().schedulePublished).toBe(false);expect((await audit()).size).toBe(0);
});
test('伺服器重讀跨組別場地撞場與可用日期，而非信任預覽',async()=>{
  const d=filledDraft();await base().collection('divisions').doc('other').set({...division,divisionId:'other'});
  await match('other').set({divisionId:'other',kickoffAt:new Date(d.matches[0].kickoffAt),venueId:'v',teamIds:[]});
  await expect(publishManualScheduleFor(request(d))).rejects.toMatchObject({code:'failed-precondition'});
  await match('other').delete();await db().doc('config/schedule').update({venuesByDate:{[division.date]:['small']}});
  await expect(publishManualScheduleFor(request(d))).rejects.toMatchObject({code:'failed-precondition'});
});
test('資料、分組、賽制或版本變更一律拒絕舊草稿',async()=>{
  const req=request();await div().update({scheduleRevision:1});await expect(publishManualScheduleFor(req)).rejects.toMatchObject({code:'aborted'});
  await div().update({scheduleRevision:0});await base().collection('teams').doc('t1').update({seed:2});await expect(publishManualScheduleFor(req)).rejects.toMatchObject({code:'aborted'});
  await base().collection('teams').doc('t1').update({seed:null});await db().doc('config/formats').set({formats:{[format.formatId]:{...format,name:'不同版本'}}});await expect(publishManualScheduleFor(req)).rejects.toMatchObject({code:'aborted'});
});
test('既有場次改時間保留 ID、比分、子紀錄與晉級內容',async()=>{
  await publishManualScheduleFor(request());const before=await getDocs(),d=await editDraft();d.matches[0].kickoffAt+=2*60000;
  await match(d.matches[0].matchId).collection('streamShares').doc('s').set({url:'video'});
  await publishManualScheduleFor(request(d,{operationId:'edit-1'}));const after=await getDocs();expect(after.map(m=>m.matchId)).toEqual(before.map(m=>m.matchId));
  for(const m of after){const previous=before.find(p=>p.matchId===m.matchId);expect(m.score).toEqual(previous.score);expect(m.result).toEqual(previous.result);expect(m.home).toEqual(previous.home);expect(m.matchNo).toBe(previous.matchNo);}
  expect((await match(d.matches[0].matchId).collection('streamShares').doc('s').get()).exists).toBe(true);
});
test('手動換對戰保留完整配對，舊出場／檢錄失效且完整留痕',async()=>{
  await publishManualScheduleFor(request());const d=await editDraft(),rr=d.matches.filter(m=>m.isRoundRobin),a=rr[0],b=rr[1];
  const old=[a.homeTeamId,a.awayTeamId];[a.homeTeamId,b.homeTeamId]=[b.homeTeamId,a.homeTeamId];[a.awayTeamId,b.awayTeamId]=[b.awayTeamId,a.awayTeamId];
  await base().collection('checkins').doc('check').set({matchId:a.matchId,teamId:old[0]});await base().collection('matchSheets').doc('sheet').set({matchId:a.matchId,teamId:old[0]});
  await publishManualScheduleFor(request(d,{operationId:'pairs'}));expect((await base().collection('checkins').doc('check').get()).exists).toBe(false);expect((await base().collection('matchSheets').doc('sheet').get()).exists).toBe(false);
  expect((await match(a.matchId).get()).data()).toMatchObject({home:{teamId:a.homeTeamId},checkin:{homeConfirmed:false,awayConfirmed:false}});
  const aLog=(await audit()).docs.find(x=>x.data().after.result.operationId==='pairs').data();expect(Object.keys(aLog.before.deletedDocuments)).toHaveLength(2);
});
test('事件紀錄不得黏到改換對戰，新比分出現則旧草稿拒絕',async()=>{
  await publishManualScheduleFor(request());const d=await editDraft(),rr=d.matches.filter(m=>m.isRoundRobin),a=rr[0],b=rr[1];
  [a.homeTeamId,b.homeTeamId]=[b.homeTeamId,a.homeTeamId];[a.awayTeamId,b.awayTeamId]=[b.awayTeamId,a.awayTeamId];
  await match(a.matchId).collection('timeline').doc('goal').set({type:'goal'});await expect(publishManualScheduleFor(request(d,{operationId:'event'}))).rejects.toMatchObject({code:'failed-precondition'});
  const fresh=await editDraft();fresh.matches[0].kickoffAt+=60000;await match(fresh.matches[0].matchId).update({score:{home:1,away:0}});await expect(publishManualScheduleFor(request(fresh,{operationId:'score'}))).rejects.toMatchObject({code:'aborted'});
});
test.each([{status:'live'},{status:'cancelled',result:{winner:'home'}},{period:'h1'},{score:{home:1,away:0}},{lock:{locked:true}},{revisionCount:1}])('MOVE-GUARD 直接呼叫 schedule.move 仍擋已開打 %j',async patch=>{
  await match('m').set({...existingDocs()[0],matchId:'m',kickoffAt:new Date(existingDocs()[0].kickoffAt),...patch});
  await expect(manageEventFor({auth:{uid:'admin'},data:{eventId:E,divisionId:'d',operationId:'move',action:'schedule.move',expected:0,updates:[{matchId:'m',patch:{kickoffAt:12345}}]}})).rejects.toMatchObject({code:'aborted'});
  expect((await match('m').get()).data().kickoffAt.toMillis()).toBe(existingDocs()[0].kickoffAt);expect((await div().get()).data().scheduleRevision).toBe(0);
});
test('稽核提交失敗時，賽程、分組、發布與收據全數回滾',async()=>{
  const original=db().runTransaction.bind(db());jest.spyOn(db(),'runTransaction').mockImplementation(cb=>original(async tx=>{const create=tx.create.bind(tx);tx.create=(ref,data)=>{if(ref.path.includes('/audits/'))throw Object.assign(Error('audit failure'),{code:7});return create(ref,data);};return cb(tx);}));
  await expect(publishManualScheduleFor(request())).rejects.toThrow('audit failure');
  expect(await getDocs()).toHaveLength(0);expect((await div().get()).data().scheduleRevision).toBe(0);expect((await base().collection('standings').get()).empty).toBe(true);expect((await base().collection('manualScheduleOperations').get()).empty).toBe(true);
});
