/** 草稿一次發布：權威重讀、完整賽制與跨組衝突檢查、版本、收據及稽核同一交易。 */
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, evRef, adminActor, writeAudit } from './store.js';
import { createManualDraft, getManualFindings } from './engine/manual-schedule.js';
import { genericFormat, assignMatchNos, kickoffMsOf, teamRefOf } from './engine/schedule.js';
import { planGeneration, matchDocOf } from './engine/schedule-doc.js';
import { buildStanding, standingIdOf } from './engine/standing.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const idOK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const rows=snap=>snap.docs.map(d=>({...d.data(),matchId:d.id}));

export async function publishManualScheduleFor(request) {
  const uid=request.auth?.uid;if(!uid)fail('unauthenticated','請先登入');
  const {eventId,operationId,draft,reason}=request.data??{};
  if(!idOK(eventId)||!idOK(operationId)||!draft||draft.schemaVersion!==1||!['create','edit'].includes(draft.mode)
    ||!idOK(draft.divisionId)||!idOK(draft.formatId)||!Number.isInteger(draft.expectedRevision)||draft.expectedRevision<0
    ||typeof draft.generated!=='boolean'||(draft.groupCount!=null&&![1,2].includes(draft.groupCount))
    ||!Array.isArray(draft.orderedTeamIds)||draft.orderedTeamIds.length<2||draft.orderedTeamIds.length>64
    ||draft.orderedTeamIds.some(id=>!idOK(id))||new Set(draft.orderedTeamIds).size!==draft.orderedTeamIds.length
    ||typeof draft.sourceBasis!=='string'||draft.sourceBasis.length>500000
    ||!Array.isArray(draft.matches)||!draft.matches.length||draft.matches.length>150
    ||typeof reason!=='string'||!reason.trim()||[...reason.trim()].length>200)
    fail('invalid-argument','手動賽程指令不完整或不正確');
  const entryKeys=['matchId','homeTeamId','awayTeamId','kickoffAt','venueId'];
  if(draft.matches.some(m=>!m||Object.keys(m).some(k=>!entryKeys.includes(k))||!idOK(m.matchId)
    ||[m.homeTeamId,m.awayTeamId].some(id=>id!==null&&!idOK(id))||!Number.isSafeInteger(m.kickoffAt)||!idOK(m.venueId)))
    fail('invalid-argument','每一場都必須有完整的隊伍、開賽時間與場地資料');
  const base=evRef(eventId),divRef=base.collection('divisions').doc(draft.divisionId);
  const receiptRef=base.collection('manualScheduleOperations').doc(operationId),auditRef=base.collection('audits').doc();
  const requestHash=hash(request.data);
  return db().runTransaction(async tx=>{
    const actor=await adminActor(tx,uid),receipt=await tx.get(receiptRef);
    if(receipt.exists){if(receipt.data().actorUid!==uid||receipt.data().requestHash!==requestHash)fail('already-exists','操作代碼已被不同請求使用');return receipt.data().result;}
    const [eventSnap,divSnap,formatsSnap,rulesSnap,cfgSnap,teamsSnap,matchesSnap,venuesSnap,divisionsSnap]=await Promise.all([
      tx.get(base),tx.get(divRef),tx.get(db().doc('config/formats')),tx.get(db().doc('config/rankingRules')),tx.get(db().doc('config/schedule')),
      tx.get(base.collection('teams').where('divisionId','==',draft.divisionId)),tx.get(base.collection('matches')),
      tx.get(base.collection('venues')),tx.get(base.collection('divisions'))
    ]);
    if(!eventSnap.exists||!divSnap.exists)fail('not-found','賽事或組別不存在');
    const division={...divSnap.data(),divisionId:divSnap.id};
    if((division.scheduleRevision??0)!==draft.expectedRevision)fail('aborted','賽程已更新，請重新載入並建立新版草稿');
    const teams=teamsSnap.docs.map(d=>({...d.data(),teamId:d.id})),approved=teams.filter(t=>t.status==='approved'&&t.withdrawn!==true);
    if(canonical(approved.map(t=>t.teamId).sort())!==canonical([...draft.orderedTeamIds].sort()))fail('aborted','核准或退賽名單已變更，請重新載入');
    const all=rows(matchesSnap),old=all.filter(m=>m.divisionId===division.divisionId),isCreate=old.length===0;
    if(isCreate&&division.requiredFormatId&&(draft.generated||draft.formatId!==division.requiredFormatId))
      fail('failed-precondition','此組別已指定統一賽制，不能切換為其他範本');
    if((draft.mode==='create')!==isCreate)fail('aborted','場次清單已變更，請重新載入');
    if(!cfgSnap.exists||!Array.isArray(eventSnap.data().dates)||!eventSnap.data().dates.includes(division.date))fail('failed-precondition','缺少排程設定或有效的組別比賽日期');
    const rule=rulesSnap.data()?.rules?.[division.rankingRuleId];if(!rule)fail('failed-precondition','缺少此組別排名規則');
    let format;
    try{format=draft.generated?genericFormat(approved.length,{groupCount:draft.groupCount??undefined}):formatsSnap.data()?.formats?.[draft.formatId];}
    catch{fail('invalid-argument','通用賽制設定不正確');}
    if(!format||format.formatId!==draft.formatId||(!isCreate&&division.formatId!==draft.formatId))fail('failed-precondition','賽制範本已變更，請重新載入');
    let authoritative;
    try{authoritative=createManualDraft({division,teams,format,existingMatches:old,generated:draft.generated,groupCount:draft.groupCount,
      orderedTeamIds:isCreate?draft.orderedTeamIds:null});}catch(err){fail('failed-precondition',err.message);}
    if(authoritative.sourceBasis!==draft.sourceBasis||(!isCreate&&canonical(authoritative.orderedTeamIds)!==canonical(draft.orderedTeamIds)))
      fail('aborted','球隊分組、賽制或場次已更新，請重新載入');
    const ids=new Set(draft.matches.map(m=>m.matchId));
    if(ids.size!==draft.matches.length||ids.size!==authoritative.matches.length||authoritative.matches.some(m=>!ids.has(m.matchId)))
      fail('invalid-argument','發布必須包含完整且不重複的場次清單');
    const supplied=Object.fromEntries(draft.matches.map(m=>[m.matchId,m]));
    authoritative.matches=authoritative.matches.map(m=>({...m,...supplied[m.matchId]}));
    const venues=venuesSnap.docs.map(d=>({...d.data(),venueId:d.id})),divisions=divisionsSnap.docs.map(d=>({...d.data(),divisionId:d.id}));
    const findings=getManualFindings({draft:authoritative,division,teams,venues,allMatches:all,divisions,cfg:cfgSnap.data()});
    const errors=findings.filter(f=>f.level==='error');if(errors.length)fail('failed-precondition',errors[0].message);
    const changedPairs=authoritative.matches.filter(m=>m.isRoundRobin&&(m.homeTeamId!==m.baseline.homeTeamId||m.awayTeamId!==m.baseline.awayTeamId));
    const changedIds=new Set(changedPairs.map(m=>m.matchId));
    // 比分事件不因手動換隊被黏到另一場；尚未開打的舊出場名單則失效並完整封存在稽核。
    const [checkinsSnap,sheetsSnap,timelines,stageSnap,standingSnap,groupsSnap]=await Promise.all([
      tx.get(base.collection('checkins')),tx.get(base.collection('matchSheets')),
      isCreate?Promise.resolve([]):Promise.all(changedPairs.map(m=>tx.get(base.collection('matches').doc(m.matchId).collection('timeline')))),
      isCreate?tx.get(divRef.collection('stages')):Promise.resolve(null),
      isCreate?tx.get(base.collection('standings').where('divisionId','==',division.divisionId)):Promise.resolve(null),
      isCreate?tx.get(db().collectionGroup('groups')):Promise.resolve(null)
    ]);
    if(timelines.some(s=>!s.empty))fail('failed-precondition','要更換對戰的場次已有事件紀錄，不能改變球隊');
    const stamp=FieldValue.serverTimestamp(),writes=[],deletes=[],oldById=Object.fromEntries(old.map(m=>[m.matchId,m]));
    const put=(ref,doc,update=false)=>writes.push({ref,doc,update});
    const generationId=isCreate?hash({divisionId:division.divisionId,operationId}).slice(0,20):division.scheduleGenerationId??null;
    const newIds={};
    if(isCreate){
      const plan=planGeneration({division,orderedTeams:draft.orderedTeamIds.map(id=>approved.find(t=>t.teamId===id)),format});
      deletes.push(...stageSnap.docs,...standingSnap.docs,...groupsSnap.docs.filter(d=>d.ref.path.startsWith(`${divRef.path}/stages/`)));
      if(draft.generated)put(db().doc('config/formats'),{[`formats.${format.formatId}`]:format},true);
      for(const st of plan.stages)put(divRef.collection('stages').doc(st.stageId),{...st,generationId});
      for(const g of plan.groupDocs){
        put(divRef.collection('stages').doc(g.stageId).collection('groups').doc(g.groupId),{...g,generationId});
        put(base.collection('standings').doc(standingIdOf(division.divisionId,g.stageId,g.groupId)),{
          ...buildStanding({eventId,divisionId:division.divisionId,stageId:g.stageId,groupId:g.groupId,teamIds:g.teamIds,matches:[],rule,
            opts:{teamMeta:Object.fromEntries(g.teamIds.map(id=>[id,{name:approved.find(t=>t.teamId===id)?.shortName??approved.find(t=>t.teamId===id)?.name??null}]))}}),
          generationId,scheduleRevision:draft.expectedRevision+1,computedAt:stamp});
      }
      for(const a of plan.assignments)put(base.collection('teams').doc(a.teamId),{seed:a.seed,groupId:a.groupId,updatedAt:stamp,updatedBy:uid},true);
      for(const t of teams.filter(t=>!approved.includes(t)))put(base.collection('teams').doc(t.teamId),{seed:null,groupId:null,updatedAt:stamp,updatedBy:uid},true);
      for(const m of authoritative.matches)newIds[m.matchId]=`${m.matchId}__g-${generationId}`;
    }else{
      deletes.push(...checkinsSnap.docs.filter(d=>changedIds.has(d.data().matchId)),...sheetsSnap.docs.filter(d=>changedIds.has(d.data().matchId)));
    }
    const afterMatches=[];
    for(const m of authoritative.matches){
      const id=newIds[m.matchId]??m.matchId,ref=base.collection('matches').doc(id),previous=oldById[m.matchId];
      const home=m.isRoundRobin?teamRefOf(approved.find(t=>t.teamId===m.homeTeamId)):m.home;
      const away=m.isRoundRobin?teamRefOf(approved.find(t=>t.teamId===m.awayTeamId)):m.away;
      const slot={kickoffAt:Timestamp.fromMillis(m.kickoffAt),venueId:m.venueId,venueName:venues.find(v=>v.venueId===m.venueId).name};
      if(isCreate){
        const doc={...matchDocOf({m:{...m,matchId:id,home,away,teamIds:[m.homeTeamId,m.awayTeamId].filter(Boolean)},division,eventId}),
          ...slot,generationId,createdAt:stamp,updatedAt:stamp,updatedBy:uid};put(ref,doc);afterMatches.push(doc);
      }else{
        const p={};
        if(kickoffMsOf(previous)!==m.kickoffAt||previous.venueId!==m.venueId)Object.assign(p,slot);
        if(changedIds.has(m.matchId))Object.assign(p,{home,away,teamIds:[m.homeTeamId,m.awayTeamId],status:'scheduled',
          checkin:{homeConfirmed:false,awayConfirmed:false,confirmedAt:null}});
        if(Object.keys(p).length)put(ref,{...p,updatedAt:stamp,updatedBy:uid},true);
        afterMatches.push({...previous,...p});
      }
    }
    // 已存在的場次編號保持穩定，新場次依時間接續，紙本／連結不因發布被重編。
    const combined=[...all.filter(m=>m.divisionId!==division.divisionId),...afterMatches];
    for(const n of assignMatchNos(combined,{frozen:true})){
      if(!afterMatches.some(m=>m.matchId===n.matchId))continue;
      const existingWrite=writes.find(w=>w.ref.path===base.collection('matches').doc(n.matchId).path);
      if(existingWrite)existingWrite.doc.matchNo=n.matchNo;
      else put(base.collection('matches').doc(n.matchId),{matchNo:n.matchNo,updatedAt:stamp,updatedBy:uid},true);
      const m=afterMatches.find(m=>m.matchId===n.matchId);if(m)m.matchNo=n.matchNo;
    }
    const revision=draft.expectedRevision+1;
    const divPatch={scheduleRevision:revision,schedulePublished:true,updatedAt:stamp,updatedBy:uid,
      ...(isCreate?{formatId:format.formatId,scheduleGenerationId:generationId,draw:{seed:null,at:stamp,method:'manual'},
        finalRankingPublished:false,finalRankingStale:division.finalRanking!=null}:{})};put(divRef,divPatch,true);
    const result={divisionId:division.divisionId,scheduleRevision:revision,published:true,operationId,auditId:auditRef.id,matchCount:afterMatches.length};
    const audit={entity:'division',entityId:division.divisionId,action:'schedule.manualPublish',actor,reason:reason.trim(),
      before:{division:divSnap.data(),matches:Object.fromEntries(old.map(m=>[m.matchId,m])),deletedDocuments:Object.fromEntries(deletes.map(d=>[d.ref.path,d.data()]))},
      after:{result,division:{...divSnap.data(),...divPatch},writtenDocuments:Object.fromEntries(writes.map(w=>[w.ref.path,{doc:w.doc,update:w.update}]))}};
    const bytes=Buffer.byteLength(canonical(audit));
    if(writes.length+deletes.length+2>400||bytes>900*1024||bytes*2+(writes.length+deletes.length+2)*2048>8*1024*1024)
      fail('resource-exhausted','手動賽程超過單次原子發布容量，請由維運協助封存');
    for(const d of deletes)tx.delete(d.ref);
    for(const w of writes)w.update?tx.update(w.ref,w.doc):tx.set(w.ref,w.doc);
    writeAudit(eventId,audit,tx,auditRef);
    tx.create(receiptRef,{requestHash,actorUid:uid,result,createdAt:stamp});return result;
  });
}
