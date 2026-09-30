const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createSession, anchorLocation, writeSource } = require('./mutation-session.cjs');

const hash = value => createHash('sha256').update(value).digest('hex');
function selectMutants(mutants, ids) {
  const known = new Set();
  for (const m of mutants) {
    if (!m.id || known.has(m.id)) throw new Error(`missing/duplicate ID: ${m.id}`);
    known.add(m.id);
    if (!m.spec || !m.grep || !m.failure || !m.minTests) throw new Error(`missing mapping: ${m.id}`);
    const source = fs.readFileSync(m.spec, 'utf8');
    if (m.assertions?.length) {
      m.expectedLocations = m.assertions.flatMap(assertion => {
        const locations = [];
        for (let at = source.indexOf(assertion); at >= 0; at = source.indexOf(assertion, at + 1)) {
          locations.push({ file: path.resolve(m.spec), start: source.slice(0, at).split('\n').length,
            end: source.slice(0, at + assertion.length).split('\n').length });
        }
        if (!locations.length) throw new Error(`missing assertion contract: ${m.id}: ${assertion}`);
        return locations;
      });
    } else if (!source.includes(m.failure)) throw new Error(`missing assertion contract: ${m.id}`);
  }
  if (!ids) return mutants;
  const selected = ids.split(',');
  if (new Set(selected).size !== selected.length) throw new Error('duplicate selected ID');
  for (const id of selected) if (!known.has(id)) throw new Error(`unknown ID: ${id}`);
  return mutants.filter(m => selected.includes(m.id));
}
function testsIn(report) {
  const out = [];
  function walk(suites) {
    for (const suite of suites || []) {
      for (const spec of suite.specs || []) for (const test of spec.tests || []) {
        out.push({ key: `${spec.file}:${spec.title}:${test.projectName}`, title: spec.title, file: spec.file, ...test });
      }
      walk(suite.suites);
    }
  }
  walk(report.suites);
  return out;
}
function classify({ report, processResult, contract, baselineKeys = null, baseline = false }) {
  const abnormal = reason => ({ classification: 'test_environment_error', reason });
  if (processResult.error || processResult.signal || processResult.timedOut || processResult.aborted)
    return abnormal('process did not complete normally');
  if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors)) return abnormal('missing/malformed report');
  if (report.errors.length) return abnormal('report contains setup/worker/global errors');
  let tests;
  try { tests = testsIn(report); } catch { return abnormal('malformed nested test report'); }
  if (tests.length < contract.minTests) return abnormal('zero tests or expected tests not executed');
  const keys = tests.map(t => t.key).sort();
  if (new Set(keys).size !== keys.length) return abnormal('duplicate test records');
  if (baselineKeys && JSON.stringify(keys) !== JSON.stringify(baselineKeys)) return abnormal('test selection changed from baseline');
  const failures = [];
  for (const t of tests) {
    if (t.expectedStatus !== 'passed' || t.results?.length !== 1) return abnormal('skipped/expected-failure/retried test');
    const result = t.results[0];
    if (result.status === 'passed' && !(result.errors || []).length) continue;
    if (baseline) return abnormal('normal baseline failed');
    if (result.status !== 'failed') return abnormal(`test infrastructure status: ${result.status}`);
    const errors = result.errors || (result.error ? [result.error] : []);
    if (!errors.length) return abnormal('failed test without assertion evidence');
    for (const error of errors) {
      const message = error.message || '';
      // An assertion-level wait is allowed. A whole test/worker timeout is not.
      const expected = contract.expectedLocations?.length
        ? contract.expectedLocations.some(l => error.location && path.resolve(error.location.file) === l.file
          && error.location.line >= l.start && error.location.line <= l.end)
        : message.includes(contract.failure);
      if (!expected || !/expect\(/.test(message)
          || /Test timeout of|Worker process exited|browserType\.launch|Target .*closed/.test(message))
        return abnormal('unrelated failure or missing expected defect assertion');
      failures.push({ test: t.key, message });
    }
  }
  if (!failures.length) {
    if (processResult.exitCode !== 0) return abnormal('exit code disagrees with passing report');
    return { classification: baseline ? 'baseline_passed' : 'survived', reason: 'all selected tests passed', keys };
  }
  if (processResult.exitCode !== 1) return abnormal('unexpected process exit code');
  return { classification: 'caught', reason: 'expected defect assertion failed; no unrelated errors', failures, keys };
}

function runProcess({ executable, args, cwd, env, directory, timeoutMs = 180000, abortSignal }) {
  fs.mkdirSync(directory, { recursive: true });
  const start = Date.now();
  return new Promise(resolve => {
    const stdout = fs.createWriteStream(path.join(directory, 'stdout.log'));
    const stderr = fs.createWriteStream(path.join(directory, 'stderr.log'));
    const child = spawn(executable, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' });
    let timedOut = false, aborted = false, error = null, settled = false, forceTimer = null;
    function stop() {
      if (!child.pid || settled) return;
      // Only this invocation's child and its descendants are eligible for cleanup.
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', e => { error ||= e.message; child.kill(); });
        killer.on('close', code => { if (code !== 0 && !settled) { error ||= `process tree cleanup failed: ${code}`; child.kill(); } });
        forceTimer ||= setTimeout(() => { if (!settled) { error ||= 'process tree cleanup did not finish'; child.kill(); } }, 2000);
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') error ||= e.message; }
        forceTimer ||= setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000);
      }
    }
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    for (const stream of [stdout, stderr]) stream.on('error', e => { error ||= `log output: ${e.message}`; stop(); });
    const abort = () => { aborted = true; stop(); };
    abortSignal?.addEventListener('abort', abort, { once: true });
    if (abortSignal?.aborted) abort();
    child.stdout?.pipe(stdout); child.stderr?.pipe(stderr);
    child.on('error', e => { error = e.message; });
    child.on('close', async (exitCode, signal) => {
      settled = true; clearTimeout(timer); clearTimeout(forceTimer); abortSignal?.removeEventListener('abort', abort);
      await Promise.all([stdout, stderr].map(stream => new Promise(done => {
        if (stream.writableFinished || stream.destroyed) return done();
        stream.once('finish', done); stream.once('error', done); stream.end();
      })));
      resolve({ executable, args, cwd, exitCode, signal, timedOut, aborted, error, durationMs: Date.now() - start });
    });
  });
}

