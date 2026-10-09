import { jest } from '@jest/globals';
import { db } from '../../functions/admin.js';
import { rebuildBoardsFor } from '../../functions/pipeline.js';
import { onTeamWritten } from '../../functions/index.js';
jest.setTimeout(30000);
const E='scorer-policy-test',base=()=>db().doc(`events/${E}`);
test('SCORER-POLICY disabled divisions remove existing scorer rows and preserve timeline/fairplay and other divisions',async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('demo Emulator required');
 await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,{method:'DELETE'});
 const b=db().batch();b.set(base(),{});
 for(const [id,enabled] of [['child',false],['adult',true]]){
  b.set(base().collection('divisions').doc(id),{stats:{scorers:enabled},withdrawalPolicy:'voidAll'});
  for(const side of ['h','a'])b.set(base().collection('teams').doc(id+side),{divisionId:id,status:'approved',name:side});
  b.set(base().collection('teams').doc(id+'h').collection('roster').doc(id+'p'),{displayName:'測試球員',jerseyNo:7});
  const m=base().collection('matches').doc(id+'m');
  b.set(m,{divisionId:id,status:'confirmed',home:{teamId:id+'h'},away:{teamId:id+'a'},score:{home:1,away:0}});
  b.set(m.collection('timeline').doc('g'),{type:'goal',playerId:id+'p',teamId:id+'h',periodId:'h1',clockSec:60});
 }
 b.set(base().collection('boards').doc('scorers'),{rows:[{divisionId:'child',teamId:'childh',playerId:'childp',goals:9}]});await b.commit();
 const adult=await rebuildBoardsFor({eventId:E,divisionId:'adult'});expect(adult.scorers).toBe(1);
 const result=await rebuildBoardsFor({eventId:E,divisionId:'child'});expect(result.scorers).toBe(0);expect(result.fairPlay).toBe(2);
 const rows=(await base().collection('boards').doc('scorers').get()).data().rows;expect(rows.map(r=>r.divisionId)).toEqual(['adult']);expect(rows[0].goals).toBe(1);
 expect((await base().collection('matches').doc('childm').collection('timeline').doc('g').get()).data().type).toBe('goal');
});

test('SCORER-TEAM excluded team in an enabled division stays off both new and retained rows; goals, scores and fairplay survive', async () => {
 if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('demo Emulator required');
 await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,{method:'DELETE'});
 const team = base().collection('teams').doc('youth');
 const before = {divisionId:'women',status:'approved',name:'U12',display:{scorerBoard:true}};
 const after = {...before,display:{scorerBoard:false}};
 const match = base().collection('matches').doc('m');
 const matchData = {divisionId:'women',status:'confirmed',home:{teamId:'youth'},away:{teamId:'adult'},score:{home:21,away:1}};
 const b = db().batch();
 b.set(base(),{});
 for(const id of ['women','other'])b.set(base().collection('divisions').doc(id),{stats:{scorers:true},withdrawalPolicy:'voidAll'});
 b.set(team,after);
 b.set(base().collection('teams').doc('adult'),{divisionId:'women',status:'approved',name:'Adult'});
 b.set(base().collection('teams').doc('other'),{divisionId:'other',status:'approved',name:'Other'});
 b.set(match,matchData);
 for(let i=0;i<21;i++) {
  b.set(team.collection('roster').doc('p'+i),{displayName:'U12 '+i,jerseyNo:i});
  b.set(match.collection('timeline').doc('g'+i),{type:'goal',teamId:'youth',playerId:'p'+i,periodId:'h1',clockSec:i});
 }
 b.set(base().collection('teams').doc('adult').collection('roster').doc('adultp'),{displayName:'Adult',jerseyNo:7});
 b.set(match.collection('timeline').doc('adultg'),{type:'goal',teamId:'adult',playerId:'adultp',periodId:'h1',clockSec:60});
 b.set(match.collection('timeline').doc('card'),{type:'card',cardType:'yellow',teamId:'youth',playerId:'p0',periodId:'h1',clockSec:65});
 b.set(base().collection('boards').doc('scorers'),{rows:[{divisionId:'women',teamId:'youth',playerId:'p0',goals:9},{divisionId:'other',teamId:'other',playerId:'otherp',goals:2}]});
 b.set(base().collection('boards').doc('fairplay'),{rows:[{divisionId:'women',teamId:'youth',yellow:1}]});
 await b.commit();
 const timelineBefore = (await match.collection('timeline').get()).docs.map(d=>({id:d.id,...d.data()}));
 // 另一組重建也必須清掉停用隊伍的歷史榜列，但保留該隊紅黃牌。
 await rebuildBoardsFor({eventId:E,divisionId:'other'});
 expect((await base().collection('boards').doc('scorers').get()).data().rows).toEqual([]);
 expect((await base().collection('boards').doc('fairplay').get()).data().rows).toEqual([{divisionId:'women',teamId:'youth',yellow:1}]);
 const result=await rebuildBoardsFor({eventId:E,divisionId:'women'});
 expect(result).toEqual({scorers:1,fairPlay:2});
 const rows=async()=> (await base().collection('boards').doc('scorers').get()).data().rows;
 expect(await rows()).toEqual([expect.objectContaining({teamId:'adult',playerId:'adultp',goals:1,rank:1})]);
 expect((await base().collection('boards').doc('fairplay').get()).data().rows).toContainEqual(expect.objectContaining({teamId:'youth',yellow:1}));
 expect((await match.get()).data()).toEqual(matchData);
 expect((await match.collection('timeline').get()).docs.map(d=>({id:d.id,...d.data()}))).toEqual(timelineBefore);
 // 設定切換觸發重算，重新開放後恢復，再停用後立即排除。
 await team.set(before);
 await onTeamWritten.run({params:{eventId:E,teamId:'youth'},data:{before:{data:()=>after},after:{data:()=>before}}});
 expect((await rows()).some(r=>r.teamId==='youth')).toBe(true);
 await team.set(after);
 await onTeamWritten.run({params:{eventId:E,teamId:'youth'},data:{before:{data:()=>before},after:{data:()=>after}}});
 expect(await rows()).toEqual([expect.objectContaining({teamId:'adult',goals:1,rank:1})]);
});
