import { HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';
import { writeAudit } from './store.js';
import { newPlayerDoc, formatPlayerId, attemptMs } from './engine/challenge.js';
import { activityDate, validCompletion } from './engine/challenge-days.js';
import { allRoundDays, roundsEnabled } from './engine/challenge-rounds.js';

const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const fail = (code, message) => { throw new HttpsError(code, message); };

export async function loadRoundHistory(tx, eventId) {
  const snapshot = await tx.get(db().collection(`events/${eventId}/challengeRoundHistory`));
  return snapshot.docs.map(d => ({ ...d.data(), cutoffMs: attemptMs({ createdAt: d.data().changedAt }) }));
}

export async function calculateRoundPlayer(tx, eventId, playerId, player, challenges, rewards, nowMs = Date.now()) {
  const [as, history] = await Promise.all([
    tx.get(db().collection(`events/${eventId}/attempts`).where('playerId', '==', playerId)), loadRoundHistory(tx, eventId)
  ]);
  const attempts = as.docs.map(d => ({ ...d.data(), attemptId: d.id }));
  return { ...allRoundDays({ player, playerId, attempts, challenges, rewards, history, nowMs }),
    completedChallengeIds: challenges.filter(c => attempts.some(a => a.challengeId === c.challengeId && validCompletion(a, c))).map(c => c.challengeId) };
}

export async function refreshRoundPlayer(tx, eventId, playerId, player, challenges, rewards) {
  if (player.roundAliasOf) return { completedChanged: false, entries: 0, completedCount: 0 };
  const patch = await calculateRoundPlayer(tx, eventId, playerId, player, challenges, rewards);
  tx.update(db().doc(`events/${eventId}/players/${playerId}`), { ...patch, luckyDrawRuleVersion: rewards.version });
  return { completedChanged: true, entries: patch.luckyDrawEntries,
    completedCount: new Set(Object.values(patch.challengeDays).flatMap(d => d.completedChallengeIds)).size, ...patch };
}

/** Idempotent per previous code: simultaneous tabs receive the same next card. */
export async function issueNextChallengeCardFor({ eventId, uid, date, fromCode, nowMs = Date.now() }) {
  if (!safeId(eventId) || !uid || !/^FEDA-\d{4}$/.test(fromCode ?? '')) fail('invalid-argument', '活動或卡號不正確');
  return db().runTransaction(async tx => {
    const [u, r, cs] = await Promise.all([tx.get(db().doc(`users/${uid}`)), tx.get(db().doc('config/challengeRewards')),
      tx.get(db().collection(`events/${eventId}/challenges`))]);
    const rewards = r.data();
    if (!roundsEnabled(rewards)) fail('failed-precondition', '尚未開放多輪集點');
    if (!rewards.dates.includes(date) || activityDate(nowMs, rewards.timeZone) !== date) fail('failed-precondition', '只能領取今天的新卡');
    const playerId = u.data()?.gamePassId;
    if (!playerId) fail('failed-precondition', '請先領取你的挑戰卡');
    const ref = db().doc(`events/${eventId}/players/${playerId}`), p = await tx.get(ref);
    if (!p.exists || p.data().eventId !== eventId || p.data().roundAliasOf) fail('permission-denied', '找不到此帳號的挑戰卡');
    const patch = await calculateRoundPlayer(tx, eventId, playerId, p.data(), cs.docs.map(d => ({ ...d.data(), challengeId: d.id })), rewards, nowMs);
    const rounds = patch.challengeRounds[date], index = rounds.findIndex(row => row.code === fromCode);
    if (index < 0) fail('permission-denied', '這張卡不屬於你的當日集點');
    if (rounds[index + 1]) return { playerId, cardCode: rounds[index + 1].code, number: rounds[index + 1].number, created: false };
    if (rounds.at(-1).entries !== 1) fail('failed-precondition', '本輪尚未集滿或紀錄仍待同步，不能領新卡');
    let cardCode;
    for (let i = 0; i < 12 && !cardCode; i++) {
      const candidate = formatPlayerId(Math.floor(Math.random() * 10000));
      if (!(await tx.get(db().doc(`events/${eventId}/players/${candidate}`))).exists) cardCode = candidate;
    }
    if (!cardCode) fail('resource-exhausted', '配號失敗，請稍後再試');
    const number = rounds.at(-1).number + 1;
    rounds.push({ number, code: cardCode, startedAtMs: nowMs, required: cs.docs.filter(d => d.data().dailyOpen?.[date] === true).map(d => d.id),
      done: [], entries: 0, qualifiedAtMs: null });
    tx.create(db().doc(`events/${eventId}/players/${cardCode}`), {
      ...newPlayerDoc({ playerId: cardCode, eventId, nickname: p.data().nickname, ageBand: p.data().ageBand ?? null, createdVia: 'line' }),
      roundAliasOf: playerId, roundDate: date, roundNumber: number, createdAt: FieldValue.serverTimestamp()
    });
    tx.update(ref, { ...patch, luckyDrawRuleVersion: rewards.version });
    writeAudit(eventId, { entity: 'player', entityId: playerId, action: 'challenge.round.issued', actor: { uid },
      after: { date, fromCode, cardCode, number }, reason: '本輪集滿後配發下一輪新碼' }, tx);
    return { playerId, cardCode, number, created: true };
  });
}
