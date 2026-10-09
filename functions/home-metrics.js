import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { db } from './admin.js';
import { HOME_METRICS, campaignShares } from './engine/home-metrics.js';

const EVENT = 'feda-cup-2026';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = value => createHash('sha256').update(`${EVENT}:${value}`).digest('hex');

/** Public, aggregate-only endpoint. No LINE login or UID is needed to measure a browser visit. */
export async function reportHomeMetricsFor(request) {
  const p = request.data;
  if (!p || Object.keys(p).some(k => !['eventId', 'visitorId', 'visitId', 'visible', 'sequence'].includes(k))
    || p.eventId !== EVENT || !uuid.test(p.visitorId ?? '') || !uuid.test(p.visitId ?? '')
    || typeof p.visible !== 'boolean' || !Number.isSafeInteger(p.sequence) || p.sequence < 1) {
    throw new HttpsError('invalid-argument', '瀏覽統計參數不完整');
  }
  const database = db(), nowMs = Date.now(), visitorHash = digest(p.visitorId);
  const base = database.doc(`events/${EVENT}`);
  const settingsRef = base.collection('homeMetrics').doc('settings');
  const summaryRef = base.collection('homeMetrics').doc('summary');
  const receiptRef = base.collection('homeVisits').doc(digest(p.visitId));
  const presenceRef = base.collection('homePresence').doc(digest(p.visitId));
  const settings = await database.runTransaction(async tx => {
    const [ss, receipt, presence] = await Promise.all([tx.get(settingsRef), tx.get(receiptRef), tx.get(presenceRef)]);
    const config = ss.data();
    if (!Number.isSafeInteger(config?.shareStartedAtMs)) throw new HttpsError('failed-precondition', '活動統計尚未啟用');
    if (receipt.exists && receipt.data().visitorHash !== visitorHash) throw new HttpsError('permission-denied', '瀏覽識別不符');
    if (!receipt.exists && p.visible) {
      tx.create(receiptRef, { visitorHash, createdAt: FieldValue.serverTimestamp() });
      tx.set(summaryRef, { realViews: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    // A late heartbeat must not undo a newer hidden/closed state.
    if (p.sequence > (presence.data()?.sequence ?? 0)) {
      tx.set(presenceRef, { visitorHash, sequence: p.sequence,
        activeUntilMs: p.visible ? nowMs + HOME_METRICS.presenceLifetimeMs : 0,
        updatedAt: FieldValue.serverTimestamp() });
    }
    return config;
  });
  const countedAtMs = Date.now();
  const [summary, active] = await Promise.all([
    summaryRef.get(), base.collection('homePresence').where('activeUntilMs', '>', countedAtMs).get()
  ]);
  return { realOnline: new Set(active.docs.map(d => d.data().visitorHash)).size,
    realViews: summary.data()?.realViews ?? 0, serverNowMs: countedAtMs,
    shareStartedAtMs: settings.shareStartedAtMs, shareEndsAtMs: HOME_METRICS.shareEndsAtMs,
    shares: campaignShares(settings.shareStartedAtMs, countedAtMs) };
}
