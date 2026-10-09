import { db } from '../../functions/admin.js';
import { onAttemptSubmitted } from '../../functions/pipeline.js';
import { syncPublicAttempt, exportChallengeParticipantsFor } from '../../functions/challenge-integrity.js';
import { updateChallengeDayFor, refreshChallengeDayJob } from '../../functions/challenge-days.js';
import { CHALLENGES } from '../../scripts/seed/build.js';
import { dailyRewardSettings } from '../../js/engine/challenge-days.js';
import { toCsv } from '../../js/engine/csv.js';
const eventId='integrity-test',date='2026-10-09',base=()=>db().doc(`events/${eventId}`);
const exp=(over={})=>exportChallengeParticipantsFor({eventId,date,actorUid:'integrity-admin',...over});
beforeEach(async()=>{
  await db().recursiveDelete(base());
  await db().doc('config/challengeRewards').set(dailyRewardSettings([date]));
  await db().doc('staff/integrity-admin').set({active:true,roles:['admin']});
  await db().doc('staff/integrity-booth').set({active:true,roles:['booth'],assignment:{eventId,challengeIds:CHALLENGES.map(c=>c.challengeId)}});
  for(const c of CHALLENGES)await base().collection('challenges').doc(c.challengeId).set({...c,dailyOpen:{[date]:true}});
  for(const pid of ['p1','p2','p3'])await base().collection('players').doc(pid).set({nickname:pid==='p1'?'=危險,暱稱':pid,createdVia:pid==='p2'?'staff':'line',completedChallengeIds:[],luckyDrawEntries:0});
  await db().doc('users/LINE-PLAYER-1').set({gamePassId:'p1'});
  await base().collection('playerContacts').doc('p1').set({phone:'0912345678'});
});
async function put(c,id,over={}){
  const detail=c.inputMode==='shots'?Array(c.shotCount).fill(c.shotOptions[0]):null;
  await base().collection('attempts').doc(id).set({attemptId:id,eventId,playerId:'p1',challengeId:c.challengeId,
    rawValue:detail?detail.reduce((n,v)=>n+v,0):c.minValue,detail,staffUid:'LINE-STAFF-PRIVATE',
    isBest:false,voided:false,recordedAtMs:Date.parse(`${date}T12:00:00+08:00`),createdAt:Date.parse(`${date}T12:00:01+08:00`),...over});
}
test('七攤結算、完整名單 UID／電話與零分、私人成績投影、作廢撤回資格',async()=>{
  for(const c of CHALLENGES){await put(c,c.challengeId);await onAttemptSubmitted({eventId,challengeId:c.challengeId,playerId:'p1'});await syncPublicAttempt(eventId,c.challengeId);}
  expect((await base().collection('players').doc('p1').get()).data().luckyDrawEntries).toBe(1);
  const exported=await exp();expect(exported.rows).toHaveLength(3);
  expect(exported.rows[0]).toMatchObject({lineUid:'LINE-PLAYER-1',contact:'0912345678',entries:1,completedCount:7});
  expect(exported.rows[1]).toMatchObject({lineUid:'',contact:'',entries:0});
  expect(exported.rows[0][`score_${CHALLENGES[6].challengeId}`]).toBe('0次全倒');
  expect(toCsv(exported.columns,exported.rows)).toContain("'=危險");
  const projection=(await base().collection('attemptPublic').get()).docs.map(d=>d.data());
  expect(projection).toHaveLength(7);expect(JSON.stringify(projection)).not.toMatch(/LINE-|091234|staffUid|voidReason/);
  const detail=(await exp({mode:'attempts'})).rows[0];
  expect(detail.recordedAt).toBe(`${date}T04:00:00.000Z`);
  expect(detail.createdAt).toBe(`${date}T04:00:01.000Z`);
  await base().collection('attempts').doc(CHALLENGES[5].challengeId).update({voided:true,voidReason:'掃錯卡'});
  await onAttemptSubmitted({eventId,challengeId:CHALLENGES[5].challengeId,playerId:'p1'});await syncPublicAttempt(eventId,CHALLENGES[5].challengeId);
  expect((await exp()).rows[0].entries).toBe(0);
  expect((await exp({mode:'attempts'})).rows.find(r=>r.attemptId===CHALLENGES[5].challengeId)).toMatchObject({voided:'是',voidReason:'掃錯卡'});
});
test('歷史偽造總分排除、payload ID 不覆蓋真正路徑，不中斷結算',async()=>{
  const c=CHALLENGES[0];await put(c,'good');await put(c,'bad',{attemptId:'NONEXISTENT',rawValue:15});
  await onAttemptSubmitted({eventId,challengeId:c.challengeId,playerId:'p1'});await syncPublicAttempt(eventId,'bad');
  expect((await base().collection('leaderboards').doc(c.challengeId).get()).data().rows[0].value).toBe(0);
  expect((await base().collection('attemptValidation').doc('bad').get()).data().status).toBe('quarantined');
  expect((await base().collection('attemptPublic').doc('bad').get()).exists).toBe(false);
});
test('開關變更留耐久工作、重算所有摘要與匯出一致、重放不重複稽核',async()=>{
  for(const c of CHALLENGES.slice(0,6))await put(c,c.challengeId);
  await onAttemptSubmitted({eventId,challengeId:CHALLENGES[0].challengeId,playerId:'p1'});
  expect((await base().collection('players').doc('p1').get()).data().luckyDrawEntries).toBe(0);
  await updateChallengeDayFor({eventId,challengeId:CHALLENGES[6].challengeId,date,open:false,expectedOpen:true,actorUid:'integrity-admin'});
  const job=(await base().collection('challengeRefreshJobs').get()).docs[0];await refreshChallengeDayJob(eventId,job.id);await refreshChallengeDayJob(eventId,job.id);
  expect((await base().collection('players').doc('p1').get()).data().challengeDays[date].entries).toBe(1);
  expect((await exp()).rows[0].entries).toBe(1);
  expect((await base().collection('audits').where('action','==','challenge.qualification.refreshed').get()).size).toBe(1);
});
test('完整名單含未全破／未參與者，參與篩選限選日；攤位與停用管理員禁止匯出',async()=>{
  await put(CHALLENGES[2],'one');await put(CHALLENGES[2],'old',{playerId:'p3',recordedAtMs:Date.parse('2026-10-10T12:00:00+08:00')});
  expect((await exp({scope:'participated'})).rows.map(r=>r.playerId)).toEqual(['p1']);
  await expect(exp({actorUid:'integrity-booth'})).rejects.toMatchObject({code:'permission-denied'});
  await db().doc('staff/integrity-admin').update({active:false});await expect(exp()).rejects.toMatchObject({code:'permission-denied'});
});
