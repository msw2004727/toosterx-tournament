import { jest } from '@jest/globals';
import { db as adminDb } from '../../functions/admin.js';
import { generateScheduleFor } from '../../functions/schedule.js';
import { manageEventFor, matchBasis } from '../../functions/management.js';
import { FORMATS, RANKING_RULES } from '../../js/engine/formats.js';
import { resolveAdvancementForStage, publishFinalRankingFor, syncRosterFor, recountTeamMembers,
  rejectDuplicateApplication, recalcStandingsForStage, setManualRankingFor } from '../../functions/pipeline.js';
import { onTeamWritten, onMemberWritten, onMatchWritten } from '../../functions/index.js';

const E='consistency-test',D='women';let db;
const base=()=>db.doc(`events/${E}`),div=()=>base().collection('divisions').doc(D),match=id=>base().collection('matches').doc(id);
const team=id=>base().collection('teams').doc(id),member=id=>team('t1').collection('members').doc(id),roster=id=>team('t1').collection('roster').doc(id);
const audit=action=>base().collection('audits').where('action','==',action).get();
const request=data=>({auth:{uid:'admin'},data:{eventId:E,...data}});
const pairs=[['g1','t1','t2'],['g2','t1','t3'],['g3','t1','t4'],['g4','t2','t3'],['g5','t2','t4'],['g6','t3','t4']];
const result=(h,a)=>({winner:h>a?'home':h<a?'away':'draw',method:'regulation',homePoints:h>a?3:h===a?1:0,awayPoints:a>h?3:h===a?1:0});
function matchDoc(id,h=null,a=null){return {matchId:id,eventId:E,divisionId:D,stageId:id.startsWith('g')?'group':'final',groupId:id.startsWith('g')?'A':null,
  matchKey:id.startsWith('g')?null:id,teamIds:[h,a].filter(Boolean),home:{teamId:h,name:h},away:{teamId:a,name:a},status:'scheduled',period:'pre',
  score:{home:0,away:0},result:null,lock:{locked:false},revisionCount:0};}
async function seed(){
  const b=db.batch();b.set(base(),{eventId:E,dates:['2026-10-09']});
  b.set(db.doc('staff/admin'),{active:true,roles:['admin'],name:'管理員'});
  b.set(db.doc('staff/booth'),{active:true,roles:['booth']});
  b.set(db.doc('config/formats'),{formats:FORMATS});b.set(db.doc('config/rankingRules'),{rules:RANKING_RULES});
  b.set(div(),{divisionId:D,code:'WO',formatId:'F4_RR_FINAL',rankingRuleId:'RR_FEDA_DEFAULT',date:'2026-10-09',withdrawalPolicy:'voidAll',finalRankingPublished:false,scheduleRevision:0});
  for(const id of ['t1','t2','t3','t4'])b.set(team(id),{teamId:id,divisionId:D,status:'approved',withdrawn:false,name:id,shortName:id,memberCount:0,playerCount:0});
  for(const st of FORMATS.F4_RR_FINAL.stages)b.set(div().collection('stages').doc(st.stageId),st);
  b.set(div().collection('stages').doc('group').collection('groups').doc('A'),{groupId:'A',teamIds:['t1','t2','t3','t4']});
  b.set(base().collection('standings').doc(`${D}__group__A`),{standingId:`${D}__group__A`,divisionId:D,stageId:'group',groupId:'A',rows:[],version:0});
  for(const [id,h,a]of pairs)b.set(match(id),matchDoc(id,h,a));
  for(const id of ['F1','F3'])b.set(match(id),matchDoc(id));await b.commit();
}
async function finishGroups(){const b=db.batch();for(const [id]of pairs)b.update(match(id),{status:'finished',score:{home:2,away:0},result:result(2,0)});await b.commit();}
const generation=(operationId='generation-1',extra={})=>request({divisionId:D,operationId,expectedRevision:0,orderedTeamIds:['t1','t2','t3','t4'],formatId:'F4_RR_FINAL',drawSeed:null,...extra});
const command=async(action='match.override',operationId='operation-1',extra={})=>request({action,operationId,matchId:'g1',expected:matchBasis((await match('g1').get()).data()),patch:{score:{home:1,away:3}},reason:'核對記錄後修正',...extra});
const eventOf=(before,after,params)=>({params:{eventId:E,...params},data:{before:{data:()=>before},after:{data:()=>after}}});
beforeAll(()=>{db=adminDb();});
beforeEach(async()=>{
  const host=process.env.FIRESTORE_EMULATOR_HOST,project=process.env.GCLOUD_PROJECT;
  if(!host||!project?.startsWith('demo-'))throw Error('一致性測試只允許 demo Emulator');
  const r=await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});if(!r.ok)throw Error(`Emulator reset ${r.status}`);await seed();
});
afterEach(()=>jest.restoreAllMocks());
function injectAtTransactionStart(change){
  const original=db.runTransaction.bind(db);let injected=false;
  jest.spyOn(db,'runTransaction').mockImplementation((callback,options)=>original(async tx=>{
    if(!injected){injected=true;await change();}return callback(tx);
  },options));
}
function failAudit({retry=false}={}){
  const original=db.runTransaction.bind(db);let failed=false,attempts=0;
  jest.spyOn(db,'runTransaction').mockImplementation((callback,options)=>original(async tx=>{
    attempts++;const create=tx.create.bind(tx);
    tx.create=(ref,data)=>{if(ref.path.includes('/audits/')&&(!retry||!failed)){failed=true;throw Object.assign(new Error('audit submission fault'),{code:retry?10:7});}return create(ref,data);};
    return callback(tx);
  },options));return ()=>attempts;
}

