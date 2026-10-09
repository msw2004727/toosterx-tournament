import { assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { makeEnv } from './helpers.js';
let env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(async () => { await env.cleanup(); });
test('presence, receipts and private settings have no direct client read/write, including admin', async () => {
  const paths = ['homePresence/id','homeVisits/id','homeMetrics/settings','homeMetrics/summary'].map(p => `events/feda-cup-2026/${p}`);
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), 'staff/admin'), { active: true, roles: ['admin'] });
    for (const p of paths) await setDoc(doc(ctx.firestore(), p), { value: 1 });
  });
  for (const context of [env.unauthenticatedContext(), env.authenticatedContext('admin')]) for (const p of paths) {
    await assertFails(getDoc(doc(context.firestore(), p)));
    await assertFails(setDoc(doc(context.firestore(), p), { value: 999 }));
  }
});
