/** 已授權的挑戰設定發布工具；沒有對外 callable，也不建立玩家或成績。 */
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, writeAudit } from './store.js';
import { drawEntries, requiredChallengeIds } from './engine/challenge.js';

const actor = { uid: 'challenge-release-cli', role: 'system', name: '七項挑戰發布' };
const progressOf = p => ({ completedChallengeIds: p.completedChallengeIds ?? [], luckyDrawEntries: p.luckyDrawEntries ?? 0,
  luckyDrawRuleVersion: p.luckyDrawRuleVersion ?? null });

/** 僅更新玩法展示文字；保留統計、計分政策、完成紀錄與抽獎設定。 */
export async function updateChallengeMetadata({ eventId, updates, expectedUpdateTimes, releaseId, reason }) {
  const allowed = ['summary', 'name', 'shortName', 'boothLocation', 'description', 'rulesText'];
  if (typeof eventId !== 'string' || typeof releaseId !== 'string' || typeof reason !== 'string'
    || !/^[A-Za-z0-9_-]+$/.test(eventId) || !/^[A-Za-z0-9_-]+$/.test(releaseId) || !reason.trim()
    || !Array.isArray(updates) || updates.length === 0 || new Set(updates.map(u => u.challengeId)).size !== updates.length
    || !updates.every(u => /^[A-Za-z0-9_-]+$/.test(u.challengeId) && u.patch && Object.keys(u.patch).length > 0
      && Object.entries(u.patch).every(([key, value]) => allowed.includes(key) && typeof value === 'string' && value.trim().length > 0))) {
    throw Error('玩法文字更新只能包含非空的展示欄位');
  }
  const requestHash = createHash('sha256').update(JSON.stringify(updates)).digest('hex');
  const base = evRef(eventId), receipt = base.collection('challengeReleases').doc(releaseId);
  const refs = updates.map(u => base.collection('challenges').doc(u.challengeId));
  return db().runTransaction(async tx => {
    const [previous, ...snapshots] = await Promise.all([tx.get(receipt), ...refs.map(ref => tx.get(ref))]);
    if (previous.exists) {
      if (previous.data().requestHash !== requestHash || snapshots.some((s, i) => !s.exists
        || Object.entries(updates[i].patch).some(([key, value]) => s.data()[key] !== value))) throw Error('文字發布收據與目前設定不一致');
      return { changed: false, count: updates.length };
    }
    if (snapshots.some(s => !s.exists || !expectedUpdateTimes?.[s.id]
      || s.updateTime.toDate().toISOString() !== expectedUpdateTimes[s.id])) throw Error('攤位設定已變更，請重新產生發布計畫');
    const releaseActor = { uid: 'challenge-metadata-cli', role: 'system', name: '挑戰玩法與攤位 SOP 發布' };
    const stamp = FieldValue.serverTimestamp();
    for (let i = 0; i < updates.length; i++) tx.update(refs[i], { ...updates[i].patch, updatedAt: stamp });
    writeAudit(eventId, { entity: 'challenge', entityId: releaseId, action: 'challenge.metadata.update', actor: releaseActor,
      before: snapshots.map((s, i) => ({ challengeId: s.id, ...Object.fromEntries(Object.keys(updates[i].patch).map(k => [k, s.data()[k] ?? null])) })),
      after: updates, reason }, tx);
    tx.create(receipt, { requestHash, releaseId, actor: releaseActor, reason, createdAt: stamp });
    return { changed: true, count: updates.length };
  });
}

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