test('MC1 排程重產清理舊子紀錄、舊小組、積分及保留抽籤稽核，使用新世代',async()=>{
  await match('g1').collection('timeline').doc('stale').set({type:'goal'});
  await base().collection('checkins').doc('old-checkin').set({matchId:'g1'});
  await base().collection('matchSheets').doc('old-sheet').set({matchId:'g1'});
  await div().collection('stages').doc('obsolete').collection('groups').doc('Z').set({teamIds:['old']});
  const r=await generateScheduleFor(generation());
  expect(r.matches).toBe(8);expect(r.matchIds.every(id=>id.includes('__g-'))).toBe(true);
  expect((await match('g1').collection('timeline').get()).size).toBe(0);
  expect((await base().collection('checkins').get()).size).toBe(0);expect((await base().collection('matchSheets').get()).size).toBe(0);
  expect((await div().collection('stages').doc('obsolete').collection('groups').get()).size).toBe(0);
  expect((await div().get()).data().schedulePublished).toBe(false);
  expect((await audit('schedule.generate')).docs[0].data()).toMatchObject({actor:{uid:'admin'},after:{drawSeed:null,orderedTeamIds:['t1','t2','t3','t4']}});
  const log=(await audit('schedule.generate')).docs[0].data();
  expect(log.before.deletedDocuments.some(d=>d.path.endsWith('/timeline/stale')&&d.doc.type==='goal')).toBe(true);
  expect(Object.values(log.after.writtenDocuments).filter(d=>d.path.includes('/matches/'))).toHaveLength(8);
});
test.each([{status:'live'},{status:'cancelled',result:result(1,0)},{lock:{locked:true}},{score:{home:1,away:0}},{revisionCount:1}])('MC2 即時已打過判斷 %j 阻止重產且保留原資料',async patch=>{
  await match('g1').update(patch);await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'failed-precondition'});
  expect((await match('g1').get()).exists).toBe(true);expect((await audit('schedule.generate')).size).toBe(0);
});
test('MC3 兩次同時重產只能一份提交；重送同操作回原收據',async()=>{
  const settled=await Promise.allSettled([generateScheduleFor(generation('first')),generateScheduleFor(generation('second'))]);
  expect(settled.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const success=settled.find(r=>r.status==='fulfilled').value;
  const replay=await generateScheduleFor(generation(success.operationId));expect(replay).toEqual(success);
  expect((await audit('schedule.generate')).size).toBe(1);expect((await base().collection('matches').get()).size).toBe(8);
},20_000);
test('MC4 角色、隊伍、來源版本變動及範本缺漏均先拒絕',async()=>{
  await expect(generateScheduleFor({...generation(),auth:{uid:'booth'}})).rejects.toMatchObject({code:'permission-denied'});
  await expect(generateScheduleFor(generation('stale',{expectedRevision:7}))).rejects.toMatchObject({code:'aborted'});
  await expect(generateScheduleFor(generation('format',{formatId:'missing'}))).rejects.toMatchObject({code:'failed-precondition'});
  await team('t4').update({withdrawn:true});await expect(generateScheduleFor(generation('teams'))).rejects.toMatchObject({code:'aborted'});
  expect((await audit('schedule.generate')).size).toBe(0);
});
test('MC5 超過單交易容量先拒絕；稽核失敗不留下半套新賽程',async()=>{
  const b=db.batch();for(let i=0;i<410;i++)b.set(match('g1').collection('timeline').doc(`old-${i}`),{type:'note'});await b.commit();
  await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'resource-exhausted'});
  expect((await match('g1').collection('timeline').get()).size).toBe(410);
  const d=db.batch();for(const doc of (await match('g1').collection('timeline').get()).docs)d.delete(doc.ref);await d.commit();
  failAudit();await expect(generateScheduleFor(generation())).rejects.toThrow('audit submission fault');
  expect((await match('g1').get()).exists).toBe(true);expect((await div().get()).data().scheduleRevision).toBe(0);
});
test('MC6 排程抽籤 seed 與順序必須能重放，不能偽造抽籤紀錄',async()=>{
  await expect(generateScheduleFor(generation('draw',{drawSeed:123}))).rejects.toMatchObject({code:'invalid-argument'});
  const {drawOrder}=await import('../../js/engine/schedule.js');const ids=drawOrder(['t1','t2','t3','t4'],123);
  const r=await generateScheduleFor(generation('draw-ok',{drawSeed:123,orderedTeamIds:ids}));expect(r.revision).toBe(1);
});

