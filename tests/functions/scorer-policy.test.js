import { jest } from '@jest/globals';
import { db } from '../../functions/admin.js';
import { rebuildBoardsFor } from '../../functions/pipeline.js';
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
