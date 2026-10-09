import { db } from '../../functions/admin.js';
import { issueNextChallengeCardFor } from '../../functions/challenge-rounds.js';
import { onAttemptSubmitted, issueGamePassFor } from '../../functions/pipeline.js';
import { dailyDrawExportFor, updateChallengeDayFor, refreshChallengeDayJob } from '../../functions/challenge-days.js';
import { exportChallengeParticipantsFor, syncPublicAttempt } from '../../functions/challenge-integrity.js';
import { activityDate } from '../../js/engine/challenge-days.js';
import { dailyRewardSettings } from '../../js/engine/challenge-days.js';
const eventId='round-test',pid='FEDA-0182',uid='round-owner',date=activityDate(Date.now()),base=()=>db().doc(`events/${eventId}`);
const root=()=>base().collection('players').doc(pid);
const next=(fromCode=pid,over={})=>issueNextChallengeCardFor({eventId,uid,date,fromCode,...over});
const draw=()=>dailyDrawExportFor({eventId,date,actorUid:'round-admin'});
async function put(ids,code=pid){for(const id of ids)await base().collection('attempts').doc(`${code}-${id}`).set({attemptId:`${code}-${id}`,eventId,playerId:pid,challengeId:id,roundCode:code,rawValue:0,recordedAtMs:Date.now()-1000,createdAt:Date.now()-1000});}
const refresh=()=>onAttemptSubmitted({eventId,playerId:pid,challengeId:'a'});
beforeEach(async()=>{
  await db().recursiveDelete(base());
  await db().doc('config/challengeRewards').set({...dailyRewardSettings([date]),roundsEnabled:true,version:'daily-rounds-v1'});
  await db().doc(`users/${uid}`).set({gamePassId:pid});
  await db().doc('staff/round-admin').set({active:true,roles:['admin']});
  await root().set({playerId:pid,eventId,nickname:'玩家',createdVia:'line',completedChallengeIds:[],luckyDrawEntries:0});
  await base().collection('playerContacts').doc(pid).set({phone:'0912345678'});
  for(const [order,id] of ['a','b','c','d','e'].entries())await base().collection('challenges').doc(id).set({challengeId:id,order,name:id,inputMode:'stepper',minValue:0,maxValue:5,dailyOpen:{[date]:id!=='e'}});
});
test('ROUNDISSUE 同時領卡冪等，保留人物／聯絡／歷史，一輪一券可連續到第三輪',async()=>{
  await put(['a','b','c','d']);await refresh();
  const [a,b]=await Promise.all([next(),next()]);expect(a.cardCode).toBe(b.cardCode);expect(a.cardCode).not.toBe(pid);
  expect((await root().get()).data().challengeRounds[date]).toHaveLength(2);
  expect((await draw()).rows).toHaveLength(1);expect((await draw()).rows[0]).toMatchObject({playerId:pid,entries:1,contact:'0912345678'});
  expect((await issueGamePassFor({eventId,uid})).playerId).toBe(pid);
  await put(['a','b','c','d'],a.cardCode);await refresh();
  expect((await draw()).rows[0].entries).toBe(2);
  const third=await next(a.cardCode);expect(third.number).toBe(3);expect(third.cardCode).not.toBe(a.cardCode);
  expect((await draw()).rows[0].entries).toBe(2);
  expect((await base().collection('audits').where('action','==','challenge.round.issued').get()).size).toBe(2);
  const exported=await exportChallengeParticipantsFor({eventId,date,actorUid:'round-admin'});
  expect(exported.rows).toHaveLength(1);expect(exported.rows[0]).toMatchObject({lineUid:uid,entries:2,contact:'0912345678'});
});
test('ROUNDGATE 未滿、他人卡號、錯日期與不屬於帳號的領卡請求拒絕',async()=>{
  await expect(next()).rejects.toMatchObject({code:'failed-precondition'});
  await put(['a','b','c','d']);await refresh();
  await expect(next('FEDA-9999')).rejects.toMatchObject({code:'permission-denied'});
  await expect(next(pid,{date:'2000-01-01'})).rejects.toMatchObject({code:'failed-precondition'});
  await expect(next(pid,{uid:'other'})).rejects.toMatchObject({code:'failed-precondition'});
});
test('ROUNDREOPEN 保留第一輪四攤資格，第二輪加第五攤且只補入第二輪',async()=>{
  await put(['a','b','c','d']);await refresh();const card=await next();
  await updateChallengeDayFor({eventId,challengeId:'e',date,open:true,expectedOpen:false,actorUid:'round-admin'});
  const jobs=await base().collection('challengeRefreshJobs').get();for(const job of jobs.docs)await refreshChallengeDayJob(eventId,job.id);
  await put(['e'],card.cardCode);await refresh();
  const rows=(await root().get()).data().challengeRounds[date];
  expect(rows[0]).toMatchObject({entries:1,required:['a','b','c','d']});expect(rows[1]).toMatchObject({entries:0,done:['e'],required:['a','b','c','d','e']});
  await expect(next(card.cardCode)).rejects.toMatchObject({code:'failed-precondition'});
  await put(['a','b','c','d'],card.cardCode);await refresh();expect((await draw()).rows[0].entries).toBe(2);
  await syncPublicAttempt(eventId,`${card.cardCode}-e`);
  expect((await base().collection('attemptPublic').doc(`${card.cardCode}-e`).get()).data().roundCode).toBe(card.cardCode);
});
test('ROUNDDELAY 開攤前四攤已入庫但 trigger 延遲也保留資格，作廢仍撤回',async()=>{
  await put(['a','b','c','d']);
  await updateChallengeDayFor({eventId,challengeId:'e',date,open:true,expectedOpen:false,actorUid:'round-admin'});
  expect((await draw()).rows[0].entries).toBe(1);
  await next();
  await base().collection('attempts').doc(`${pid}-d`).update({voided:true});await refresh();
  expect((await draw()).rows).toHaveLength(0);
});
