#!/usr/bin/env node
/**
 * 教學卡 → PDF（docs/cards/*.html → docs/cards/*.pdf）
 * ------------------------------------------------------------------
 * 用專案已經有的 Playwright Chromium 列印，不裝別的套件。
 *   node scripts/make-cards.mjs          產生三張 PDF
 *   node scripts/make-cards.mjs --check  只檢查 PDF 是否存在且比 HTML 新
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'cards');
const CARDS = ['scorer', 'checkin', 'booth'];

if (process.argv.includes('--check')) {
  let bad = 0;
  for (const c of CARDS) {
    const html = path.join(DIR, `${c}.html`), pdf = path.join(DIR, `${c}.pdf`);
    if (!fs.existsSync(pdf) || fs.statSync(pdf).mtimeMs < fs.statSync(html).mtimeMs) {
      console.error(`❌ ${c}.pdf 不存在或比 ${c}.html 舊`); bad++;
    }
  }
  console.log(bad ? `${bad} 張要重新產生：node scripts/make-cards.mjs` : '✅ 三張教學卡的 PDF 都是最新的');
  process.exit(bad ? 1 : 0);
}

const browser = await chromium.launch();
try {
  for (const c of CARDS) {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(path.join(DIR, `${c}.html`)).href, { waitUntil: 'load' });
    await page.pdf({ path: path.join(DIR, `${c}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.close();
    console.log(`✅ docs/cards/${c}.pdf`);
  }
} finally {
  await browser.close();
}
