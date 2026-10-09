import { jest } from '@jest/globals';
import { db } from '../../functions/admin.js';
import { reportHomeMetricsFor } from '../../functions/home-metrics.js';
const EVENT = 'feda-cup-2026', START = Date.parse('2026-10-09T12:00:00+08:00');
const a = '00000000-0000-4000-8000-000000000001', b = '00000000-0000-4000-8000-000000000002';
const c = '00000000-0000-4000-8000-000000000003', d = '00000000-0000-4000-8000-000000000004';
const base = () => db().doc(`events/${EVENT}`);
const request = over => ({ data: { eventId: EVENT, visitorId: a, visitId: b, visible: true, sequence: 1, ...over } });
let clock;
beforeEach(async () => {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw Error('Local emulator required');
  await db().recursiveDelete(base());
  await base().collection('homeMetrics').doc('settings').set({ shareStartedAtMs: START });
  clock = jest.spyOn(Date, 'now').mockReturnValue(START);
});
afterEach(() => clock.mockRestore());
test('public visitor count is real, aggregate only, and one visit stays one across heartbeats/retries', async () => {
  expect(await reportHomeMetricsFor(request())).toMatchObject({ realOnline: 1, realViews: 1, shares: 33 });
  clock.mockReturnValue(START + 30000);
  const result = await reportHomeMetricsFor(request({ sequence: 2 }));
  expect(result).toMatchObject({ realOnline: 1, realViews: 1 });
  expect(Object.keys(result).sort()).toEqual(['realOnline','realViews','serverNowMs','shareStartedAtMs','shareEndsAtMs','shares'].sort());
  const rows = (await base().collection('homePresence').get()).docs;
  expect(rows[0].id).not.toContain(a); expect(JSON.stringify(rows[0].data())).not.toContain(a);
});
test('same browser with two tabs is one online device but two genuine page visits', async () => {
  await reportHomeMetricsFor(request());
  expect(await reportHomeMetricsFor(request({ visitId: c }))).toMatchObject({ realOnline: 1, realViews: 2 });
  expect(await reportHomeMetricsFor(request({ visitorId: d, visitId: d }))).toMatchObject({ realOnline: 2, realViews: 3 });
});
test('closing one tab retains another tab, and a late heartbeat cannot re-open a closed visit', async () => {
  await reportHomeMetricsFor(request()); await reportHomeMetricsFor(request({ visitId: c }));
  expect(await reportHomeMetricsFor(request({ visible: false, sequence: 3 }))).toMatchObject({ realOnline: 1, realViews: 2 });
  await reportHomeMetricsFor(request({ sequence: 2 }));
  expect(await reportHomeMetricsFor(request({ visitId: c, visible: false, sequence: 2 }))).toMatchObject({ realOnline: 0, realViews: 2 });
});
test('abandoned heartbeat expires after 90 seconds, while cumulative views persist', async () => {
  await reportHomeMetricsFor(request()); clock.mockReturnValue(START + 90000);
  expect(await reportHomeMetricsFor(request({ visitorId: c, visitId: d }))).toMatchObject({ realOnline: 1, realViews: 2 });
});
test('concurrent duplicate requests create exactly one receipt and counter increment', async () => {
  await Promise.all(Array.from({ length: 5 }, () => reportHomeMetricsFor(request())));
  expect((await base().collection('homeVisits').get()).size).toBe(1);
  expect((await base().collection('homeMetrics').doc('summary').get()).data().realViews).toBe(1);
});
test('failed configuration and client-forged values do not create traffic records', async () => {
  for (const over of [{ realViews: 999 }, { eventId: 'other' }, { sequence: 0 }, { visitorId: 'invalid' }, { visible: 'true' }, { serverNowMs: 0 }]) {
    await expect(reportHomeMetricsFor(request(over))).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  await base().collection('homeMetrics').doc('settings').delete();
  await expect(reportHomeMetricsFor(request())).rejects.toMatchObject({ code: 'failed-precondition' });
  expect((await base().collection('homeVisits').get()).size).toBe(0);
});
test('visit id cannot be reassigned to another visitor', async () => {
  await reportHomeMetricsFor(request());
  await expect(reportHomeMetricsFor(request({ visitorId: c }))).rejects.toMatchObject({ code: 'permission-denied' });
});
test('scheduled shares are computed from the persisted launch time and freeze after Oct 12', async () => {
  clock.mockReturnValue(START + 600000);
  expect((await reportHomeMetricsFor(request())).shares).toBe(39);
  clock.mockReturnValue(Date.parse('2026-10-12T00:00:00+08:00'));
  expect((await reportHomeMetricsFor(request({ sequence: 2 }))).shares).toBe(2193);
  clock.mockReturnValue(Date.parse('2026-10-13T00:00:00+08:00'));
  expect((await reportHomeMetricsFor(request({ sequence: 3 }))).shares).toBe(2193);
});
