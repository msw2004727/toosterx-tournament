#!/usr/bin/env node
/**
 * 版號遞增｜格式 0.YYYYMMDD{suffix}（台北時間）
 * ------------------------------------------------------------------
 * 同步四處：
 *   1. js/config.js   #CACHE_VERSION
 *   2. sw.js          #CACHE_NAME
 *   3. index.html     window.__APP_VERSION__
 *   4. index.html     asset query 版號（?v=）
 *   5. package.json   version（純粹避免 npm 顯示舊版造成誤判）
 *
 * 用法：
 *   node scripts/bump-version.js          遞增
 *   node scripts/bump-version.js --check  只檢查四處是否一致（CI 用）
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILES = { config: 'js/config.js', sw: 'sw.js', html: 'index.html', pkg: 'package.json' };
const read  = f => readFileSync(f, 'utf8');
const write = (f, s) => writeFileSync(f, s, 'utf8');

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replaceAll('-', '');

const currentOf = {
  config: () => read(FILES.config).match(/CACHE_VERSION\s*=\s*'([^']+)'/)?.[1],
  sw:     () => read(FILES.sw).match(/CACHE_NAME\s*=\s*'feda-cup-([^']+)'/)?.[1],
  html:   () => read(FILES.html).match(/__APP_VERSION__\s*=\s*'([^']+)'/)?.[1],
  pkg:    () => JSON.parse(read(FILES.pkg)).version
};

function check() {
  const v = Object.entries(currentOf).map(([k, fn]) => [k, fn()]);
  const set = new Set(v.map(([, x]) => x));
  const queryVersions = new Set([...read(FILES.html).matchAll(/\?v=([0-9.a-z]+)/g)].map(m => m[1]));
  if (set.size !== 1 || queryVersions.size !== 1 || !set.has([...queryVersions][0])) {
    console.error('❌ 版號不一致：', Object.fromEntries(v), '｜asset query:', [...queryVersions]);
    process.exit(1);
  }
  console.log('✅ 版號一致：', [...set][0]);
}

function next(cur) {
  const d = today();
  if (!cur?.startsWith(`0.${d}`)) return `0.${d}`;
  const suffix = cur.slice(`0.${d}`.length);
  if (!suffix) return `0.${d}a`;
  const c = suffix.charCodeAt(0);
  if (c >= 122) throw new Error('同一天已用到 z，請隔日再 bump');
  return `0.${d}${String.fromCharCode(c + 1)}`;
}

if (process.argv.includes('--check')) { check(); process.exit(0); }

const cur = currentOf.config();
const ver = next(cur);

write(FILES.config, read(FILES.config).replace(/CACHE_VERSION\s*=\s*'[^']+'/, `CACHE_VERSION = '${ver}'`));
write(FILES.sw,     read(FILES.sw).replace(/CACHE_NAME\s*=\s*'feda-cup-[^']+'/, `CACHE_NAME = 'feda-cup-${ver}'`));
write(FILES.html,   read(FILES.html)
  .replace(/__APP_VERSION__\s*=\s*'[^']+'/, `__APP_VERSION__ = '${ver}'`)
  .replace(/\?v=[0-9.a-z]+/g, `?v=${ver}`));
write(FILES.pkg,    read(FILES.pkg).replace(/("version":\s*")[^"]+(")/, `$1${ver}$2`));

console.log(`✅ ${cur} → ${ver}`);
