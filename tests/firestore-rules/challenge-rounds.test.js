import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { makeEnv, seedBaseline, authed, EVENT, CHALLENGE } from './helpers.js';
import { activityDate, dailyRewardSettings } from '../../js/engine/challenge-days.js';
let env;const ms=Date.now(),date=activityDate(ms),pid='FEDA-0182',code='FEDA-9998';
beforeAll(async()=>{env=await makeEnv();});afterAll(async()=>{await env.cleanup();});
beforeEach(async()=>{await env.clearFirestore();await seedBaseline(env);await env.withSecurityRulesDisabled(async ctx=>{
  const d=ctx.firestore();await setDoc(doc(d,'config','challengeRewards'),{...dailyRewardSettings([date]),roundsEnabled:true});
  await updateDoc(doc(d,'events',EVENT,'challenges',CHALLENGE),{dailyOpen:{[date]:true}});
  await setDoc(doc(d,'events',EVENT,'players',pid),{playerId:pid,challengeRounds:{[date]:[{number:1,code:pid,entries:1},{number:2,code,entries:0}]}});
  await setDoc(doc(d,'events',EVENT,'players',code),{playerId:code,roundAliasOf:pid,roundDate:date});
});});
const submit=(id,over={})=>setDoc(doc(authed(env,'u-booth'),'events',EVENT,'attempts',id),{attemptId:id,eventId:EVENT,
  playerId:pid,challengeId:CHALLENGE,rawValue:0,roundCode:code,staffUid:'u-booth',isBest:false,voided:false,
  createdAt:serverTimestamp(),recordedAtMs:ms,activityDate:date,...over});
test('ROUNDRULE 最新輪有效碼可入庫，舊碼／漏碼／偽造碼／alias當人物皆拒絕',async()=>{
  await assertSucceeds(submit('current'));
  await assertFails(submit('old',{roundCode:pid}));await assertFails(submit('missing',{roundCode:null}));
  await assertFails(submit('forged',{roundCode:'FEDA-8888'}));await assertFails(submit('alias',{playerId:code}));
});
test('ROUNDFORGE 一般用戶不能自行增加輪次、資格或建立碼號',async()=>{
  const d=authed(env,'u-player');await assertFails(updateDoc(doc(d,'events',EVENT,'players',pid),{challengeRounds:{[date]:[{number:3,code:'FEDA-8888',entries:1}]}}));
  await assertFails(setDoc(doc(d,'events',EVENT,'players','FEDA-8888'),{roundAliasOf:pid}));
});
