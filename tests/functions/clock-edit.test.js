import { jest } from '@jest/globals';
import { db } from '../../functions/admin.js';
import { editMatchClockFor } from '../../functions/clock-edit.js';
import { clockEditBasis } from '../../js/engine/match-clock.js';
jest.setTimeout(30000);
const E='clock-edit-test',base=()=>db().doc(`events/${E}`),mr=()=>base().collection('matches').doc('m');
const match={matchId:'m',divisionId:'d',venueId:'v',status:'live',period:'h1',lock:{locked:false},managementRevision:0,
 score:{home:2,away:1},clock:{running:true,periodStartedAt:new Date(10000),elapsedSecAtPause:60,addedTimeSec:0}};
async function request({uid='scorer',context='live',operationId='clock-1',seconds=1650}={}){
 return {auth:uid?{uid}:null,data:{eventId:E,matchId:'m',operationId,context,seconds,reason:'核對裁判時間',expected:clockEditBasis((await mr().get()).data())}};
}
beforeEach(async()=>{
 if(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.GCLOUD_PROJECT?.startsWith('demo-'))throw Error('demo Emulator required');
 const resp=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${process.env.GCLOUD_PROJECT}/databases/(default)/documents`,{method:'DELETE'});if(!resp.ok)throw Error('reset failed');
 const b=db().batch();b.set(base(),{});b.set(mr(),match);b.set(base().collection('divisions').doc('d'),{periods:1,matchDurationMin:25});
 b.set(mr().collection('timeline').doc('goal'),{type:'goal',clockSec:123});
 for(const [uid,roles,active,venueIds] of [['scorer',['scorer'],true,['v']],['admin',['admin'],true,[]],['other',['scorer'],true,['wrong']],['inactive',['admin'],false,[]],['booth',['booth'],true,[]]])b.set(db().doc(`staff/${uid}`),{roles,active,assignment:{venueIds}});
 await b.commit();
});
afterEach(()=>jest.restoreAllMocks());
test('CLOCK-ATOMIC correction calculates exact added time and replay has only one audit',async()=>{
 const req=await request(),res=await editMatchClockFor(req);
 expect(res).toMatchObject({seconds:1650,addedTimeSec:150,managementRevision:1});
 expect((await mr().get()).data()).toMatchObject({score:match.score,status:'live',clock:{running:true,elapsedSecAtPause:1650,addedTimeSec:150}});
 expect((await mr().collection('timeline').doc('goal').get()).data()).toEqual({type:'goal',clockSec:123});
 expect(await editMatchClockFor(req)).toEqual(res);expect((await base().collection('audits').get()).size).toBe(1);
});
test('CLOCK-AUTH current authority and assigned venue; locked match requires admin context',async()=>{
 for(const uid of ['other','inactive','booth'])await expect(editMatchClockFor(await request({uid}))).rejects.toMatchObject({code:'permission-denied'});
 await expect(editMatchClockFor(await request({uid:null}))).rejects.toMatchObject({code:'unauthenticated'});
 await mr().update({status:'confirmed',period:'ft',lock:{locked:true}});
 await expect(editMatchClockFor(await request())).rejects.toMatchObject({code:'failed-precondition'});
 const res=await editMatchClockFor(await request({uid:'admin',context:'admin'}));expect(res.addedTimeSec).toBe(150);
 expect((await mr().get()).data()).toMatchObject({status:'confirmed',lock:{locked:true},score:match.score,clock:{running:false,periodStartedAt:null,elapsedSecAtPause:1650}});
});
test('CLOCK-STALE pause or another correction prevents overwriting newer clock',async()=>{
 const req=await request();await mr().update({'clock.running':false});
 await expect(editMatchClockFor(req)).rejects.toMatchObject({code:'aborted'});
 expect((await base().collection('audits').get()).size).toBe(0);
});
test('CLOCK-ROLLBACK failed audit leaves time and receipt unchanged',async()=>{
 const req=await request(),before=(await mr().get()).data(),run=db().runTransaction.bind(db());
 jest.spyOn(db(),'runTransaction').mockImplementation(cb=>run(async tx=>{const create=tx.create.bind(tx);tx.create=(ref,doc)=>{if(ref.path.includes('/audits/'))throw Error('audit fault');return create(ref,doc);};return cb(tx);}));
 await expect(editMatchClockFor(req)).rejects.toThrow('audit fault');expect((await mr().get()).data()).toEqual(before);
 expect((await base().collection('managementOperations').doc('clock-1').get()).exists).toBe(false);
});
test('CLOCK-VALIDATION server rejects empty reason and invalid time',async()=>{
 const req=await request();for(const change of [{reason:''},{seconds:-1},{seconds:1.5},{seconds:86401}])await expect(editMatchClockFor({...req,data:{...req.data,...change}})).rejects.toMatchObject({code:'invalid-argument'});
});
