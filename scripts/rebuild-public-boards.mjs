#!/usr/bin/env node
/** 明確指定環境；預設唯讀盤點。--apply 先備份及留稽核，再依現存來源重建兩張公開看板。 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EVENT_ID } from '../js/config.js';
const env = process.argv.find(a => a.startsWith('--env='))?.slice(6);
if (!['demo', 'prod'].includes(env)) throw new Error('請指定 --env=demo 或 --env=prod');
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error('雲端修復不可同時指定模擬器');
process.env.GCLOUD_PROJECT = env === 'prod' ? 'feda-cup-2026' : 'feda-cup-demo';
const { db } = await import('../functions/admin.js');
const { rebuildBoardsFor } = await import('../functions/pipeline.js');
const database = db(), base = database.doc(`events/${EVENT_ID}`);
const [teamSnap, matchSnap, divisionSnap, boardSnaps] = await Promise.all([
  base.collection('teams').get(), base.collection('matches').get(), base.collection('divisions').get(),
  database.getAll(base.collection('boards').doc('scorers'), base.collection('boards').doc('fairplay'))
]);
const teams = new Set(teamSnap.docs.map(d => d.id));
const before = Object.fromEntries(boardSnaps.map(s => [s.id, s.exists ? s.data() : null]));
const summary = { env, project: database.projectId, eventId: EVENT_ID, teams: teamSnap.size, matches: matchSnap.size,
  boards: Object.fromEntries(Object.entries(before).map(([id, b]) => [id, { rows: b?.rows?.length || 0,
    missingTeams: (b?.rows || []).filter(r => !teams.has(r.teamId)).length }])) };
console.log(JSON.stringify(summary));
if (process.argv.includes('--apply')) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const directory = resolve('tools', 'backups');
  await mkdir(directory, { recursive: true });
  const backup = resolve(directory, `public-boards-${env}-${stamp}.json`);
  await writeFile(backup, JSON.stringify({ summary, before }, null, 2), { flag: 'wx' });
  const audit = { entity: 'boards', entityId: 'scorers,fairplay',
    actor: { uid: null, name: '公開統計修復', source: 'maintenance' },
    reason: '依主辦要求移除已不存在的來源並重建公開統計；原始比賽、球隊、名冊不刪除' };
  await base.collection('audits').add({ ...audit, action: 'boards.rebuild.started', before, createdAt: new Date() });
  const divisionIds = new Set([...divisionSnap.docs.map(d => d.id),
    ...Object.values(before).flatMap(b => (b?.rows || []).map(r => r.divisionId)).filter(Boolean)]);
  for (const divisionId of divisionIds) await rebuildBoardsFor({ eventId: EVENT_ID, divisionId });
  const afterSnaps = await database.getAll(...boardSnaps.map(s => s.ref));
  const after = Object.fromEntries(afterSnaps.map(s => [s.id, s.data()]));
  await base.collection('audits').add({ ...audit, action: 'boards.rebuild.completed', before, after, createdAt: new Date() });
  console.log(JSON.stringify({ backup, after: Object.fromEntries(Object.entries(after).map(([id, b]) => [id, b.rows.length])) }));
} else console.log('唯讀盤點完成；加 --apply 才會重建。');