test('MC7 晉級在交易開始前上游改判，未送達 standing trigger 也使用當下結果',async()=>{
  await finishGroups();injectAtTransactionStart(()=>match('g1').update({score:{home:0,away:5},result:result(0,5)}));
  await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});
  expect((await match('F1').get()).data().home.teamId).toBe('t2');
});
test('MC8 晉級提交時目標剛開打或鎖定，不覆蓋隊伍與比分並留衝突',async()=>{
  await finishGroups();injectAtTransactionStart(()=>match('F1').update({status:'live',score:{home:1,away:0}}));
  const r=await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});
  expect((await match('F1').get()).data().status).toBe('live');expect((await match('F1').get()).data().score.home).toBe(1);
  expect(r.blocked.some(b=>b.matchId==='F1')).toBe(true);expect((await audit('advancement.conflict')).size).toBeGreaterThan(0);
});
test('MC9 重複解算冪等，manualHold 與已鎖定下游保持保護',async()=>{
  await finishGroups();await div().update({manualHold:true});
  expect((await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'})).ready).toBe(false);
  await div().update({manualHold:false});await match('F1').update({lock:{locked:true}});
  const r=await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});expect(r.blocked.some(b=>b.matchId==='F1')).toBe(true);
  await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});expect((await audit('advancement.conflict')).size).toBe(1);
  expect((await audit('advancement.resolve')).size).toBe(1);
});
test('MC10 重開上游撤回未開打名單，已公布排名立刻失效',async()=>{
  await finishGroups();await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});
  await div().update({finalRankingPublished:true,finalRanking:[{rank:1,teamId:'t1'}]});
  const before=(await match('g1').get()).data();await match('g1').update({status:'live',result:null});
  await onMatchWritten.run(eventOf(before,{...before,status:'live',result:null},{matchId:'g1'}));
  expect((await match('F1').get()).data().teamIds).toEqual([]);expect((await div().get()).data().finalRankingPublished).toBe(false);
});
test('MC11 退賽及復賽事件不用等其他比賽異動，積分與下游／衝突立即更新',async()=>{
  await finishGroups();await recalcStandingsForStage({eventId:E,divisionId:D,stageId:'group'});await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});
  const standing=()=>base().collection('standings').doc(`${D}__group__A`).get();const before=(await team('t1').get()).data();
  await team('t1').update({withdrawn:true});await onTeamWritten.run(eventOf(before,{...before,withdrawn:true},{teamId:'t1'}));
  const first=(await standing()).data().rows.find(r=>r.teamId==='t2');expect(first.played).toBe(2);
  expect((await match('F1').get()).data().teamIds).not.toContain('t1');
  await team('t1').update({withdrawn:false});await onTeamWritten.run(eventOf({...before,withdrawn:true},before,{teamId:'t1'}));
  expect((await standing()).data().rows.find(r=>r.teamId==='t2').played).toBe(3);
  expect((await match('F1').get()).data().home.teamId).toBe('t1');
});
test('MC12 發布最終排名稽核同交易，重放不重複；結果修正後不能用舊排名發布',async()=>{
  await finishGroups();await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});
  for(const id of ['F1','F3'])await match(id).update({status:'finished',score:{home:1,away:0},result:result(1,0)});
  await publishFinalRankingFor({eventId:E,divisionId:D,actorUid:'admin'});await publishFinalRankingFor({eventId:E,divisionId:D,actorUid:'admin'});
  expect((await audit('finalRanking.publish')).size).toBe(1);
  await manageEventFor(await command());expect((await div().get()).data().finalRankingPublished).toBe(false);
  expect((await publishFinalRankingFor({eventId:E,divisionId:D,actorUid:'admin'})).published).toBe(false);
});

