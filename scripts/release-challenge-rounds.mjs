#!/usr/bin/env node
/** Enable rounds while preserving all existing raw attempts and canonical identities. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {ROUND_VERSION} from '../js/engine/challenge-rounds.js';
const args=process.argv.slice(2),get=k=>args[args.indexOf(k)+1],project=get('--project'),apply=args.includes('--apply');
if(!['feda-cup-demo','feda-cup-2026'].includes(project)||process.env.FIRESTORE_EMULATOR_HOST||(!apply&&!args.includes('--dry-run')))throw Error('PROJECT_MODE_GUARD');
process.env.GCLOUD_PROJECT=project;
const {db}=await import('../functions/admin.js'),{calculateRoundPlayer}=await import('../functions/challenge-rounds.js');
const eventId='feda-cup-2026',base=db().doc('events/'+eventId),head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(apply&&(get('--expected-head')!==head||execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()))throw Error('CLEAN_VERIFIED_SOURCE_REQUIRED');
const rewardRef=db().doc('config/challengeRewards'),r=await rewardRef.get();if(r.data()?.rule!=='dailyChallengesCompleted')throw Error('DAILY_RULE_REQUIRED');
const [players,challenges]=await Promise.all([base.collection('players').get(),base.collection('challenges').get()]);
const rewards={...r.data(),roundsEnabled:true,nextCardEnabled:true,version:ROUND_VERSION};delete rewards.maxEntriesPerPlayerPerDay;
const canonical=players.docs.filter(d=>!d.data().roundAliasOf),changes=[];
for(const p of canonical){const patch=await db().runTransaction(tx=>calculateRoundPlayer(tx,eventId,p.id,p.data(),challenges.docs.map(d=>({...d.data(),challengeId:d.id})),rewards));changes.push({id:p.id,before:p.data(),patch});}
const digest=async()=>{const out={};for(const name of ['attempts','playerContacts','challenges']){const snap=await base.collection(name).get();out[name]=snap.docs.map(d=>[d.id,d.data()]);}const users=await db().collection('users').where('gamePassId','!=',null).get();out.bindings=users.docs.map(d=>[d.id,d.data().gamePassId]);return createHash('sha256').update(JSON.stringify(out)).digest('hex');};
const beforeDigest=await digest(),backup=get('--backup');if(!backup||!backup.replaceAll('\\','/').startsWith('tools/'))throw Error('IGNORED_BACKUP_PATH_REQUIRED');
fs.writeFileSync(backup,JSON.stringify({project,eventId,head,rewardsBefore:r.data(),changes,beforeDigest},null,2));
if(apply){await db().runTransaction(async tx=>{const current=await tx.get(rewardRef);if(JSON.stringify(current.data())!==JSON.stringify(r.data()))throw Error('CONFIG_CHANGED_RETRY');tx.set(rewardRef,rewards);});for(const p of canonical)await db().runTransaction(async tx=>{const [current,liveChallenges,liveRewards]=await Promise.all([tx.get(p.ref),tx.get(base.collection('challenges')),tx.get(rewardRef)]);const patch=await calculateRoundPlayer(tx,eventId,p.id,current.data(),liveChallenges.docs.map(d=>({...d.data(),challengeId:d.id})),liveRewards.data());tx.update(p.ref,{...patch,luckyDrawRuleVersion:ROUND_VERSION});});}
if(await digest()!==beforeDigest)throw Error('SOURCE_DATA_CHANGED_CHECK_BACKUP');
console.log(JSON.stringify({project,head,applied:apply,players:canonical.length,aliases:players.size-canonical.length,roundVersion:ROUND_VERSION,sourceDataUnchanged:true,entriesBefore:canonical.reduce((n,p)=>n+(p.data().luckyDrawEntries??0),0),entriesAfter:changes.reduce((n,p)=>n+p.patch.luckyDrawEntries,0)}));
