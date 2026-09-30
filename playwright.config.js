/**
 * Playwright 設定
 * ------------------------------------------------------------------
 * 規格：docs/08-UI規範與前端架構.md §8.3
 *
 * 賽務端一律以手機視窗測——現場沒有人用桌機記分。
 * webServer 用自己的一支 Node 靜態伺服器（scripts/dev-server.mjs）：
 * 純靜態站不需要任何建置步驟，少一個會壞的環節。
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.E2E_PORT || 5187);
const ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * 預設使用 lockfile 的 Playwright Chromium；本機替代版本必須明確指定。
 */
function launch() {
  if (process.env.CI && process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    throw new Error('CI must use the Chromium build installed by the lockfile Playwright version');
  }
  return process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } } : {};
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.FEDA_MUTATION_RUN ? 0 : (process.env.CI ? 1 : 0),
  outputDir: process.env.E2E_OUTPUT_DIR || 'test-results/e2e',
  // ⚠️ 本機也要**明確限制**併發數，不能留 undefined（Playwright 會用一半的核心數）。
  //    套件長到四百多條之後，核心多的機器會同時開太多分頁，Windows 的暫時埠
  //    被 TIME_WAIT 吃光，瀏覽器端丟 ERR_NO_BUFFER_SPACE——表現成隨機一條
  //    測試在 page.goto 就掛掉，看起來像那條測試壞了。
  //    3 個 worker 在 8 核機器上跑完整套約兩分鐘，夠快也夠穩。
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // 一般 UI 測試以 page.route 提供 Firebase 替身，SW 的 fetch 會繞過它。
    // prelaunch.spec 明確開啟 SW，改用 context.route 驗證真實離線生命週期。
    serviceWorkers: 'block',
    trace: process.env.FEDA_MUTATION_RUN ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei'
  },

  projects: [
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'], ...launch() } },
    // 賽務端也在桌機跑一次：現場偶爾會有人用筆電當記錄台
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], ...launch() } },
    // 320px：iPhone SE 一代與各種便宜 Android 的實際寬度。
    // 設計基準是 360px，但這一档不能破版——現場真的有人拿這種手機來記分。
    {
      name: 'chromium-320',
      use: {
        ...devices['Pixel 7'],
        ...launch(),
        viewport: { width: 320, height: 568 }
      }
    }
  ],

  webServer: {
    // ⚠️ 不要換回 `python3 -m http.server`。它在 Windows 上每個連線開一條
    //    執行緒，套件長到四百多條之後會出現 WinError 10053，表現成隨機一條
    //    測試在 waitForFunction 逾時——看起來像那條測試壞了，其實是伺服器。
    command: `"${process.execPath}" scripts/dev-server.mjs ${PORT}`,
    cwd: ROOT,
    port: PORT,
    reuseExistingServer: false,
    timeout: 20_000
  }
});
