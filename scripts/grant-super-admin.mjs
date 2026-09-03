#!/usr/bin/env node
/**
 * 指派大總管
 * ------------------------------------------------------------------
 * 規格：docs/10 §5.1、R-RULES-003
 *
 * 用法：
 *   node scripts/grant-super-admin.mjs --project feda-cup-demo --uid U7774e14... --name 小麥
 *   node scripts/grant-super-admin.mjs --project feda-cup-demo --list
 *   node scripts/grant-super-admin.mjs --project feda-cup-demo --revoke U7774e14...
 *
 * 為什麼要一支腳本、而不是在介面上放一顆「切換成大總管」：
 *   大總管是**唯一**能指派身分的角色。只要介面上有任何一條路能自己拿到它，
 *   就等於「任何人登入一次就能發身分給任何人」——那整個權限模型就沒有意義了。
 *   所以 firestore.rules 的兩份白名單（staffRolesAssignable / validSelfServe）
 *   都不含 super_admin，第一位（也是每一位）大總管只能走 Admin SDK 建立，
 *   也就是這支腳本，或 Firebase Console。tests/unit/selfserve-roles.test.js
 *   會盯著那兩份白名單不要偷偷長出 super_admin。
 *
 * 認證：GOOGLE_APPLICATION_CREDENTIALS 指向服務帳戶金鑰，
 *       或先跑 `gcloud auth application-default login`。
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { EVENT_ID } from './seed/build.js';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const PROJECT = val('--project');
if (!PROJECT) {
  console.error('請指定 --project（例如 feda-cup-demo）');
  process.exit(1);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();

async function list() {
  const snap = await db.collection('staff').where('roles', 'array-contains', 'super_admin').get();
  console.log(`\n👑 ${PROJECT} 目前的大總管（${snap.size} 位）`);
  console.log('─'.repeat(60));
  if (snap.empty) console.log('  （一位都沒有——沒有人指派得了身分）');
  for (const d of snap.docs) {
    const s = d.data();
    console.log(`  ${d.id}`);
    console.log(`    名稱 ${s.name ?? '—'}　啟用 ${s.active === true ? '是' : '否'}　角色 ${(s.roles || []).join(', ')}`);
  }
  console.log();
}

if (has('--list')) { await list(); process.exit(0); }

const revoke = val('--revoke');
if (revoke) {
  const ref = db.doc(`staff/${revoke}`);
  const snap = await ref.get();
  if (!snap.exists) { console.error(`❌ ${PROJECT} 沒有 staff/${revoke}`); process.exit(1); }
  const roles = (snap.data().roles || []).filter(r => r !== 'super_admin');

  // 不能把最後一位大總管拿掉——那之後沒有任何人指派得了身分，
  // 而且**只能再跑一次這支腳本**才救得回來。
  const all = await db.collection('staff').where('roles', 'array-contains', 'super_admin').get();
  if (all.size <= 1) {
    console.error('❌ 這是最後一位大總管，拿掉之後就沒有人能指派身分了。先指派另一位再來收回。');
    process.exit(1);
  }
  await ref.update({ roles, updatedAt: FieldValue.serverTimestamp() });
  await db.doc(`users/${revoke}`).set({ roles }, { merge: true });
  console.log(`✅ 已收回 ${revoke} 的大總管`);
  await list();
  process.exit(0);
}

const UID = val('--uid');
const NAME = val('--name') || null;
if (!UID) {
  console.error('請指定 --uid（LINE 的 userId，在 #/my 頁面看得到，U 開頭 33 碼）');
  process.exit(1);
}
if (!/^U[0-9a-f]{32}$/.test(UID)) {
  // 格式擋一次，避免把 Firebase 的自動 id 或打錯的字串寫進去——
  // 寫錯不會報錯，只會產生一位永遠不會登入的大總管。
  console.error(`❌ uid 看起來不像 LINE 的 userId（U 開頭 + 32 碼十六進位）：${UID}`);
  process.exit(1);
}

if (!PROJECT.includes('demo')) {
  console.log('⚠️  這是**正式**專案。大總管能指派任何身分、能改任何結果。');
  console.log('   確定要繼續的話請加上 --i-know-this-is-production\n');
  if (!has('--i-know-this-is-production')) process.exit(1);
}

const ref = db.doc(`staff/${UID}`);
const prev = await ref.get();
const roles = [...new Set([...(prev.exists ? prev.data().roles || [] : []), 'super_admin'])];

await ref.set({
  uid: UID,
  name: NAME ?? (prev.exists ? prev.data().name : null),
  lineUserId: UID,
  roles,
  assignment: {
    eventId: EVENT_ID, date: null,
    // 大總管不受指派範圍限制，這裡留空是為了讓文件形狀跟其他 staff 一致
    venueIds: [], divisionIds: [], challengeIds: []
  },
  deviceLabel: null,
  active: true,
  updatedAt: FieldValue.serverTimestamp(),
  ...(prev.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
}, { merge: true });

// users/{uid}.roles 是給介面看的快取，權威在 staff/{uid}.roles。
// 不同步的話「我的」頁面會顯示舊身分（docs/10 §1.4）。
await db.doc(`users/${UID}`).set({ uid: UID, roles, ...(NAME ? { displayName: NAME } : {}) }, { merge: true });

console.log(`✅ ${UID} 現在是 ${PROJECT} 的大總管，角色：${roles.join(', ')}`);
await list();
