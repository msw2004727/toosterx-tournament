/**
 * Playwright 設定
 * ------------------------------------------------------------------
 * 規格：docs/08-UI規範與前端架構.md §8.3
 *
 * 賽務端一律以手機視窗測——現場沒有人用桌機記分。
 * webServer 用 python 的靜態伺服器：純靜態站不需要任何建置步驟，
 * 少一個會壞的環節。
 */
import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const PORT = 5173;

/**
 * 有些環境（含本專案的開發沙箱）已預裝 Chromium，但版本與 @playwright/test
 * 期待的建置編號不同，預設會去下載新的。若偵測到系統已有 Chromium 就直接用，
 * 免得每次跑測試都要下載幾百 MB。
 */
function launch() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  return found ? { launchOptions: { executablePath: found } } : {};
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei'
  },

  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], ...launch() } },
    // 賽務端也在桌機跑一次：現場偶爾會有人用筆電當記錄台
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...launch() } }
  ],

  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000
  }
});
