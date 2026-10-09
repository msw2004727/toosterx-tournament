import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { formatScore, validAttemptValue, pickBest, attemptMs } from './engine/challenge.js';
import { attemptDate, dailyProgress } from './engine/challenge-days.js';
import { writeAudit } from './store.js';
import { roundProgress, roundsEnabled, recordCode } from './engine/challenge-rounds.js';
import { loadRoundHistory } from './challenge-rounds.js';

/** Explicit whitelist: never copy UID, device identity, void reason or contacts. */
export function publicAttemptData(a, c, p) {
  if (!p || !validAttemptValue(a, c)) return null;
  return { attemptId:a.attemptId, eventId:a.eventId, challengeId:a.challengeId, playerId:a.playerId,
    playerNickname:p.nickname ?? '', rawValue:a.rawValue, displayValue:formatScore(a.rawValue,c),
    detail:Array.isArray(a.detail)?a.detail:null, isBest:a.isBest === true, voided:a.voided === true,
    createdAt:a.createdAt ?? null, recordedAtMs:a.recordedAtMs ?? null,
    activityDate:attemptDate(a), attemptNo:a.attemptNo ?? null,
    ...(a.roundCode ? { roundCode: a.roundCode } : {}) };
}

export async function syncPublicAttempt(eventId, attemptId) {
  return db().runTransaction(async tx => {
    const base=db().doc(`events/${eventId}`), raw=await tx.get(base.collection('attempts').doc(attemptId));
    const target=base.collection('attemptPublic').doc(attemptId);
    if(!raw.exists){tx.delete(target);return;}
    const a={...raw.data(),attemptId,eventId};
    if(!a.challengeId || !a.playerId){tx.delete(target);return;}
    const [c,p]=await Promise.all([tx.get(base.collection('challenges').doc(a.challengeId)),tx.get(base.collection('players').doc(a.playerId))]);
    const projection=publicAttemptData(a,c.data(),p.data());
    if(projection)tx.set(target,projection);else {
      tx.delete(target);
      tx.set(base.collection('attemptValidation').doc(attemptId),{attemptId,playerId:a.playerId,challengeId:a.challengeId,
        status:'quarantined',reason:'玩家不存在或成績形狀不符合關卡設定',checkedAt:FieldValue.serverTimestamp()});
    }
  });
}

