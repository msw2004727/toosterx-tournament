import { db } from '../../functions/admin.js';
import { addTeamPlayersFor } from '../../functions/team-player-add.js';
import { enforceRosterCap } from '../../functions/pipeline.js';
const E='team-player-add-test', base=()=>db().doc(`events/${E}`), team=()=>base().collection('teams').doc('t');
const request=(players=[{name:'新球員'}],uid='captain',over={})=>({auth:uid?{uid}:null,data:{eventId:E,teamId:'t',operationId:'add-1',players,...over}});
beforeEach(async()=>{
  if(!process.env.FIRESTORE_EMULATOR_HOST) throw Error('Emulator required');
  const project=process.env.GCLOUD_PROJECT||'demo-fn-test';
  const reset=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  if(!reset.ok)throw Error('Emulator reset failed');
  const batch=db().batch();
  batch.set(base(),{dates:['2026-10-09']}); batch.set(base().collection('divisions').doc('u10'),{eligibility:{bornOnOrAfter:'2016-01-01'}});
  for(const role of ['admin','super_admin','scorer','staff','inactive'])batch.set(db().doc(`staff/${role}`),{active:role!=='inactive',roles:[role==='inactive'?'admin':role],name:role});
  batch.set(team(),{name:'球隊',shortName:'球隊',divisionId:'u10',captainUid:'captain',captainName:'隊長',source:'csv',rosterLocked:true,status:'approved',memberCount:2,playerCount:1,rosterRevision:3});
  batch.set(team().collection('members').doc('old'),{memberId:'old',name:'原球員',kind:'player',role:'player',status:'approved',jerseyNo:7,stats:{goals:2}});
  batch.set(team().collection('members').doc('coach'),{memberId:'coach',name:'教練',kind:'coach',role:'coach',status:'approved',jerseyNo:null});
  batch.set(team().collection('roster').doc('old'),{displayName:'原球員',jerseyNo:7});
  await batch.commit();
});

