import { roundProgress, allRoundDays, storedRounds } from '../../js/engine/challenge-rounds.js';
const date='2026-10-09',pid='FEDA-0182',code='FEDA-9998',ms=Date.parse(`${date}T12:00:00+08:00`);
const cs=['a','b','c','d','e'].map((challengeId,order)=>({challengeId,order,minValue:0,maxValue:5,inputMode:'stepper',dailyOpen:{[date]:challengeId!=='e'}}));
const records=(ids,roundCode=pid)=>ids.map(challengeId=>({challengeId,playerId:pid,roundCode,rawValue:0,recordedAtMs:ms,createdAt:ms}));
const progress=(over={})=>roundProgress({playerId:pid,attempts:records(['a','b','c','d']),challenges:cs,date,nowMs:ms,...over});
const open=()=>cs.map(c=>({...c,dailyOpen:{[date]:true}}));
test('ROUNDKEEP 四攤集滿鎖定必要清單，重開第五攤不撤資格；作廢仍撤銷',()=>{
  const player={challengeRounds:{[date]:storedRounds(progress().rounds)}};
  expect(progress({player,challenges:open()}).rounds[0]).toMatchObject({entries:1,total:4});
  expect(progress({player,challenges:open(),attempts:records(['a','b','c','d']).map(a=>({...a,voided:a.challengeId==='d'}))}).entries).toBe(0);
});
test('ROUNDNEW 新輪不能沿用上一輪成績，重新開攤的新集點只進第二輪',()=>{
  const player={challengeRounds:{[date]:[...storedRounds(progress().rounds),{number:2,code,startedAtMs:ms+1}]}};
  const p=progress({player,challenges:open(),attempts:[...records(['a','b','c','d']),...records(['e'],code)]});
  expect(p.rounds[0]).toMatchObject({entries:1,total:4,done:['a','b','c','d']});
  expect(p.rounds[1]).toMatchObject({entries:0,total:5,done:['e']});
  expect(progress({player,challenges:open(),attempts:[...records(['a','b','c','d']),...records(['a','b','c','d','e'],code)]}).entries).toBe(2);
});
test('ROUNDHISTORY 即使成績觸發器延遲，設定改變前已入庫的集滿仍保留',()=>{
  expect(progress({challenges:open(),history:[{date,required:['a','b','c','d'],cutoffMs:ms+1}]}).rounds[0]).toMatchObject({entries:1,total:4});
  expect(progress({challenges:open(),history:[{date,required:['a','b','c','d'],cutoffMs:ms-1}]}).entries).toBe(0);
});
test('ROUNDLEGACY 已確認舊資格保留原必要清單，未註冊新碼與重複登錄不加券',()=>{
  expect(progress({challenges:open(),player:{challengeDays:{[date]:{entries:1,requiredChallengeIds:['a','b','c','d']}}}}).entries).toBe(1);
  expect(progress({attempts:[...records(['a','b','c','d']),...records(['a','b','c','d'],code)]}).entries).toBe(1);
});
test('ROUNDDATE 多輪每日分開結算且持久欄位沒有 SDK 成績或 undefined',()=>{
  const p=allRoundDays({playerId:pid,attempts:records(['a','b','c','d']),challenges:cs,rewards:{dates:[date,'2026-10-10'],timeZone:'Asia/Taipei'},nowMs:ms});
  expect(p.challengeDays[date].entries).toBe(1);expect(p.challengeDays['2026-10-10'].entries).toBe(0);
  expect(JSON.stringify(p)).not.toMatch(/bests|undefined|staffUid/);
});