test('MC13 結果與稽核提交失敗一起回滾，before 來自交易內最新文件',async()=>{
  await finishGroups();const before=(await match('g1').get()).data();const req=await command();failAudit();
  await expect(manageEventFor(req)).rejects.toThrow('audit submission fault');
  expect((await match('g1').get()).data()).toEqual(before);expect((await audit('match.override')).size).toBe(0);
});
test('MC14 管理交易自動重試及重送只留下真實 actor 的一次結果／稽核',async()=>{
  await finishGroups();const req=await command();req.data.actor={uid:'forged'};const attempts=failAudit({retry:true});
  const r=await manageEventFor(req);expect(attempts()).toBeGreaterThan(1);expect(await manageEventFor(req)).toEqual(r);
  const audits=await audit('match.override');expect(audits.size).toBe(1);
  expect(audits.docs[0].data()).toMatchObject({actor:{uid:'admin'},before:{score:{home:2,away:0}},after:{score:{home:1,away:3},revisionCount:1}});
},20_000);
test('MC15 併發改判只有一份以同一 before 成功；角色停用及舊版本均拒絕',async()=>{
  await finishGroups();const a=await command('match.override','first'),b=await command('match.override','second');
  const out=await Promise.allSettled([manageEventFor(a),manageEventFor(b)]);expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await audit('match.override')).size).toBe(1);expect((await match('g1').get()).data().revisionCount).toBe(1);
  await db.doc('staff/admin').update({active:false});await expect(manageEventFor(a)).rejects.toMatchObject({code:'permission-denied'});
},20_000);
test('MC16 申訴、徽章與稽核原子提交，裁決重送冪等，申訴截止由伺服器核對',async()=>{
  await finishGroups();await match('g1').update({scoreSubmittedAt:new Date(Date.now()-5*60000)});
  const req=await command('appeal.filed','appeal-first',{appeal:{appealId:'g1-t1',doc:{teamId:'t1',filedBy:{role:'leader',name:'領隊',phone:null},depositPaid:true,late:false,reason:'進球越位在先'}}});
  failAudit();await expect(manageEventFor(req)).rejects.toThrow('audit submission fault');expect((await base().collection('appeals').doc('g1-t1').get()).exists).toBe(false);
  jest.restoreAllMocks();await manageEventFor(req);
  const decision=await command('appeal.decided','decision',{appeal:{appealId:'g1-t1',patch:{decision:{upheld:true,note:'錄影核對成立'}}}});
  await manageEventFor(decision);await manageEventFor(decision);
  expect((await match('g1').get()).data().appeal.status).toBe('upheld');expect((await audit('appeal.decided')).size).toBe(1);
  expect((await audit('appeal.decided')).docs[0].data().after.match).toMatchObject({managementRevision:2,updatedBy:'admin'});
  await match('g2').update({scoreSubmittedAt:new Date(Date.now()-31*60000)});
  const late=await command('appeal.filed','late',{matchId:'g2',expected:matchBasis((await match('g2').get()).data()),appeal:{appealId:'g2-t1',doc:{...req.data.appeal.doc}}});
  await expect(manageEventFor(late)).rejects.toThrow('已超過賽後 30 分鐘');
});

