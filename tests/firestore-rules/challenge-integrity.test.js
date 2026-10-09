import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeEnv, authed, guest, EVENT } from './helpers.js';
import { CHALLENGES } from '../../scripts/seed/build.js';
let env;
beforeAll(async()=>{env=await makeEnv();});
afterAll(async()=>{await env.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'events',EVENT,'players','p1'),{nickname:'測試玩家'});
    for(const c of CHALLENGES)await setDoc(doc(db,'events',EVENT,'challenges',c.challengeId),c);
    for(const role of ['booth','checkin','referee','scorer','staff','admin','super_admin'])await setDoc(doc(db,'staff',role),
      {active:true,roles:[role],assignment:{eventId:EVENT,challengeIds:CHALLENGES.map(c=>c.challengeId)}});
  });
});
function record(c,id,role='booth',over={}){
  const detail=c.inputMode==='shots'?Array(c.shotCount).fill(c.shotOptions[0]):null;
  return {attemptId:id,eventId:EVENT,challengeId:c.challengeId,playerId:'p1',staffUid:role,
    createdAt:serverTimestamp(),rawValue:detail?detail.reduce((n,v)=>n+v,0):c.minValue,detail,isBest:false,voided:false,...over};
}
test.each(['booth','checkin','referee','scorer','staff','admin','super_admin'])('%s 七攤合法登錄皆可入庫',async role=>{
  for(const c of CHALLENGES){const id=`${role}-${c.challengeId}`,db=authed(env,role);
    await assertSucceeds(setDoc(doc(db,'events',EVENT,'attempts',id),record(c,id,role)));
    expect((await getDoc(doc(db,'events',EVENT,'attempts',id))).data().rawValue).toBe(record(c,id,role).rawValue);
  }
});
test('球數、細項加總、非法級距與非整數全部拒絕',async()=>{
  const cases=[[0,{rawValue:15,detail:[0,0,0,0,0]}],[4,{rawValue:250,detail:[10,10,10,10,10]}],
    [4,{rawValue:51,detail:[10,10,10,10,10]}],[0,{detail:[1,1,1,1],rawValue:4}],
    [1,{rawValue:105}],[2,{rawValue:2.5}],[6,{rawValue:3,detail:[0,0,0]}],[5,{rawValue:0}]];
  for(const [i,[ci,over]]of cases.entries())await assertFails(setDoc(doc(authed(env,'booth'),'events',EVENT,'attempts',`bad${i}`),record(CHALLENGES[ci],`bad${i}`,'booth',over)));
  await assertSucceeds(setDoc(doc(authed(env,'booth'),'events',EVENT,'attempts','260'),record(CHALLENGES[1],'260','booth',{rawValue:260})));
});
test('不存在玩家、錯誤路徑／活動、偽造旗標與額外 UID 全部拒絕',async()=>{
  for(const [i,over]of [{playerId:'missing'},{attemptId:'wrong'},{eventId:'wrong'},{isBest:true},{voided:true},{lineUid:'leak'}].entries())
    await assertFails(setDoc(doc(authed(env,'booth'),'events',EVENT,'attempts',`identity${i}`),record(CHALLENGES[2],`identity${i}`,'booth',over)));
});
test('一般玩家、停用、未指派、跨活動不可登錄；私人成績與公開投影分離',async()=>{
  for(const [i,patch]of [{active:false},{assignment:{eventId:EVENT,challengeIds:[]}},{assignment:{eventId:'other',challengeIds:CHALLENGES.map(c=>c.challengeId)}}].entries()){
    await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'staff','booth'),patch));
    await assertFails(setDoc(doc(authed(env,'booth'),'events',EVENT,'attempts',`denied${i}`),record(CHALLENGES[2],`denied${i}`)));
  }
  await assertFails(setDoc(doc(guest(env),'events',EVENT,'attempts','guest'),record(CHALLENGES[2],'guest')));
  await assertFails(setDoc(doc(authed(env,'player'),'events',EVENT,'attempts','player'),record(CHALLENGES[2],'player','player')));
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'events',EVENT,'attempts','private'),{staffUid:'LINE-PRIVATE'});
    await setDoc(doc(ctx.firestore(),'events',EVENT,'attemptPublic','private'),{rawValue:0});
  });
  await assertFails(getDoc(doc(guest(env),'events',EVENT,'attempts','private')));
  await assertSucceeds(getDoc(doc(guest(env),'events',EVENT,'attemptPublic','private')));
  await assertFails(setDoc(doc(authed(env,'admin'),'events',EVENT,'attemptPublic','forge'),{rawValue:99}));
  await assertFails(updateDoc(doc(authed(env,'admin'),'events',EVENT,'challenges',CHALLENGES[0].challengeId),{dailyOpen:{}}));
});
