/** 線上管理指令：重新驗權限／來源，業務結果、操作收據與稽核一起提交。 */
import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, evRef, adminActor, writeAudit } from './store.js';
import { buildConfirmPatch, buildReopenPatch, buildOverridePatch, buildWalkoverPatch, buildStatusPatch,
  canConfirm, canReopen, canOverride, canWalkover } from './engine/admin-match.js';
import { buildAppealDoc, buildAppealDecision, matchAppealFlag } from './engine/appeal.js';
import { checkSchedule, assignMatchNos } from './engine/schedule.js';
import { manualMatchLocked } from './engine/manual-schedule.js';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const idOK=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
export function matchBasis(m) {
  return { status:m.status, score:m.score??null, penaltyScore:m.penaltyScore??null, result:m.result??null,
    revisionCount:m.revisionCount??0, managementRevision:m.managementRevision??0,
    locked:m.lock?.locked===true, home:m.home?.teamId??null, away:m.away?.teamId??null };
}
const canonical = value => JSON.stringify(value, (_,v) => v && typeof v==='object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])) : v);
const ms=v=>v?.toMillis?.()??(typeof v==='number'?v:null);
const patchTime=p=>({...p,...(Object.hasOwn(p,'kickoffAt')?{kickoffAt:p.kickoffAt==null?null:Timestamp.fromMillis(p.kickoffAt)}:{})});

export async function manageEventFor(request) {
  const uid=request.auth?.uid;
  if(!uid)fail('unauthenticated','請先登入');
  const {eventId,operationId,action,matchId,divisionId,expected,patch={},reason=null,appeal=null,updates=[]}=request.data??{};
  if(!idOK(eventId)||!idOK(operationId)||typeof action!=='string')fail('invalid-argument','管理指令不正確');
  const allowed=['match.confirm','match.reopen','match.override','match.walkover','match.postponed','match.cancelled',
    'appeal.filed','appeal.decided','schedule.move','schedule.place','schedule.shift','schedule.publish','schedule.unpublish','stream.update'];
  if(!allowed.includes(action))fail('invalid-argument','不支援這項管理操作');
  if(action.startsWith('match.')&&action!=='match.confirm'&&!String(reason??'').trim())fail('invalid-argument','修改結果必須填原因');
  const base=evRef(eventId),receiptRef=base.collection('managementOperations').doc(operationId);
  const requestHash=createHash('sha256').update(canonical(request.data)).digest('hex');
  return db().runTransaction(async tx=>{
    const actor=await adminActor(tx,uid);
    const receipt=await tx.get(receiptRef);
    if(receipt.exists){
      if(receipt.data().requestHash!==requestHash||receipt.data().actorUid!==uid)fail('already-exists','操作代碼已被使用');
      return receipt.data().result;
    }
    const stamp=FieldValue.serverTimestamp(); const writes=[]; let before=null,after=null,entity='match',entityId=matchId;
    let invalidateRef=null,invalidateDivision=null;
    if(action.startsWith('match.')||action.startsWith('appeal.')||action==='stream.update'){
      if(!idOK(matchId))fail('invalid-argument','缺少場次代碼');
      const ref=base.collection('matches').doc(matchId), snap=await tx.get(ref),m={...snap.data(),matchId};
      if(!snap.exists)fail('not-found','場次不存在');
      if(canonical(matchBasis(m))!==canonical(expected))fail('aborted','場次結果已更新，請重新載入後確認');
      before=m;let resultPatch;
      if(action==='match.confirm'){ if(!canConfirm(m).ok)fail('failed-precondition',canConfirm(m).reason); resultPatch=buildConfirmPatch(uid); }
      if(action==='match.reopen'){
        if(!canReopen(m).ok)fail('failed-precondition',canReopen(m).reason);
        const timeline=await tx.get(ref.collection('timeline'));
        resultPatch=buildReopenPatch(uid,timeline.docs.map(d=>d.data()));
      }
      if(action==='match.override'){if(!canOverride(m).ok)fail('failed-precondition',canOverride(m).reason);resultPatch=buildOverridePatch({score:patch.score,penaltyScore:patch.penaltyScore,match:m,uid});}
      if(action==='match.walkover'){if(!canWalkover(m).ok)fail('failed-precondition',canWalkover(m).reason);resultPatch=buildWalkoverPatch({side:patch.walkoverSide,uid});}
      if(['match.postponed','match.cancelled'].includes(action))resultPatch=buildStatusPatch(action.slice(6),uid);
      if(action.startsWith('appeal.')){
        if(!idOK(appeal?.appealId))fail('invalid-argument','申訴代碼不正確');
        const appealRef=base.collection('appeals').doc(appeal.appealId),aSnap=await tx.get(appealRef);
        let doc;
        if(action==='appeal.filed'){
          if(aSnap.exists)fail('already-exists','這支隊伍已登記申訴');
          if(!['finished','confirmed','walkover'].includes(m.status))fail('failed-precondition','場次還沒完賽');
          const d=appeal.doc;
          const built=buildAppealDoc({match:m,teamId:d.teamId,role:d.filedBy?.role,filerName:d.filedBy?.name,phone:d.filedBy?.phone,
            reason:d.reason,filedAtMs:Date.now(),matchEndedAtMs:ms(m.scoreSubmittedAt)??ms(m.lock?.lockedAt),depositPaid:d.depositPaid,late:d.late,actorUid:uid});
          if(built.appealId!==appeal.appealId)fail('invalid-argument','申訴與場次不一致');
          doc={...built.doc,receivedAt:stamp,createdAt:stamp,updatedAt:stamp};
        }else{
          if(!aSnap.exists||aSnap.data().matchId!==matchId||aSnap.data().status!=='filed')fail('aborted','申訴已裁決或不屬於此場次');
          doc={...aSnap.data(),...buildAppealDecision({upheld:appeal.patch?.decision?.upheld,note:appeal.patch?.decision?.note,actorUid:uid}),decidedAt:stamp,updatedAt:stamp};
        }
        writes.push({ref:appealRef,doc,set:true}); resultPatch={appeal:matchAppealFlag(doc)};
        before={match:m,appeal:aSnap.data()??null};after={match:{...m,...resultPatch},appeal:doc};
      }
      if(action==='stream.update'){
        if(patch.stream?.provider!=='youtube'||(patch.stream.videoId!=null&&!/^[\w-]{11}$/.test(patch.stream.videoId)))fail('invalid-argument','直播設定不正確');
        resultPatch={stream:patch.stream};
      }
      if(resultPatch?.lock?.locked===true)resultPatch.lock={...resultPatch.lock,lockedAt:stamp,lockedBy:uid};
      resultPatch={...resultPatch,managementRevision:(m.managementRevision??0)+1,updatedAt:stamp,updatedBy:uid};
      writes.push({ref,doc:resultPatch});
      if(action.startsWith('appeal.'))after.match={...m,...resultPatch};
      else after={...m,...resultPatch};
      if(action.startsWith('match.')){
        invalidateRef=base.collection('divisions').doc(m.divisionId);
        invalidateDivision=(await tx.get(invalidateRef)).data();
      }
    }else{
      entity='division';entityId=divisionId;
      if(!idOK(divisionId))fail('invalid-argument','缺少組別代碼');
      const divRef=base.collection('divisions').doc(divisionId), divSnap=await tx.get(divRef),div=divSnap.data();
      if(!divSnap.exists)fail('not-found','組別不存在');
      if((div.scheduleRevision??0)!==expected)fail('aborted','賽程已更新，請重新載入後确认');
      const all=await tx.get(base.collection('matches'));const matches=all.docs.map(d=>({...d.data(),matchId:d.id}));
      const changed=[];
      if(!Array.isArray(updates)||updates.length>150)fail('invalid-argument','場次更新過多');
      for(const u of updates){
        const m=matches.find(m=>m.matchId===u.matchId);
        if(!m||m.divisionId!==divisionId||!idOK(u.matchId))fail('invalid-argument','場次不屬於此組別');
        if(Object.keys(u.patch??{}).some(k=>!['kickoffAt','venueId','venueName','matchNo'].includes(k)))fail('invalid-argument','排程欄位不正確');
        if(Object.hasOwn(u.patch,'kickoffAt')&&u.patch.kickoffAt!==null&&!Number.isFinite(u.patch.kickoffAt))fail('invalid-argument','比賽時間不正確');
        if(['schedule.move','schedule.shift','schedule.place'].includes(action)&&manualMatchLocked(m))fail('aborted','場次已開打、已有比分或結果，請重新載入排程');
        const p=patchTime(u.patch);writes.push({ref:base.collection('matches').doc(m.matchId),doc:{...p,updatedBy:uid,updatedAt:stamp}});
        changed.push({before:m,after:{...m,...p}});
      }
      if(action==='schedule.publish'){
        const [venues,divisions,cfg]=await Promise.all([tx.get(base.collection('venues')),tx.get(base.collection('divisions')),tx.get(db().doc('config/schedule'))]);
        const updated=matches.map(m=>changed.find(c=>c.before.matchId===m.matchId)?.after??m);
        const findings=checkSchedule({matches:updated,venues:venues.docs.map(d=>({...d.data(),venueId:d.id})),divisions:divisions.docs.map(d=>({...d.data(),divisionId:d.id})),
          minRestMin:cfg.data()?.minRestMin,maxGapMin:cfg.data()?.maxGapMin}).findings;
        if(!updated.some(m=>m.divisionId===divisionId)||findings.some(f=>f.level==='error'))fail('failed-precondition','賽程仍有必須修正的問題');
      }
      if(['schedule.place','schedule.publish'].includes(action)) {
        const current=matches.map(m=>changed.find(c=>c.before.matchId===m.matchId)?.after??m);
        const frozen=current.some(m=>!['scheduled','checkin','ready','postponed','cancelled'].includes(m.status)||!!m.result?.winner||(m.revisionCount??0)>0||m.lock?.locked===true);
        for(const n of assignMatchNos(current,{frozen})){
          const m=current.find(m=>m.matchId===n.matchId);
          writes.push({ref:base.collection('matches').doc(n.matchId),doc:{matchNo:n.matchNo,updatedAt:stamp,updatedBy:uid}});
          const previous=changed.find(c=>c.before.matchId===n.matchId);
          if(previous)previous.after.matchNo=n.matchNo;
          else changed.push({before:matches.find(m=>m.matchId===n.matchId),after:{...m,matchNo:n.matchNo}});
        }
      }
      const divPatch={scheduleRevision:(div.scheduleRevision??0)+1,updatedAt:stamp,updatedBy:uid,
        ...(action==='schedule.publish'?{schedulePublished:true}:{}),...(action==='schedule.unpublish'?{schedulePublished:false}:{})};
      writes.push({ref:divRef,doc:divPatch});before={division:div,matches:changed.map(c=>c.before)};after={division:{...div,...divPatch},matches:changed.map(c=>c.after)};
    }
    if(invalidateDivision?.finalRankingPublished===true){
      writes.push({ref:invalidateRef,doc:{finalRankingPublished:false,finalRankingStale:true,finalRankingInvalidatedAt:stamp,finalRankingInvalidationReason:action}});
      writeAudit(eventId,{entity:'division',entityId:invalidateRef.id,action:'finalRanking.invalidate',actor,
        before:{published:true,ranking:invalidateDivision.finalRanking??null},after:{published:false},reason:action},tx);
    }
    const result={operationId,action,entityId};
    if(writes.length>200||Buffer.byteLength(canonical({before,after}))+writes.length*2048>8*1024*1024)fail('resource-exhausted','管理操作超過原子提交容量');
    for(const w of writes)w.set?tx.set(w.ref,w.doc):tx.update(w.ref,w.doc);
    writeAudit(eventId,{entity,entityId,action,before,after,reason,actor},tx);
    tx.create(receiptRef,{requestHash,actorUid:uid,result,createdAt:stamp});
    return result;
  });
}
