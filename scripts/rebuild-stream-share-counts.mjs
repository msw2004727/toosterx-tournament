import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {streamShareSource} from '../js/engine/stream-share.js';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],project=get('--project'),apply=args.includes('--apply');
if(!['feda-cup-demo','feda-cup-2026'].includes(project)||process.env.FIRESTORE_EMULATOR_HOST||(!apply&&!args.includes('--dry-run')))throw Error('PROJECT_MODE_REQUIRED');
process.env.GCLOUD_PROJECT=project;
const {db}=await import('../functions/admin.js');
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(apply&&(get('--expected-head')!==head||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()))throw Error('CLEAN_VERIFIED_SOURCE_REQUIRED');
const backup=get('--backup');if(!backup?.replaceAll('\\','/').startsWith('tools/'))throw Error('IGNORED_BACKUP_REQUIRED');
const matches=await db().collection('events/feda-cup-2026/matches').get(),rows=[];
for(const match of matches.docs){
 rows.push(await db().runTransaction(async tx=>{
  const [current,shares]=await Promise.all([tx.get(match.ref),tx.get(match.ref.collection('streamShares'))]);
  if(!current.exists)return {matchId:match.id,removed:true};
  const before=current.data().sharedStreamCount??0,after=shares.docs.filter(d=>streamShareSource(d.data())).length;
  const changed=before!==after;
  const sourceDigest=createHash('sha256').update(JSON.stringify(shares.docs.map(d=>[d.id,d.data()]))).digest('hex');
  const row={matchId:match.id,before,after,changed,sourceDigest};
  if(apply&&changed){fs.writeFileSync(backup,JSON.stringify({project,head,rows:[...rows,row]},null,2));tx.update(match.ref,{sharedStreamCount:after});}
  return row;
 }));
}
fs.writeFileSync(backup,JSON.stringify({project,head,rows},null,2));
console.log(JSON.stringify({project,head,applied:apply,matches:rows.length,changed:rows.filter(r=>r.changed).length,sharedStreams:rows.reduce((n,r)=>n+(r.after??0),0),sourceCollectionsWritten:false}));