async function runE2EMutants({ mutants, ids, outputRoot = 'test-results/mutation-e2e', timeoutMs = 180000 }) {
  if (process.env.MUTATION_FILTER) throw new Error('E2E uses exact --only ID1,ID2; MUTATION_FILTER is unsupported');
  mutants = selectMutants(mutants, ids);
  const cwd = process.cwd();
  const paths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const sourceHash = hash([...new Set(paths)].sort().map(f => `${f}\0${hash(fs.readFileSync(f))}`).join('\n'));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  const root = path.resolve(outputRoot, runId);
  fs.mkdirSync(root, { recursive: true });
  const session = createSession(mutants.map(m => m.file));
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(sig, interrupt);
  const config = { head, sourceHash, node: process.version, playwright: require('@playwright/test/package.json').version,
    chromiumPath: process.env.PLAYWRIGHT_CHROMIUM_PATH || require('playwright').chromium.executablePath(), port: process.env.E2E_PORT || '5187',
    browserOverride: !!process.env.PLAYWRIGHT_CHROMIUM_PATH,
    retries: 0, project: 'chromium-mobile', timeoutMs, runId };
  fs.writeFileSync(path.join(root, 'configuration.json'), JSON.stringify(config, null, 2));
  const baselines = new Map(), results = [];
  async function execute(m, directory, baseline, baselineKeys) {
    const reportPath = path.join(directory, 'report.json');
    const args = [require.resolve('@playwright/test/cli'), 'test', m.spec, '--project=chromium-mobile',
      '--grep', m.grep, '--retries=0', '--workers=1', '--reporter=json'];
    const processResult = await runProcess({ executable: process.execPath, args, cwd, directory, timeoutMs,
      abortSignal: controller.signal, env: { ...process.env, ...session.env,
        PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath, E2E_OUTPUT_DIR: path.join(directory, 'artifacts'),
        E2E_DIAGNOSTICS: '1', FORCE_COLOR: '0' } });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* classification is conservative */ }
    const result = { id: m.id, source: m.file, selection: { spec: m.spec, grep: m.grep, failure: m.failure },
      config, process: processResult, ...classify({ report, processResult, contract: m, baselineKeys, baseline }) };
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2));
    return result;
  }
  try {
    for (const m of mutants) {
      if (controller.signal.aborted) break;
      const original = session.backups.get(m.file).toString('utf8');
      let position;
      try { position = anchorLocation(original, m); }
      catch (e) {
        const r = { id: m.id, classification: 'anchor_invalid', reason: e.message }; results.push(r);
        fs.mkdirSync(path.join(root, m.id), { recursive: true });
        fs.writeFileSync(path.join(root, m.id, 'result.json'), JSON.stringify({ ...r, config }, null, 2));
        console.log(`${m.id}: ${r.classification}: ${r.reason}`); continue;
      }
      const selectionKey = hash(JSON.stringify({ spec: m.spec, grep: m.grep, config }));
      if (!baselines.has(selectionKey)) {
        const baseline = await execute(m, path.join(root, `baseline-${m.id}`), true);
        baselines.set(selectionKey, baseline);
      }
      const baseline = baselines.get(selectionKey);
      if (baseline.classification !== 'baseline_passed') {
        results.push({ id: m.id, classification: 'test_environment_error', reason: `invalid baseline: ${baseline.reason}` });
        console.log(`${m.id}: invalid baseline`); break;
      }
      let result;
      try {
        writeSource(m.file, original.slice(0, position) + m.to + original.slice(position + m.from.length));
        result = await execute(m, path.join(root, m.id), false, baseline.keys);
      } finally { writeSource(m.file, session.backups.get(m.file)); }
      results.push(result);
      console.log(`${m.id}: ${result.classification} (${(result.process.durationMs / 1000).toFixed(1)}s): ${result.reason}`);
    }
  } finally {
    let restorationError = null;
    try { session.dispose(); } catch (e) { restorationError = e.message; }
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.removeListener(sig, interrupt);
    const summary = { config, restorationError, selected: mutants.map(m => m.id), results, complete: !restorationError && results.length === mutants.length,
      counts: results.reduce((a, r) => { a[r.classification] = (a[r.classification] || 0) + 1; return a; }, {}) };
    fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`Evidence: ${root}`);
    if (restorationError) throw new Error(`source restoration failed: ${restorationError}`);
  }
  return results.length === mutants.length && results.every(r => r.classification === 'caught') ? 0 : 1;
}
module.exports = { selectMutants, testsIn, classify, runProcess, runE2EMutants };
