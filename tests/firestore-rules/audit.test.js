/**
 * firestore.rules｜稽核日誌與報名
 * 對應 docs/07 §2.4 的 R11、R12、R20
 */
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, deleteDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { makeEnv, seedBaseline, authed, guest, EVENT, MATCH } from './helpers.js';

let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); await seedBaseline(env); });

const auditRef = (db, id = 'audit-1') => doc(db, 'events', EVENT, 'audits', id);

describe('稽核日誌', () => {
  test('R11 任何人都不可刪除稽核紀錄（含 Admin）', async () => {
    await assertFails(deleteDoc(auditRef(authed(env, 'u-admin'))));
    await assertFails(deleteDoc(auditRef(guest(env))));
  });

  test('R12 任何人都不可修改稽核紀錄（含 Admin）', async () => {
    await assertFails(updateDoc(auditRef(authed(env, 'u-admin')), { action: 'tampered' }));
  });

  test('附加：工作人員可新增稽核，但 actor.uid 必須是自己', async () => {
    const db = authed(env, 'u-scorer');
    await assertSucceeds(setDoc(auditRef(db, 'audit-ok'), {
      eventId: EVENT, entity: 'match', entityId: MATCH, action: 'score.update',
      before: { score: { home: 0, away: 0 } }, after: { score: { home: 1, away: 0 } },
      reason: '第 12 分鐘進球', actor: { uid: 'u-scorer', name: '示範賽務A' },
      source: 'staff-web', createdAt: serverTimestamp()
    }));
    await assertFails(setDoc(auditRef(db, 'audit-fake'), {
      entity: 'match', entityId: MATCH, action: 'score.update',
      actor: { uid: 'u-admin', name: '冒名' }, createdAt: serverTimestamp()
    }));
  });

  test('附加：一般賽務不可讀稽核日誌，場地主任以上才可以', async () => {
    await assertFails(getDoc(auditRef(authed(env, 'u-scorer'))));
    await assertSucceeds(getDoc(auditRef(authed(env, 'u-lead'))));
    await assertSucceeds(getDoc(auditRef(authed(env, 'u-admin'))));
  });
});

describe('賽前報名', () => {
  const reg = (over = {}) => ({
    registrationId: 'reg-1', eventId: EVENT, divisionId: 'adult-open',
    teamName: '臺中野狼足球隊',
    contact: { name: '呂維哲', phone: '09xx', email: 'x@example.com' },
    roster: [], status: 'pending', createdAt: serverTimestamp(), ...over
  });

  test('R20 公開報名只能建立 pending，不可自行核准', async () => {
    await assertSucceeds(setDoc(
      doc(guest(env), 'events', EVENT, 'registrations', 'reg-1'), reg()
    ));
    await assertFails(setDoc(
      doc(guest(env), 'events', EVENT, 'registrations', 'reg-2'),
      reg({ registrationId: 'reg-2', status: 'approved' })
    ));
  });

  test('附加：報名內容只有 Admin 可讀', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'registrations', 'reg-1'), reg());
    });
    await assertFails(getDoc(doc(guest(env), 'events', EVENT, 'registrations', 'reg-1')));
    await assertFails(getDoc(doc(authed(env, 'u-scorer'), 'events', EVENT, 'registrations', 'reg-1')));
    await assertSucceeds(getDoc(doc(authed(env, 'u-admin'), 'events', EVENT, 'registrations', 'reg-1')));
  });
});
