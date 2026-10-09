import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin.js';
import { FieldValue, FieldPath } from 'firebase-admin/firestore';
import { DAILY_RULE, dailyProgress, dailyQualification, validCompletion } from './engine/challenge-days.js';
import { luckyDrawRows } from './engine/csv.js';
import { writeAudit } from './store.js';
import { randomUUID } from 'node:crypto';

const fail = (code, message) => { throw new HttpsError(code, message); };
const docs = snap => snap.docs.map(d => ({ ...d.data(), playerId: d.id }));

export async function updateChallengeDayFor({ eventId, challengeId, date, open, expectedOpen, actorUid }) {
  if (!eventId || !challengeId || typeof open !== 'boolean' || typeof expectedOpen !== 'boolean') fail('invalid-argument', '關卡、日期與開關設定不完整');
  const jobId = randomUUID();
  return db().runTransaction(async tx => {
    const staff = (await tx.get(db().doc(`staff/${actorUid}`))).data();
    const roles = staff?.roles ?? [];
    const admin = roles.some(r => ['admin', 'super_admin'].includes(r));
    if (staff?.active !== true || (!admin && (!roles.some(r => ['booth', 'checkin', 'referee', 'scorer', 'staff'].includes(r))
      || staff.assignment?.eventId !== eventId || !staff.assignment?.challengeIds?.includes(challengeId)))) fail('permission-denied', '只能設定自己負責的攤位');
    const rewards = (await tx.get(db().doc('config/challengeRewards'))).data();
    if (rewards?.rule !== DAILY_RULE || !rewards.dates?.includes(date)) fail('invalid-argument', '不是活動日期');
    const ref = db().doc(`events/${eventId}/challenges/${challengeId}`);
    const c = (await tx.get(ref)).data();
    if (!c) fail('not-found', '找不到關卡');
    const before = c.dailyOpen?.[date] === true;
    if (before !== expectedOpen) fail('aborted', '開放設定已被其他人更新，請確認最新狀態後再操作');
    if (before === open) return { date, open, changed: false };
    tx.update(ref, { [`dailyOpen.${date}`]: open, updatedAt: FieldValue.serverTimestamp(),
      qualificationRefresh: { status:'queued', jobId } });
    tx.create(db().doc(`events/${eventId}/challengeRefreshJobs/${jobId}`),
      { challengeId, date, status:'queued', createdAt:FieldValue.serverTimestamp() });
    writeAudit(eventId, { entity: 'challenge', entityId: challengeId, action: 'challenge.dailyOpen',
      before: { date, open: before }, after: { date, open }, actor: { uid: actorUid }, reason: '主辦設定每日攤位開放' }, tx);
    return { date, open, changed: true, refreshStatus:'queued' };
  });
}

/** Durable outbox + retryable trigger. Every player transaction reads current settings and attempts. */
export async function refreshChallengeDayJob(eventId, jobId) {
  const jobRef=db().doc(`events/${eventId}/challengeRefreshJobs/${jobId}`), job=(await jobRef.get()).data();
  if(!job || job.status==='complete')return;
  for (;;) {
    const current=(await jobRef.get()).data();if(current.status==='complete')return;
    const cursor=current.cursor??'';
    let query=db().collection(`events/${eventId}/players`).orderBy(FieldPath.documentId()).limit(100);
    if(cursor)query=query.startAfter(cursor);
    const players=await query.get();if(players.empty)break;
    for(let i=0;i<players.docs.length;i+=10)await Promise.all(players.docs.slice(i,i+10).map(player=>db().runTransaction(async tx=>{
      const [cs,r,p]=await Promise.all([tx.get(db().collection(`events/${eventId}/challenges`)),
        tx.get(db().doc('config/challengeRewards')),tx.get(player.ref)]);
      if(!p.exists)return;
      await refreshDailyPlayer(eventId,player.id,tx,cs.docs.map(d=>({...d.data(),challengeId:d.id})),r.data());
    })));
    await db().runTransaction(async tx=>{
      const saved=(await tx.get(jobRef)).data();
      if(saved.status!=='complete'&&(saved.cursor??'')===cursor)tx.update(jobRef,
        {cursor:players.docs.at(-1).id,players:(saved.players??0)+players.size});
    });
  }
  await db().runTransaction(async tx=>{
    const challengeRef=db().doc(`events/${eventId}/challenges/${job.challengeId}`);
    const [cs,js]=await Promise.all([tx.get(challengeRef),tx.get(jobRef)]), c=cs.data();
    if(js.data()?.status==='complete')return;
    tx.update(jobRef,{status:'complete',completedAt:FieldValue.serverTimestamp()});
    if(c?.qualificationRefresh?.jobId===jobId)tx.update(challengeRef,{'qualificationRefresh.status':'complete'});
    writeAudit(eventId,{entity:'challenge',entityId:job.challengeId,action:'challenge.qualification.refreshed',
      after:{date:job.date,players:js.data().players??0,jobId},reason:'每日開放設定變更後重新核對資格'},tx);
  });
}

