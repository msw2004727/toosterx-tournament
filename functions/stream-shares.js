import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, evRef, writeAudit } from './store.js';
import { sharedStreamSource, streamShareSource } from './engine/stream-share.js';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Authoritative identity, ownership and audit are committed in the same transaction. */
export async function shareMatchStreamFor(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先用 LINE 登入');
  const { eventId, matchId, action, url, shareId: target, operationId } = request.data ?? {};
  if (!validId(eventId) || !validId(matchId) || !validId(operationId) || !['share', 'remove'].includes(action)) {
    fail('invalid-argument', '直播分享指令不正確');
  }
  const isLine = request.auth.token?.firebase?.sign_in_provider === 'custom';
  const source = action === 'share' ? sharedStreamSource(url) : null;
  if (action === 'share' && !isLine) fail('permission-denied', '請用 LINE 登入後分享直播');
  if (action === 'share' && !source) fail('invalid-argument', '請貼上有效的 YouTube 影片或 Twitch 頻道直播網址');
  if (action === 'remove' && !validId(target)) fail('invalid-argument', '缺少直播分享代碼');
  // Keep YouTube IDs stable so shares created before this release still deduplicate.
  const shareId = action === 'share' ? hash(source.provider === 'twitch'
    ? [eventId, matchId, uid, 'twitch', source.channelId] : [eventId, matchId, uid, source.videoId]) : target;
  const matchRef = evRef(eventId).collection('matches').doc(matchId);
  const shareRef = matchRef.collection('streamShares').doc(shareId);
  const ownerRef = matchRef.collection('streamShareOwners').doc(shareId);
  const receiptRef = db().collection('users').doc(uid).collection('streamShareOperations').doc(operationId);
  const requestHash = hash([eventId, matchId, action, shareId]);
  return db().runTransaction(async tx => {
    const [match, share, owner, staff, profile, receipt] = await Promise.all([
      tx.get(matchRef), tx.get(shareRef), tx.get(ownerRef), tx.get(db().doc(`staff/${uid}`)),
      tx.get(db().doc(`users/${uid}`)), tx.get(receiptRef)
    ]);
    const isAdmin = staff.exists && staff.data().active === true
      && staff.data().roles?.some(role => ['admin', 'super_admin'].includes(role));
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash) fail('already-exists', '操作代碼已被使用');
      return receipt.data().result;
    }
    if (action === 'remove' && !isAdmin && (!isLine || !owner.exists || owner.data().ownerUid !== uid)) {
      fail('permission-denied', '只有分享者本人與管理員可以移除直播');
    }
    if (!match.exists) fail('not-found', '找不到這場賽事');
    const shares = await tx.get(matchRef.collection('streamShares'));
    const validShares = shares.docs.filter(doc => streamShareSource(doc.data())).length;
    const actor = { uid, name: profile.data()?.displayName || '使用者', role: isAdmin ? 'admin' : 'user' };
    let result;
    if (action === 'share') {
      const name = profile.data()?.displayName;
      if (typeof name !== 'string' || !name.trim()) fail('failed-precondition', '請重新用 LINE 登入以取得使用者名稱');
      if (share.exists) fail('already-exists', '你已分享過這個直播，可直接使用下方直播按鈕');
      if (owner.exists) fail('failed-precondition', '直播分享資料不一致，請聯絡管理員');
      const published = { shareId, displayName: name.trim().slice(0, 80).replace(/[\uD800-\uDBFF]$/, ''),
        ...source, createdAt: FieldValue.serverTimestamp() };
      tx.create(shareRef, published);
      tx.create(ownerRef, { ownerUid: uid, createdAt: FieldValue.serverTimestamp() });
      writeAudit(eventId, { entity: 'streamShare', entityId: shareId, action: 'streamShare.created', actor,
        before: null, after: { matchId, ...source, displayName: published.displayName }, reason: '使用者分享賽事直播' }, tx);
      result = { shareId, action, changed: true };
    } else {
      if (!share.exists || !owner.exists) fail('not-found', '這個直播分享已移除');
      tx.delete(shareRef);
      tx.delete(ownerRef);
      writeAudit(eventId, { entity: 'streamShare', entityId: shareId, action: 'streamShare.removed', actor,
        before: { matchId, ...streamShareSource(share.data()), displayName: share.data().displayName }, after: null,
        reason: owner.data().ownerUid === uid ? '分享者自行移除' : '管理員移除直播分享' }, tx);
      result = { shareId, action, changed: true };
    }
    const sharedStreamCount = validShares + (action === 'share' ? 1 : streamShareSource(share.data()) ? -1 : 0);
    tx.update(matchRef, { sharedStreamCount });
    tx.create(receiptRef, { requestHash, result, createdAt: FieldValue.serverTimestamp() });
    return result;
  });
}