test('ADD-ATOMIC 隊長可只填姓名一次新增兩位；私密名冊、公開投影、人數、稽核與回執同步',async()=>{
  const before=(await team().collection('members').doc('old').get()).data();
  const result=await addTeamPlayersFor(request([{name:'甲球員'},{name:'乙球員',jerseyNo:0}]));
  expect(result).toMatchObject({teamId:'t',addedCount:2,playerCount:3,memberCount:4,rosterRevision:4,operationId:'add-1'});
  expect(result.memberIds).toHaveLength(2);
  for(const [i,id] of result.memberIds.entries()){
    const m=(await team().collection('members').doc(id).get()).data();
    expect(m).toMatchObject({name:i===0?'甲球員':'乙球員',birthDate:'',idLast4:'',jerseyNo:i===0?null:0,status:'approved',source:'csv',createdVia:'team-management',identityComplete:false,guardianUid:null,addedBy:'captain'});
    const publicSnap=await team().collection('roster').doc(id).get();expect(publicSnap.exists).toBe(true);
    const pub=publicSnap.data();
    expect(pub.displayName).toBe(i===0?'甲O員':'乙O員');expect(pub).not.toHaveProperty('birthDate');expect(pub).not.toHaveProperty('idLast4');
  }
  expect((await team().get()).data()).toMatchObject({status:'approved',captainUid:'captain',rosterLocked:true,playerCount:3,memberCount:4});
  expect((await team().collection('members').doc('old').get()).data()).toEqual(before);
  expect((await base().collection('audits').doc(result.auditId).get()).data()).toMatchObject({action:'team.players.add',actor:{uid:'captain'},before:{playerCount:1},after:{playerCount:3}});
  expect((await base().collection('managementOperations').doc('add-1').get()).data().result).toEqual(result);
});
test.each([null,'scorer','staff','inactive','missing'])('ADD-AUTH 未登入、停用與非該隊隊長不能新增：%s',async uid=>{
  await expect(addTeamPlayersFor(request(undefined,uid))).rejects.toMatchObject({code:uid?'permission-denied':'unauthenticated'});
  expect((await team().collection('members').get()).size).toBe(2);expect((await base().collection('audits').get()).size).toBe(0);
});
test('ADD-LOCK 隊長遇到上鎖或被重新指派時拒絕；管理員及大總管仍可新增',async()=>{
  await team().update({managementLocked:true});
  await expect(addTeamPlayersFor(request())).rejects.toMatchObject({code:'permission-denied'});
  await expect(addTeamPlayersFor(request([{name:'管理員新增'}],'admin'))).resolves.toMatchObject({addedCount:1});
  await expect(addTeamPlayersFor(request([{name:'總管新增'}],'super_admin',{operationId:'super-add'}))).resolves.toMatchObject({addedCount:1});
  await team().update({managementLocked:false,captainUid:'new-captain'});
  await expect(addTeamPlayersFor(request([{name:'撤銷後新增'}],'captain',{operationId:'revoked'}))).rejects.toMatchObject({code:'permission-denied'});
});
test.each([[{name:'有效'},{name:''}],[{name:'原球員'}],[{name:'甲',jerseyNo:7}],[{name:'甲',jerseyNo:8},{name:'乙',jerseyNo:8}],
  [{name:'甲',birthDate:'2020-02-30'}],[{name:'甲',idLast4:'012'}],[]].map(rows=>[rows]))('ADD-INVALID 任一列無效時整批零寫入：%j',async rows=>{
  await expect(addTeamPlayersFor(request(rows))).rejects.toMatchObject({code:'invalid-argument'});
  expect((await team().collection('members').get()).size).toBe(2);expect((await base().collection('audits').get()).size).toBe(0);
});
test('ADD-RETRY 重送及同時重送只建立一批，換人或換資料不能冒用回執',async()=>{
  const [first,second]=await Promise.all([addTeamPlayersFor(request()),addTeamPlayersFor(request())]);
  expect(second).toEqual(first); expect(await addTeamPlayersFor(request())).toEqual(first);
  expect((await team().collection('members').get()).size).toBe(3);expect((await base().collection('audits').get()).size).toBe(1);
  await expect(addTeamPlayersFor(request([{name:'其他'}]))).rejects.toMatchObject({code:'already-exists'});
  await expect(addTeamPlayersFor(request(undefined,'admin'))).rejects.toMatchObject({code:'already-exists'});
},30_000);
test('ADD-CONCURRENT 兩人搶同背號只有一位成功，保留既有成員',async()=>{
  const before=(await team().collection('members').doc('old').get()).data();
  const commands=[request([{name:'甲',jerseyNo:9}],'admin'),request([{name:'乙',jerseyNo:9}],'super_admin',{operationId:'add-2'})];
  const results=await Promise.allSettled(commands.map(addTeamPlayersFor));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  const loser=results.findIndex(r=>r.status==='rejected'),error=results[loser].reason;
  // 與既有更名競爭測試相同：Emulator 有時以 gRPC 3 中斷敗方交易。
  // 不重試整個測試；只重送原封不動的敗方請求，仍必須得到重複背號拒絕。
  if(error.code===3){
    console.warn('Emulator concurrent player add: replay original rejected command once:',error.message);
    await expect(addTeamPlayersFor(commands[loser])).rejects.toMatchObject({code:'invalid-argument'});
  }else expect(error.code).toBe('invalid-argument');
  expect((await team().get()).data().playerCount).toBe(2);
  const members=await team().collection('members').get();
  expect(members.docs.filter(d=>d.get('jerseyNo')===9)).toHaveLength(1);
  expect(members.size).toBe(3);expect((await team().collection('roster').get()).size).toBe(2);
  expect((await base().collection('audits').get()).size).toBe(1);
  expect((await base().collection('managementOperations').get()).size).toBe(1);
  expect((await team().collection('members').doc('old').get()).data()).toEqual(before);
},30_000);
test('完整選填資料可儲存，傳入來源、權限、狀態與公開名稱均不採用',async()=>{
  const result=await addTeamPlayersFor(request([{name:'小飛',birthDate:'2020-01-01',idLast4:'0012',jerseyNo:0,isGoalkeeper:true,source:'admin',role:'super_admin',status:'rejected',displayName:'公開真名'}]));
  const m=(await team().collection('members').doc(result.memberIds[0]).get()).data();
  expect(m).toMatchObject({role:'player',status:'approved',source:'csv',identityComplete:true,idLast4:'0012',isGoalkeeper:true,nameKind:'nickname'});
  expect(m).not.toHaveProperty('displayName');expect((await team().collection('roster').doc(result.memberIds[0]).get()).data().displayName).toBe('小飛');
});
test('ADD-CAP 一般球隊保留人數上限，行政匯入隊伍可追加且 trigger 不退件',async()=>{
  const rows=Array.from({length:15},(_,i)=>({name:`新增${i}`}));
  await expect(addTeamPlayersFor(request(rows,'admin'))).rejects.toMatchObject({code:'failed-precondition'});
  await team().update({captainUid:null});
  const result=await addTeamPlayersFor(request(rows,'admin'));
  expect(result.playerCount).toBe(16);expect(await enforceRosterCap({eventId:E,teamId:'t'})).toEqual({rejected:[]});
});
test.each([{teamId:'../t'},{eventId:'../e'},{operationId:''},{operationId:'../op'}])('非法操作或路徑拒絕：%j',async over=>{
  await expect(addTeamPlayersFor(request(undefined,'admin',over))).rejects.toMatchObject({code:'invalid-argument'});
});