/** One consistent server snapshot; no dependency on asynchronous attempt triggers. */
export async function dailyDrawExportFor({ eventId, date, actorUid }) {
  if (!eventId) fail('invalid-argument', '缺少活動');
  return db().runTransaction(async tx => {
    const staff = (await tx.get(db().doc(`staff/${actorUid}`))).data();
    if (staff?.active !== true || !staff.roles?.some(r => ['admin', 'super_admin'].includes(r))) fail('permission-denied', '僅管理員可匯出');
    const rewards = (await tx.get(db().doc('config/challengeRewards'))).data();
    if (rewards?.rule !== DAILY_RULE || !rewards.dates?.includes(date)) fail('invalid-argument', '不是活動日期');
    const base = db().collection(`events/${eventId}/challenges`);
    const [cs, ps, as, contacts] = await Promise.all([
      tx.get(base), tx.get(db().collection(`events/${eventId}/players`)),
      tx.get(db().collection(`events/${eventId}/attempts`)), tx.get(db().collection(`events/${eventId}/playerContacts`))
    ]);
    const challenges = cs.docs.map(d => ({ ...d.data(), challengeId: d.id }));
    const attempts = as.docs.map(d => ({ ...d.data(), attemptId: d.id }));
    const byPlayer = new Map();
    for (const a of attempts) { if (!byPlayer.has(a.playerId)) byPlayer.set(a.playerId, []); byPlayer.get(a.playerId).push(a); }
    const players = docs(ps).map(p => {
      const progress = dailyProgress({ attempts: byPlayer.get(p.playerId) ?? [], challenges, date, timeZone: rewards.timeZone });
      return { ...p, completedChallengeIds: progress.done, luckyDrawEntries: progress.entries };
    });
    const requiredCount = challenges.filter(c => c.dailyOpen?.[date] === true).length;
    const rows = luckyDrawRows(players, { contacts: Object.fromEntries(contacts.docs.map(d => [d.id, d.data()])) })
      .map(r => ({ ...r, date, requiredCount }));
    return { date, requiredCount, rows, dates: rewards.dates, timeZone: rewards.timeZone };
  });
}

export async function refreshDailyPlayer(eventId, playerId, tx, challenges, rewards) {
  const snap = await tx.get(db().collection(`events/${eventId}/attempts`).where('playerId', '==', playerId));
  const attempts = snap.docs.map(d => ({...d.data(),attemptId:d.id}));
  const qualification = dailyQualification(attempts, challenges, rewards);
  const completed = challenges.filter(c => attempts.some(a => a.challengeId === c.challengeId && validCompletion(a, c))).map(c => c.challengeId);
  const daily = Object.fromEntries(Object.entries(qualification).map(([date, p]) => [date, {
    completedChallengeIds: p.done, requiredChallengeIds: p.required, entries: p.entries
  }]));
  tx.update(db().doc(`events/${eventId}/players/${playerId}`), {
    completedChallengeIds: completed,
    challengeDays: daily, luckyDrawEntries: Object.values(daily).reduce((n, p) => n + p.entries, 0),
    luckyDrawRuleVersion: rewards.version, lastActiveAt: FieldValue.serverTimestamp()
  });
  return { completedChanged: true, entries: Object.values(daily).reduce((n, p) => n + p.entries, 0), completedCount: completed.length };
}
