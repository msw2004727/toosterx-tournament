import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const arg=n=>process.argv.find(a=>a.startsWith(`--${n}=`))?.slice(n.length+3);
const project=arg('project'),apply=process.argv.includes('--apply'),file=arg('backup');
if(!['feda-cup-demo','feda-cup-2026'].includes(project)||!file||process.env.FIRESTORE_EMULATOR_HOST)throw Error('Explicit cloud project and private backup path required');
process.env.GCLOUD_PROJECT=project;
const {db}=await import('../functions/admin.js');const database=db();database.settings({preferRest:true});
const {syncPublicAttempt}=await import('../functions/challenge-integrity.js');
const {onAttemptSubmitted}=await import('../functions/pipeline.js');
const {writeAudit}=await import('../functions/store.js');
const {validAttemptValue}=await import('../functions/engine/challenge.js');
const {CHALLENGES}=await import('./seed/build.js');
const eventId='feda-cup-2026',base=database.doc(`events/${eventId}`),head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const collections=['challenges','players','attempts','playerContacts','leaderboards','attemptPublic'];
const snapshots=Object.fromEntries(await Promise.all(collections.map(async name=>[name,(await base.collection(name).get()).docs.map(d=>({id:d.id,data:d.data(),updateTime:d.updateTime.toDate().toISOString()}))])));
const users=(await database.collection('users').where('gamePassId','!=',null).get()).docs.map(d=>({id:d.id,data:d.data()}));
const rewards=(await database.doc('config/challengeRewards').get()).data();
const anomalies=snapshots.attempts.filter(({data:a})=>!snapshots.players.some(p=>p.id===a.playerId)||!validAttemptValue(a,snapshots.challenges.find(c=>c.id===a.challengeId)?.data)).map(a=>a.id);
if(!apply){fs.writeFileSync(file,JSON.stringify({project,eventId,head,at:new Date().toISOString(),snapshots,users,rewards,anomalies},null,2));
  console.log(JSON.stringify({project,head,counts:Object.fromEntries(collections.map(c=>[c,snapshots[c].length])),anomalies,changes:['公開成績白名單投影','頭球補至260cm','重新核對每日資格']}));
}else{
  const backup=JSON.parse(fs.readFileSync(file,'utf8'));
  if(backup.project!==project||backup.eventId!==eventId||backup.head!==head)throw Error('Backup/candidate mismatch');
  const c=CHALLENGES.find(c=>c.inputMode==='ladder'),ref=base.collection('challenges').doc(c.challengeId);
  await database.runTransaction(async tx=>{
    const old=(await tx.get(ref)).data();if(old?.minValue!==100||old.maxValue!==260||old.inputMode!=='ladder')throw Error('Unexpected header configuration');
    if(JSON.stringify(old.ladderSteps)===JSON.stringify(c.ladderSteps))return;
    tx.update(ref,{ladderSteps:c.ladderSteps});
    writeAudit(eventId,{action:'challenge.headerSteps.extend',entity:'challenge',entityId:c.challengeId,
      actor:{uid:'fn:challengeIntegrityRelease'},before:{ladderSteps:old.ladderSteps},after:{ladderSteps:c.ladderSteps},reason:'主辦確認最高260cm，補齊225至260cm級距',releaseHead:head},tx);
  });
  // Each projection transaction reads current raw data; preserve all actual attempt IDs and history.
  for(const a of (await base.collection('attempts').get()).docs)await syncPublicAttempt(eventId,a.id);
  const pairs=new Set((await base.collection('attempts').get()).docs.map(d=>{const a=d.data();return a.challengeId&&a.playerId?JSON.stringify([a.challengeId,a.playerId]):null;}).filter(Boolean));
  for(const pair of pairs){const [challengeId,playerId]=JSON.parse(pair);if(snapshots.challenges.some(c=>c.id===challengeId))await onAttemptSubmitted({eventId,challengeId,playerId});}
  const jobId=`release-${randomUUID()}`;
  await base.collection('challengeRefreshJobs').doc(jobId).create({challengeId:c.challengeId,date:rewards.dates[0],status:'queued',releaseHead:head});
  const result={project,head,projectionCount:(await base.collection('attemptPublic').get()).size,quarantined:anomalies,jobId};
  fs.writeFileSync(`${file}.applied.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