const safeId=v=>typeof v==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v);
/** Read all rows in one transaction; admin status is checked in that same snapshot. */
export async function exportChallengeParticipantsFor({eventId,date,scope='all',mode='summary',actorUid}) {
  if(!safeId(eventId) || !['all','participated'].includes(scope) || !['summary','attempts'].includes(mode))throw new HttpsError('invalid-argument','匯出範圍不正確');
  return db().runTransaction(async tx=>{
    const staff=(await tx.get(db().doc(`staff/${actorUid}`))).data();
    if(staff?.active!==true || !staff.roles?.some(r=>['admin','super_admin'].includes(r)))throw new HttpsError('permission-denied','僅管理員與大總管可匯出');
    const rewards=(await tx.get(db().doc('config/challengeRewards'))).data();
    if(!rewards?.dates?.includes(date))throw new HttpsError('invalid-argument','請選擇活動日期');
    const base=db().doc(`events/${eventId}`);
    const [cs,ps,as,contacts,users]=await Promise.all(['challenges','players','attempts','playerContacts'].map(col=>tx.get(base.collection(col))).concat(tx.get(db().collection('users').where('gamePassId','!=',null))));
    const challenges=cs.docs.map(d=>({...d.data(),challengeId:d.id})).sort((a,b)=>(a.order??0)-(b.order??0)||a.challengeId.localeCompare(b.challengeId));
    const attempts=as.docs.map(d=>({...d.data(),attemptId:d.id})).filter(a=>attemptDate(a,rewards.timeZone)===date);
    const uidMap=new Map();
    for(const d of users.docs){const pid=d.data().gamePassId;if(uidMap.has(pid))throw new HttpsError('data-loss','同一卡號有多個帳號綁定，請先核對');uidMap.set(pid,d.id);}
    const phone=new Map(contacts.docs.map(d=>[d.id,d.data().phone??'']));
    const players=ps.docs.map(d=>({...d.data(),playerId:d.id})).filter(p=>!p.roundAliasOf).sort((a,b)=>a.playerId.localeCompare(b.playerId));
    const history=roundsEnabled(rewards)?await loadRoundHistory(tx,eventId):[];
    const columns=[{key:'date',label:'活動日期'},{key:'playerId',label:'卡號'},{key:'nickname',label:'暱稱'},
      {key:'lineUid',label:'LINE UID'},{key:'contact',label:'聯繫方式'},{key:'createdVia',label:'建立方式'},{key:'linked',label:'LINE 綁定狀態'}];
    if(mode==='summary'){
      for(const c of challenges)columns.push({key:`score_${c.challengeId}`,label:`${c.name} 成績`},{key:`status_${c.challengeId}`,label:`${c.name} 狀態`});
      columns.push({key:'completedCount',label:'當日完成數'},{key:'requiredCount',label:'當日必要攤位數'},{key:'entries',label:'當日抽獎資格'});
    }else columns.push(...['attemptId','challengeName','rawValue','displayValue','detail','recordedAt','createdAt','voided','voidReason','valid'].map(key=>({key,label:({attemptId:'紀錄編號',challengeName:'攤位',rawValue:'原始成績',displayValue:'顯示成績',detail:'逐球細項',recordedAt:'參與時間',createdAt:'入庫時間',voided:'已作廢',voidReason:'作廢原因',valid:'成績檢核'})[key]})));
    if(roundsEnabled(rewards)){ columns.push({key:'roundCodes',label:'當日輪次碼號'}); if(mode==='detail')columns.push({key:'roundCode',label:'本筆集點碼號'}); }
    const rows=[];
    for(const p of players){
      const mine=attempts.filter(a=>a.playerId===p.playerId);
      if(scope==='participated'&&!mine.length)continue;
      const round=roundsEnabled(rewards)?roundProgress({player:p,playerId:p.playerId,attempts:mine,challenges,date,timeZone:rewards.timeZone,history}):null;
      const shared={date,playerId:p.playerId,nickname:p.nickname??'',lineUid:uidMap.get(p.playerId)??'',contact:phone.get(p.playerId)??'',createdVia:p.createdVia??'',linked:uidMap.has(p.playerId)?'已綁定':'未綁定',
        ...(round?{roundCodes:round.rounds.map(r=>`${r.number}:${r.code}`).join(' / ')}:{})};
      if(mode==='summary'){
        const progress=round??dailyProgress({attempts:mine,challenges,date,timeZone:rewards.timeZone});
        const row={...shared,completedCount:progress.done.length,requiredCount:round?round.rounds.at(-1).required.length:progress.required.length,entries:progress.entries};
        for(const c of challenges){const records=mine.filter(a=>a.challengeId===c.challengeId),live=records.filter(a=>a.voided!==true&&validAttemptValue(a,c));
          const best=pickBest(live,c);row[`score_${c.challengeId}`]=best.value==null?'':formatScore(best.value,c);
          row[`status_${c.challengeId}`]=c.dailyOpen?.[date]!==true?'當日未開放':live.length?'已參與':records.length?'無有效成績':'未參與';}
        rows.push(row);
      }else for(const a of mine){const c=challenges.find(c=>c.challengeId===a.challengeId);
        rows.push({...shared,...(round?{roundCode:a.roundCode??p.playerId}:{}),attemptId:a.attemptId,challengeName:c?.name??a.challengeId,rawValue:a.rawValue??'',displayValue:c?formatScore(a.rawValue,c):'',detail:JSON.stringify(a.detail??null),
          recordedAt:a.recordedAtMs?new Date(a.recordedAtMs).toISOString():'',createdAt:attemptMs({...a,recordedAtMs:undefined})?new Date(attemptMs({...a,recordedAtMs:undefined})).toISOString():'',
          voided:a.voided===true?'是':'否',voidReason:a.voidReason??'',valid:validAttemptValue(a,c)?'通過':'待核對'});
      }
    }
    writeAudit(eventId,{entity:'challenge',entityId:'participants',action:'export.challengeParticipants',actor:{uid:actorUid},after:{date,scope,mode,rows:rows.length},reason:'匯出活動參與名單'},tx);
    return {date,scope,mode,columns,rows,requiredCount:challenges.filter(c=>c.dailyOpen?.[date]===true).length};
  });
}
