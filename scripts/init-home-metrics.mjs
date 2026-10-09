/** Release-time initialization only; repeat deployments preserve the original campaign clock. */
import { execFileSync } from 'node:child_process';
const project = process.argv.find(v => v.startsWith('--project='))?.slice(10);
if (!['feda-cup-demo', 'feda-cup-2026'].includes(project) || process.env.FIRESTORE_EMULATOR_HOST) throw Error('Explicit cloud project required');
process.env.GCLOUD_PROJECT = project;
const { db } = await import('../functions/admin.js');
const { HOME_METRICS } = await import('../js/engine/home-metrics.js');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const startText = process.argv.find(v => v.startsWith('--start='))?.slice(8);
const startedAtMs = startText ? Date.parse(startText) : Date.now();
if (!Number.isSafeInteger(startedAtMs) || startedAtMs >= HOME_METRICS.shareEndsAtMs) throw Error('Campaign must begin before Taipei Oct 12 midnight');
const database = db(); database.settings({ preferRest: true });
const base = database.doc('events/feda-cup-2026');
const ref = base.collection('homeMetrics').doc('settings');
if (!(await base.get()).exists) throw Error('Event does not exist');
const proposed = { shareStartedAtMs: startedAtMs, shareEndsAtMs: HOME_METRICS.shareEndsAtMs,
  trafficOffset: HOME_METRICS.offset, shareBase: HOME_METRICS.shareBase, shareStep: HOME_METRICS.shareStep,
  shareIntervalMs: HOME_METRICS.shareIntervalMs, releaseCommit: commit };
let result;
if (process.argv.includes('--apply')) {
  result = await database.runTransaction(async tx => {
    const existing = await tx.get(ref);
    if (existing.exists) return { changed: false, settings: existing.data() };
    tx.create(ref, proposed); return { changed: true, settings: proposed };
  });
} else { const existing = await ref.get(); result = { changed: false, dryRun: true, settings: existing.exists ? existing.data() : proposed }; }
console.log(JSON.stringify({ project, ...result, startedAtTaipei: new Date(result.settings.shareStartedAtMs).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }) }));
await database.terminate();
