/** 已授權的挑戰設定發布工具；沒有對外 callable，也不建立玩家或成績。 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, writeAudit } from './store.js';
import { drawEntries, requiredChallengeIds } from './engine/challenge.js';

const actor = { uid: 'challenge-release-cli', role: 'system', name: '七項挑戰發布' };
const progressOf = p => ({ completedChallengeIds: p.completedChallengeIds ?? [], luckyDrawEntries: p.luckyDrawEntries ?? 0,
  luckyDrawRuleVersion: p.luckyDrawRuleVersion ?? null });

export async function installChallengeRelease({ eventId, challenges, rewards, reason, expectedRewardsUpdateTime }) {
  const ids = requiredChallengeIds(rewards);
  if (!/^[A-Za-z0-9_-]+$/.test(eventId) || !reason || rewards?.rule !== 'allChallengesCompleted'
    || !/^[A-Za-z0-9_-]+$/.test(rewards.version) || ids.length !== 7 || challenges?.length !== 2
    || rewards.entriesOnAllComplete !== 1 || rewards.maxEntriesPerPlayer !== 1
    || !challenges.every(c => ids.includes(c.challengeId))) throw Error('挑戰發布設定不正確');
  const requestHash = createHash('sha256').update(JSON.stringify({ challenges, rewards })).digest('hex');
  const base = evRef(eventId), configRef = db().doc('config/challengeRewards');
  const receiptRef = base.collection('challengeReleases').doc(rewards.version);
  return db().runTransaction(async tx => {
    const [receipt, current, all] = await Promise.all([tx.get(receiptRef), tx.get(configRef), tx.get(base.collection('challenges'))]);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash
        || !Object.entries(rewards).every(([key, value]) => JSON.stringify(current.data()?.[key]) === JSON.stringify(value))) throw Error('發布收據或目前規則不一致');
      return { changed: false, version: rewards.version };
    }
    if ((current.updateTime?.toDate().toISOString() ?? null) !== expectedRewardsUpdateTime) throw Error('抽獎設定已變更，必須重新檢查發布計畫');
    const existing = new Set(all.docs.map(d => d.id));
    if (challenges.some(c => existing.has(c.challengeId))) throw Error('新項目的代碼已存在，不能覆蓋');
    if (!ids.every(id => existing.has(id) || challenges.some(c => c.challengeId === id))) throw Error('尚未設定全部必要項目');
    const stamp = FieldValue.serverTimestamp();
    for (const c of challenges) tx.create(base.collection('challenges').doc(c.challengeId), {
      ...c, eventId, status: 'open', stats: { players: 0, attempts: 0 }, createdAt: stamp, updatedAt: stamp
    });
    tx.set(configRef, { ...rewards, updatedAt: stamp, updatedBy: actor.uid });
    writeAudit(eventId, { entity: 'challengeRewards', entityId: rewards.version, action: 'challenge.release', actor,
      before: current.data() ?? null, after: { rewards, newChallengeIds: challenges.map(c => c.challengeId) }, reason }, tx);
    tx.create(receiptRef, { requestHash, version: rewards.version, actor, reason, createdAt: stamp });
    return { changed: true, version: rewards.version };
  });
}

/** 保留完成清單與所有成績，只重算衍生資格；交易與成績觸發器共用玩家鎖。 */
export async function refreshChallengeQualification({ eventId, playerId, version, reason }) {
  const ref = evRef(eventId).collection('players').doc(playerId);
  return db().runTransaction(async tx => {
    const [snap, config] = await Promise.all([tx.get(ref), tx.get(db().doc('config/challengeRewards'))]);
    if (!snap.exists) throw Error('玩家已不存在');
    const rewards = config.data();
    if (rewards?.rule !== 'allChallengesCompleted' || rewards.version !== version) throw Error('目前抽獎規則與發布版本不一致');
    const before = progressOf(snap.data());
    const after = { ...before, luckyDrawEntries: drawEntries({ completedChallengeIds: before.completedChallengeIds, rewards }).entries,
      luckyDrawRuleVersion: version };
    if (before.luckyDrawEntries === after.luckyDrawEntries && before.luckyDrawRuleVersion === version) return { changed: false };
    tx.update(ref, { luckyDrawEntries: after.luckyDrawEntries, luckyDrawRuleVersion: version });
    writeAudit(eventId, { entity: 'player', entityId: playerId, action: 'challenge.qualification.refresh', actor, before, after, reason }, tx);
    return { changed: true, entries: after.luckyDrawEntries };
  });
}
