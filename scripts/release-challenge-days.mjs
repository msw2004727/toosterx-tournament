#!/usr/bin/env node
/** Add date settings without deleting or resetting any player/attempt data. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { db } from '../functions/admin.js';
import { DAILY_RULE, dailyStats, dailyQualification, dailyRewardSettings } from '../js/engine/challenge-days.js';
import { EVENT_ID, EVENT } from '../js/config.js';
import { writeAudit } from '../functions/store.js';

// Resolve transforms beside db(): root and functions may install separate SDK copies.
const { FieldValue } = createRequire(new URL('../functions/admin.js', import.meta.url))('firebase-admin/firestore');

const args = process.argv.slice(2);
const arg = key => args[args.indexOf(key) + 1];
const project = arg('--project'), apply = args.includes('--apply');
if (!['feda-cup-demo', 'feda-cup-2026'].includes(project) || (!apply && !args.includes('--dry-run')) || process.env.FIRESTORE_EMULATOR_HOST) throw Error('指定 demo/prod 專案與 dry-run/apply，不能使用模擬器');
process.env.GCLOUD_PROJECT = project;
const base = db().doc(`events/${EVENT_ID}`), config = db().doc('config/challengeRewards');
const [event, cfg, cs, ps, ats] = await Promise.all([base.get(), config.get(), base.collection('challenges').get(), base.collection('players').get(), base.collection('attempts').get()]);
const dates = event.data()?.dates ?? EVENT.dates;
const timeZone = event.data()?.timezone ?? EVENT.timezone;
if (timeZone !== 'Asia/Taipei' || !dates.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date))) throw Error('日期／時區設定需要先確認');
const rewards = dailyRewardSettings(dates, timeZone);
const plan = { project, eventId: EVENT_ID, dates, timeZone, rule: DAILY_RULE, challenges: cs.size, players: ps.size, attempts: ats.size,
  expectedConfigUpdateTime: cfg.updateTime?.toDate().toISOString() ?? null, defaultOpen: true, keepsAllRecords: true };
console.log(JSON.stringify(plan));
if (!apply) process.exit(0);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (arg('--expected-head') !== head || execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw Error('只能發布指定且乾淨的已驗證提交');
if (arg('--expected-config-update-time') !== String(plan.expectedConfigUpdateTime)) throw Error('設定版本與 dry-run 不一致');
mkdirSync('tools/challenge-days/backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(`tools/challenge-days/backups/${project}-${stamp}.json`, JSON.stringify({
  config: cfg.data() ?? null, challenges: cs.docs.map(d => ({ id: d.id, data: d.data() })), players: ps.docs.map(d => ({ id: d.id, data: d.data() })),
  attempts: ats.docs.map(d => ({ id: d.id, data: d.data() }))
}, null, 2));
await db().runTransaction(async tx => {
  const current = await tx.get(config);
  if ((current.updateTime?.toDate().toISOString() ?? null) !== plan.expectedConfigUpdateTime) throw Error('設定已被他人修改，中止發布');
  const [all, records] = await Promise.all([tx.get(base.collection('challenges')), tx.get(base.collection('attempts'))]);
  tx.set(config, rewards);
  for (const c of all.docs) {
    const challenge = { ...c.data(), challengeId: c.id };
    const dailyOpen = Object.fromEntries(dates.map(date => [date, typeof challenge.dailyOpen?.[date] === 'boolean' ? challenge.dailyOpen[date] : true]));
    const attempts = records.docs.map(d => d.data()).filter(a => a.challengeId === c.id);
    tx.update(c.ref, { dailyOpen, 'stats.dailyPlayers': dailyStats(attempts, challenge, dates, timeZone), updatedAt: FieldValue.serverTimestamp() });
  }
  writeAudit(EVENT_ID, { entity: 'challenge', entityId: 'daily-release', action: 'challenge.dailyRelease', before: current.data() ?? null,
    after: rewards, reason: '主辦要求每日開放攤位、單日完成資格與每日名單' }, tx);
});
for (const player of ps.docs) await db().runTransaction(async tx => {
  const [r, cs, as] = await Promise.all([tx.get(config), tx.get(base.collection('challenges')), tx.get(base.collection('attempts').where('playerId', '==', player.id))]);
  const qualification = dailyQualification(as.docs.map(d => d.data()), cs.docs.map(d => ({ ...d.data(), challengeId: d.id })), r.data());
  const challengeDays = Object.fromEntries(Object.entries(qualification).map(([date, p]) => [date, { completedChallengeIds: p.done, requiredChallengeIds: p.required, entries: p.entries }]));
  tx.update(player.ref, { challengeDays, luckyDrawRuleVersion: rewards.version, luckyDrawEntries: Object.values(challengeDays).reduce((n, d) => n + d.entries, 0) });
});
console.log(JSON.stringify({ success: true, project, head, dates, playersRecalculated: ps.size, attemptsPreserved: ats.size }));