const person=(extra={})=>({memberId:'member',name:'王小明',birthDate:'2016-01-01',idLast4:'1234',role:'player',status:'approved',guardianUid:'guardian',...extra});
test('MC17 投影刪除錯誤必須傳出，重試後清除；舊 approved 事件不能復活投影',async()=>{
  await member('member').set(person());await syncRosterFor({eventId:E,teamId:'t1',memberId:'member'});await member('member').update({status:'removed'});
  const original=db.runTransaction.bind(db);jest.spyOn(db,'runTransaction').mockImplementation(cb=>original(async tx=>{tx.delete=()=>{throw Error('projection transport failed');};return cb(tx);}));
  await expect(syncRosterFor({eventId:E,teamId:'t1',memberId:'member'})).rejects.toThrow('projection transport failed');jest.restoreAllMocks();
  await onMemberWritten.run(eventOf(null,person(),{teamId:'t1',memberId:'member'}));expect((await roster('member').get()).exists).toBe(false);
});
test('MC18 交錯核准、退件及刪除後，不得寫回舊投影或舊計數',async()=>{
  await member('member').set(person());
  await Promise.all([syncRosterFor({eventId:E,teamId:'t1',memberId:'member'}),member('member').update({status:'rejected'}).then(()=>syncRosterFor({eventId:E,teamId:'t1',memberId:'member'}))]);
  expect((await roster('member').get()).exists).toBe(false);
  await member('other').set(person({memberId:'other'}));
  await Promise.all([recountTeamMembers({eventId:E,teamId:'t1'}),member('other').delete().then(()=>recountTeamMembers({eventId:E,teamId:'t1'}))]);
  expect((await team('t1').get()).data().memberCount).toBe(0);
},20_000);
test('MC19 同時／亂序重複申請保留最早一筆，同 timestamp 以 id 排序，已核准不退件',async()=>{
  for(const id of ['later','early','tie'])await member(id).set(person({memberId:id,status:'pending',appliedAt:id==='later'?20:10}));
  const args=id=>({eventId:E,teamId:'t1',memberId:id,member:person({status:'pending'})});
  await Promise.all(['tie','later','early'].map(id=>rejectDuplicateApplication(args(id))));
  const pending=(await team('t1').collection('members').get()).docs.filter(d=>d.data().status==='pending');expect(pending.map(d=>d.id)).toEqual(['early']);
  await member('early').update({status:'approved'});
  await member('new1').set(person({status:'pending',appliedAt:30}));await member('new2').set(person({status:'pending',appliedAt:40}));
  await rejectDuplicateApplication(args('early'));
  expect((await member('early').get()).data().status).toBe('approved');
  expect((await audit('member.duplicateRejected')).size).toBe(2);
},20_000);
test('MC20 公開投影維持未成年遮名與白名單，交易重放讀取最新名單',async()=>{
  await member('member').set(person({phone:'private',guardianName:'私密',photoUrl:'private-photo'}));
  await syncRosterFor({eventId:E,teamId:'t1',memberId:'member'});const doc=(await roster('member').get()).data();
  expect(doc.displayName).toBe('王小＊');for(const field of ['birthDate','idLast4','guardianUid','guardianName','phone'])expect(doc[field]).toBeUndefined();expect(doc.photoUrl).toBeNull();
});
test('MC21 投影與計數不能讀取交易開始前的舊快照',async()=>{
  await member('member').set(person());injectAtTransactionStart(()=>member('member').update({status:'removed'}));
  await syncRosterFor({eventId:E,teamId:'t1',memberId:'member'});expect((await roster('member').get()).exists).toBe(false);
  jest.restoreAllMocks();await member('member').update({status:'approved'});injectAtTransactionStart(()=>member('member').delete());
  await recountTeamMembers({eventId:E,teamId:'t1'});expect((await team('t1').get()).data().memberCount).toBe(0);
});
test('MC22 人工名次裁定與稽核失敗回滾；同版本併發只有一份裁定提交',async()=>{
  const args={eventId:E,divisionId:D,stageId:'group',groupId:'A',actorUid:'admin',reason:'抽籤確認',expectedVersion:0,pins:[{teamId:'t1',rank:1},{teamId:'t2',rank:2}]};
  failAudit();await expect(setManualRankingFor(args)).rejects.toThrow('audit submission fault');
  expect((await base().collection('standings').doc(`${D}__group__A`).get()).data().version).toBe(0);
  jest.restoreAllMocks();const out=await Promise.allSettled([setManualRankingFor(args),setManualRankingFor({...args,reason:'另一筆裁定'})]);
  expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await audit('standing.manualRanking')).size).toBe(1);
},20_000);
test('MC23 排程搬移與稽核提交失敗回滾；重試重送及舊排程版本受到保護',async()=>{
  const req=request({operationId:'move',action:'schedule.move',divisionId:D,expected:0,updates:[{matchId:'g1',patch:{kickoffAt:1000,venueId:'v1'}}]});
  failAudit();await expect(manageEventFor(req)).rejects.toThrow('audit submission fault');expect((await match('g1').get()).data().venueId).toBeUndefined();
  jest.restoreAllMocks();await manageEventFor(req);await manageEventFor(req);expect((await audit('schedule.move')).size).toBe(1);
  await expect(manageEventFor({...req,data:{...req.data,operationId:'stale-move'}})).rejects.toMatchObject({code:'aborted'});
});
test('MC24 退賽已開打下游保持比分並標衝突；事件重送不重複衝突稽核',async()=>{
  await finishGroups();await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});await match('F1').update({status:'live',score:{home:1,away:0}});
  const before=(await team('t1').get()).data();await team('t1').update({withdrawn:true});const event=eventOf(before,{...before,withdrawn:true},{teamId:'t1'});
  await onTeamWritten.run(event);const first=(await match('F1').get()).data();expect(first.score.home).toBe(1);expect(first.home.teamId).toBe('t1');expect(first.advancementConflict).toBeTruthy();
  const n=(await audit('advancement.conflict')).size;await onTeamWritten.run(event);expect((await audit('advancement.conflict')).size).toBe(n);
});
test('MC25 已核准的兄弟姊妹不構成重複待審，單筆新申請保持 pending',async()=>{
  await member('approved').set(person({appliedAt:10}));await member('new').set(person({status:'pending',appliedAt:20}));
  await rejectDuplicateApplication({eventId:E,teamId:'t1',memberId:'new'});expect((await member('new').get()).data().status).toBe('pending');
});
test('MC26 晉級與最終排名的稽核失敗，業務結果也一起回滾',async()=>{
  await finishGroups();failAudit();await expect(resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'})).rejects.toThrow('audit submission fault');
  expect((await match('F1').get()).data().teamIds).toEqual([]);expect((await audit('advancement.resolve')).size).toBe(0);
  jest.restoreAllMocks();await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final'});
  for(const id of ['F1','F3'])await match(id).update({status:'finished',score:{home:1,away:0},result:result(1,0)});
  failAudit();await expect(publishFinalRankingFor({eventId:E,divisionId:D,actorUid:'admin'})).rejects.toThrow('audit submission fault');
  expect((await div().get()).data().finalRankingPublished).toBe(false);expect((await audit('finalRanking.publish')).size).toBe(0);
});
test('MC27 強制解算也尊重人工暫停，不能填入下游隊伍',async()=>{
  await finishGroups();await div().update({manualHold:true});
  const held=await resolveAdvancementForStage({eventId:E,divisionId:D,stageId:'final',force:true});
  expect(held.ready).toBe(false);expect((await match('F1').get()).data().teamIds).toEqual([]);
  expect((await audit('advancement.resolve')).size).toBe(0);
});
test('MC28 單筆完整稽核過大時先拒絕，保留原賽程及子紀錄',async()=>{
  await match('g1').collection('timeline').doc('large').set({type:'note',note:'x'.repeat(930*1024)});
  await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'resource-exhausted'});
  expect((await match('g1').get()).exists).toBe(true);
  expect((await match('g1').collection('timeline').doc('large').get()).exists).toBe(true);
  expect((await audit('schedule.generate')).size).toBe(0);
});
test('MC29 父隊伍刪除後重送舊名單事件，也不能復活公開投影',async()=>{
  await member('member').set(person());await syncRosterFor({eventId:E,teamId:'t1',memberId:'member'});
  injectAtTransactionStart(()=>team('t1').delete());
  await syncRosterFor({eventId:E,teamId:'t1',memberId:'member'});
  expect((await roster('member').get()).exists).toBe(false);
});
test('MC30 不改比分的管理操作也核對版本；舊收據重送冪等，新的意圖用新版本提交',async()=>{
  const a=await command('stream.update','stream-a',{patch:{stream:{provider:'youtube',videoId:'abcdefghijk',status:'live'}}});
  const stale=await command('stream.update','stream-stale',{patch:{stream:{provider:'youtube',videoId:'lmnopqrstuv',status:'live'}}});
  const receipt=await manageEventFor(a);
  await expect(manageEventFor(stale)).rejects.toMatchObject({code:'aborted'});
  expect(await manageEventFor(a)).toEqual(receipt);expect((await audit('stream.update')).size).toBe(1);
  const fresh=await command('stream.update','stream-fresh',{patch:stale.data.patch});await manageEventFor(fresh);
  expect((await match('g1').get()).data()).toMatchObject({managementRevision:2,stream:{videoId:'lmnopqrstuv'}});
  expect((await audit('stream.update')).size).toBe(2);
});
test('MC31 0:0 開打後取消仍有期別紀錄，不能當成未開打重產',async()=>{
  await match('g1').update({status:'cancelled',period:'h1',score:{home:0,away:0}});
  await expect(generateScheduleFor(generation())).rejects.toMatchObject({code:'failed-precondition'});
  expect((await match('g1').get()).exists).toBe(true);expect((await audit('schedule.generate')).size).toBe(0);
});

test('MC32 重產後積分榜版本重用，舊賽程的裁定仍必須拒絕且沒有稽核副作用',async()=>{
  await generateScheduleFor(generation());
  const ref=base().collection('standings').doc(`${D}__group__A`),before=(await ref.get()).data();
  await generateScheduleFor(generation('generation-2',{expectedRevision:1}));
  const after=(await ref.get()).data();expect(after.version).toBe(before.version);
  const args={eventId:E,divisionId:D,stageId:'group',groupId:'A',actorUid:'admin',reason:'舊視窗裁定',
    pins:['t1','t2','t3','t4'].map((teamId,i)=>({teamId,rank:i+1})),expectedVersion:before.version,expectedScheduleRevision:1};
  await expect(setManualRankingFor(args)).rejects.toMatchObject({code:'aborted'});
  expect((await audit('standing.manualRanking')).size).toBe(0);
  await setManualRankingFor({...args,expectedScheduleRevision:2});
  expect((await ref.get()).data()).toMatchObject({scheduleRevision:2,version:before.version+1});
  expect((await audit('standing.manualRanking')).size).toBe(1);
});
