#!/usr/bin/env node
/**
 * 開關報名 / 設定截止日
 * ------------------------------------------------------------------
 * 規格：docs/10 §2.3
 *
 * 用法：
 *   node scripts/set-registration.mjs --project feda-cup-demo --show
 *   node scripts/set-registration.mjs --project feda-cup-demo --open --closes 2026-09-13T00:00
 *   node scripts/set-registration.mjs --project feda-cup-demo --close
 *
 * 為什麼要一支腳本而不是進 Console 手改：
 *   ・`closesAt` 必須是 Timestamp。在 Console 用字串填會讓 rules 的
 *     `request.time <= closesAt` 直接判偽——報名會**安靜地永遠打不開**
 *   ・時間一律用台北時間輸入。手動換算 UTC 遲早會差 8 小時，
 *     而差的那一天剛好就是截止日
 *
 * 認證：GOOGLE_APPLICATION_CREDENTIALS 指向服務帳戶金鑰，
 *       或先跑 `gcloud auth application-default login`。
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const PROJECT = val('--project');
if (!PROJECT) {
  console.error('請指定 --project（例如 feda-cup-demo）');
  process.exit(1);
}

/**
 * 台北時間字串 → Timestamp。
 * 只吃 `YYYY-MM-DDTHH:mm`，因為那是人看得懂、也不會誤會時區的唯一格式。
 * `new Date('2026-09-13T00:00')` 會用**執行這支程式的機器**的時區解析，
 * 在 CI（UTC）上就會差 8 小時，所以這裡自己算。
 */
function taipei(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) throw new Error(`時間格式要是 YYYY-MM-DDTHH:mm（台北時間），收到「${s}」`);
  const [, y, mo, d, h, mi] = m.map(Number);
  // 台北固定 UTC+8，沒有日光節約時間
  return Timestamp.fromMillis(Date.UTC(y, mo - 1, d, h - 8, mi));
}

const fmt = ts => ts
  ? new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', dateStyle: 'full', timeStyle: 'short'
    }).format(ts.toDate()) + '（台北）'
  : '未設定';

initializeApp({ credential: applicationDefault(), projectId: PROJECT });
const db = getFirestore();
const ref = db.doc('config/registration');

function show(d) {
  console.log('\n📋 config/registration ＠', PROJECT);
  console.log('─'.repeat(52));
  console.log('  open      ', d.open === true ? '✅ 開放中' : '⛔ 關閉');
  console.log('  opensAt   ', fmt(d.opensAt));
  console.log('  closesAt  ', fmt(d.closesAt));
  console.log('─'.repeat(52));

  // 實際開不開得成是 AND：三個條件缺一不可（跟 firestore.rules 的 regOpen() 同一組判斷）
  const now = Date.now();
  const started = !d.opensAt || d.opensAt.toMillis() <= now;
  const ended = d.closesAt && d.closesAt.toMillis() < now;
  const live = d.open === true && started && !ended;
  console.log(live
    ? '  → 現在報名得進來'
    : `  → 現在報名進不來（${d.open !== true ? 'open 是 false' : !started ? '還沒到開始時間' : '已經超過截止時間'}）`);
  console.log();
}

const snap = await ref.get();
const cur = snap.exists ? snap.data() : null;

if (has('--show') || argv.length === 2) {
  if (!cur) { console.error(`❌ ${PROJECT} 沒有 config/registration 這份文件`); process.exit(1); }
  show(cur);
  process.exit(0);
}

const patch = {};
if (has('--open')) patch.open = true;
if (has('--close')) patch.open = false;
if (val('--opens')) patch.opensAt = taipei(val('--opens'));
if (val('--closes')) patch.closesAt = taipei(val('--closes'));
if (has('--clear-closes')) patch.closesAt = null;

if (Object.keys(patch).length === 0) {
  console.error('沒有指定要改什麼。可用：--open / --close / --opens / --closes / --clear-closes / --show');
  process.exit(1);
}

// 截止日必須在開始之後。反過來的話報名永遠打不開，而且畫面上看起來一切正常。
const opensAt = patch.opensAt ?? cur?.opensAt ?? null;
const closesAt = patch.closesAt ?? cur?.closesAt ?? null;
if (opensAt && closesAt && closesAt.toMillis() <= opensAt.toMillis()) {
  console.error(`❌ 截止時間（${fmt(closesAt)}）不能早於開始時間（${fmt(opensAt)}）`);
  process.exit(1);
}

if (!snap.exists) {
  console.log('ℹ️  文件不存在，建立一份新的');
  await ref.set({
    open: false, opensAt: null, closesAt: null,
    maxTeamsPerAccount: 3, minMembers: null, maxMembers: null,
    note: '由 scripts/set-registration.mjs 建立',
    ...patch
  });
} else {
  await ref.update(patch);
}

console.log('✅ 已更新');
show((await ref.get()).data());
