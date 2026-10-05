#!/usr/bin/env node
/** 主辦代辦：讀取資料檔，用後台原子重產／發布流程提交；預設唯讀。 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FORMATS } from '../js/engine/formats.js';
import { createManualDraft, manualPayloadOf, getManualFindings } from '../js/engine/manual-schedule.js';
import { taipeiMs } from '../js/engine/schedule.js';
const env = process.argv.find(a => a.startsWith('--env='))?.slice(6);
const input = process.argv.find(a => a.startsWith('--input='))?.slice(8);
if (!['demo','prod'].includes(env) || !input) throw Error('請指定 --env=demo|prod 及 --input=資料檔.json');
if (process.env.FIRESTORE_EMULATOR_HOST) throw Error('雲端安排不可指定模擬器');
const plan = JSON.parse(await readFile(input,'utf8')), format = FORMATS[plan.formatId];
if (!format || !plan.eventId || !Array.isArray(plan.targets) || !plan.targets.length) throw Error('安排資料不完整');
if (new Set(plan.targets.map(t => t.divisionId)).size !== plan.targets.length) throw Error('組別重複');
process.env.GCLOUD_PROJECT = env === 'prod' ? 'feda-cup-2026' : 'feda-cup-demo';
const { db } = await import('../functions/admin.js');
const { generateScheduleFor, scheduleHasStarted } = await import('../functions/schedule.js');
const { publishManualScheduleFor } = await import('../functions/manual-schedule.js');
const database = db(), base = database.doc(`events/${plan.eventId}`);
const teamRows = snap => snap.docs.map(d => ({...d.data(),teamId:d.id}));
const matchRows = snap => snap.docs.map(d => ({...d.data(),matchId:d.id}));
const [divSnap,teamSnap,matchSnap,venueSnap,configSnap,scheduleSnap,admins] = await Promise.all([
  base.collection('divisions').get(),base.collection('teams').get(),base.collection('matches').get(),
  base.collection('venues').get(),database.doc('config/formats').get(),database.doc('config/schedule').get(),
  database.collection('staff').where('roles','array-contains','super_admin').get()
]);
const actor = admins.docs.find(d => d.data().active === true);
if (!actor) throw Error('找不到啟用的總管');
const divisions = divSnap.docs.map(d => ({...d.data(),divisionId:d.id}));
const teams = teamRows(teamSnap), matches = matchRows(matchSnap);
const venues = venueSnap.docs.map(d => ({...d.data(),venueId:d.id}));
function orderedIds(target) {
  const [a,b] = [target.groups?.A,target.groups?.B];
  if (a?.length !== 4 || b?.length !== 4 || new Set([...a,...b]).size !== 8) throw Error('兩組必須各四支不同球隊');
  return [a[0],b[0],b[1],a[1],a[2],b[2],b[3],a[3]];
}
function fillDraft(draft,target,division) {
  if (target.rows?.length !== draft.matches.length) throw Error('提供的安排與場次數不一致');
  const used = new Set();
  for (const row of target.rows) {
    const m = row.matchKey ? draft.matches.find(m => m.matchKey === row.matchKey)
      : draft.matches.find(m => m.isRoundRobin && m.groupId === row.groupId
        && [m.home?.teamId,m.away?.teamId].includes(row.homeTeamId)
        && [m.home?.teamId,m.away?.teamId].includes(row.awayTeamId));
    if (!m || used.has(m.matchId)) throw Error('提供的安排有缺漏或重複對戰');
    used.add(m.matchId); m.kickoffAt = taipeiMs(division.date,row.time); m.venueId = row.venueId;
    if (m.isRoundRobin) {m.homeTeamId=row.homeTeamId; m.awayTeamId=row.awayTeamId;}
  }
  return draft;
}
for (const target of plan.targets) {
  const division = divisions.find(d => d.divisionId === target.divisionId);
  if (!division || matches.some(m => m.divisionId === target.divisionId && scheduleHasStarted(m))) throw Error('組別不存在或已開打');
  const ids = orderedIds(target);
  const approved = teams.filter(t => t.divisionId === target.divisionId && t.status === 'approved' && !t.withdrawn).map(t => t.teamId);
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(approved.sort())) throw Error('安排球隊與核准名單不一致');
  const next = {...division,formatId:format.formatId,groupNames:plan.groupNames};
  const draft = fillDraft(createManualDraft({division:next,teams,format,orderedTeamIds:ids}),target,next);
  const findings = getManualFindings({draft,division:next,teams,venues,
    allMatches:matches.filter(m => !plan.targets.some(t => t.divisionId === m.divisionId)),divisions,cfg:scheduleSnap.data()});
  const errors = findings.filter(f => f.level === 'error');
  if (errors.length) throw Error(errors.map(f => f.message).join('\n'));
  console.log(JSON.stringify({divisionId:target.divisionId,matches:draft.matches.length,groups:target.groups,
    warnings:findings.filter(f => f.level === 'warn').map(f => f.message)}));
}
if (!process.argv.includes('--apply')) {console.log('唯讀核對完成；加 --apply 才會備份並提交'); process.exit(0);}
const stamp = new Date().toISOString().replace(/[:.]/g,'-'), targets = new Set(plan.targets.map(t => t.divisionId));
const directory = resolve('tools','backups'); await mkdir(directory,{recursive:true});
const backup = resolve(directory,`schedule-plan-${env}-${stamp}.json`);
await writeFile(backup,JSON.stringify({plan,formats:configSnap.data(),
  divisions:divSnap.docs.map(d => ({path:d.ref.path,data:d.data()})),
  teams:teams.filter(t => targets.has(t.divisionId)),matches:matches.filter(m => targets.has(m.divisionId))},null,2),{flag:'wx'});
await database.runTransaction(async tx => {
  const current = await tx.get(base.collection('divisions')), currentMatches = await tx.get(base.collection('matches'));
  const formats = await tx.get(configSnap.ref);
  for (const d of current.docs) {
    const prior = divisions.find(p => p.divisionId === d.id);
    if (!prior || (d.data().scheduleRevision ?? 0) !== (prior.scheduleRevision ?? 0)) throw Error('賽程版本已變更，請重新盤點');
  }
  if (currentMatches.docs.some(d => targets.has(d.data().divisionId) && scheduleHasStarted(d.data()))) throw Error('場次已開打');
  tx.set(configSnap.ref,{formats:{...formats.data()?.formats,[format.formatId]:format}},{merge:true});
  for (const d of current.docs) {
    const patch = {requiredFormatId:format.formatId,groupNames:plan.groupNames,updatedAt:new Date(),updatedBy:actor.id};
    if (!targets.has(d.id) && !currentMatches.docs.some(m => m.data().divisionId === d.id)) patch.formatId=format.formatId;
    tx.update(d.ref,patch);
  }
  tx.create(base.collection('audits').doc(),{entity:'divisions',entityId:'all',action:'schedule.formatUnify',
    actor:{uid:actor.id,name:actor.data().name ?? null,source:'maintenance'},
    before:Object.fromEntries(current.docs.map(d => [d.id,{formatId:d.data().formatId,
      requiredFormatId:d.data().requiredFormatId ?? null,groupNames:d.data().groupNames ?? null}])),
    after:{requiredFormatId:format.formatId,groupNames:plan.groupNames},reason:plan.reason,createdAt:new Date()});
});
for (const target of plan.targets) {
  const ref=base.collection('divisions').doc(target.divisionId), division=(await ref.get()).data();
  const generated=await generateScheduleFor({auth:{uid:actor.id},data:{eventId:plan.eventId,divisionId:target.divisionId,
    operationId:`plan-generate-${target.divisionId}-${stamp}`,expectedRevision:division.scheduleRevision ?? 0,
    orderedTeamIds:orderedIds(target),formatId:format.formatId,drawSeed:null}});
  const currentDivision={...(await ref.get()).data(),divisionId:target.divisionId};
  const currentTeams=teamRows(await base.collection('teams').get());
  const currentMatches=matchRows(await base.collection('matches').where('divisionId','==',target.divisionId).get());
  const draft=fillDraft(createManualDraft({division:currentDivision,teams:currentTeams,format,existingMatches:currentMatches}),target,currentDivision);
  const published=await publishManualScheduleFor({auth:{uid:actor.id},data:{eventId:plan.eventId,
    operationId:`plan-publish-${target.divisionId}-${stamp}`,draft:manualPayloadOf(draft),reason:plan.reason}});
  console.log(JSON.stringify({backup,generated,published},null,2));
}

