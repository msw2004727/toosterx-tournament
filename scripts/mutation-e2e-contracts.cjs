// Exact test selection and expected assertion contracts.
module.exports = {
  EADDOVERLAP: {spec:'tests/e2e/team-player-add.spec.js',grep:'ADD-LAYOUT',minTests:2,failure:'toBeLessThanOrEqual',
    assertions:['expect(removeBounds.y+removeBounds.height).toBeLessThanOrEqual(fieldsBounds.y);']},
  EADDROW: {spec:'tests/e2e/team-player-add.spec.js',grep:'ADD-UI',minTests:1,failure:'toHaveCount',
    assertions:["await expect(dialog(page).locator('.adm__newPlayer')).toHaveCount(2);"]},
  EADDRECEIPT: {spec:'tests/e2e/team-player-add.spec.js',grep:'ADD-RECEIPT',minTests:1,failure:'toContainText',
    assertions:["await expect(dialog(page).getByRole('alert')).toContainText('尚未確認');"]},
  ESTAFFMIDNIGHT: { spec:'tests/e2e/staff-dates.spec.js', grep:'STAFF-MIDNIGHT', minTests:1, failure:'toHaveAttribute',
    assertions:["await expect(tab(page, 10)).toHaveAttribute('aria-selected', 'true');"] },
  ESTAFFACTIVE: { spec:'tests/e2e/staff-dates.spec.js', grep:'STAFF-AUTH', minTests:1, failure:'toBeVisible',
    assertions:["await expect(page.getByText('沒有賽務台權限', { exact: true })).toBeVisible();"] },
  ESTAFFLISTENER: { spec:'tests/e2e/staff-dates.spec.js', grep:'STAFF-MIDNIGHT', minTests:1, failure:'toEqual',
    assertions:["expect(listeners).toEqual(['myMatches:2026-10-10']);"] },
  ECOARSEBUTTON: { spec: 'tests/e2e/button-system.spec.js', grep: '球隊操作列完整.*dark', minTests: 1,
    failure: 'toBeGreaterThanOrEqual', assertions: ['expect(await contrast(primary)).toBeGreaterThanOrEqual(4.5)'] },
  ETM1: { spec: 'tests/e2e/team-management.spec.js', grep: '隊長只看到', minTests: 1,
    failure: 'toHaveCount', assertions: ["await expect(page.getByRole('button', { name: /公開組/ })).toHaveCount(0);"] },
  EICONNAVSTACK:{spec:'tests/e2e/appbar.spec.js',grep:'@iconnav',minTests:1,
    assertions:['expect(iconBounds.y+iconBounds.height).toBeLessThanOrEqual(bounds.y)'],failure:'expect(iconBounds.y+iconBounds.height).toBeLessThanOrEqual(bounds.y)'},
  EICONNAVTHEME:{spec:'tests/e2e/appbar.spec.js',grep:'@iconnav',minTests:1,
    assertions:['await expect(text).toBeVisible()'],failure:'await expect(text).toBeVisible()'},
  EVENUESTABLE:{spec:'tests/e2e/venue-map.spec.js',grep:'@venuestable',minTests:1,
    assertions:['expect(await page.evaluate(()=>window.__venueSourceWrites)).toBe(0)'],failure:'expect(await page.evaluate(()=>window.__venueSourceWrites)).toBe(0)'},
  EVENUERESIZE:{spec:'tests/e2e/venue-map.spec.js',grep:'@venuestable',minTests:1,
    assertions:["await expect(centre).toHaveAttribute('src',/taiyuan-abcd/)"],failure:"await expect(centre).toHaveAttribute('src',/taiyuan-abcd/)"},
  EVENUEHEADER: {spec:'tests/e2e/venue-map.spec.js',grep:'@venueheader',minTests:1,
    assertions:['await button.click();await expect(d).toBeVisible()'],failure:'await button.click();await expect(d).toBeVisible()' },
  EVENUEMAPSMOOTH: { spec:'tests/e2e/venue-map.spec.js',grep:'10/9 首張',minTests:1,
    assertions:["expect(await d.locator('.venue-map__track').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0.32s')"],
    failure:"expect(await d.locator('.venue-map__track').evaluate(e=>getComputedStyle(e).transitionDuration)).toBe('0.32s')" },
  EVENUEMAPVISUAL: { spec:'tests/e2e/venue-map.spec.js',grep:'10/9 首張',minTests:1,
    assertions:['expect(Math.round(dragPosition)).toBe(-60)'],failure:'expect(Math.round(dragPosition)).toBe(-60)' },
  EVENUEMAPDRAG: { spec:'tests/e2e/venue-map.spec.js',grep:'10/9 首張',minTests:1,
    assertions:["await expect.poll(()=>d.locator('.venue-map__track').evaluate(e=>parseFloat(e.style.getPropertyValue('--venue-offset')))).toBe(-60)"],
    failure:"await expect.poll(()=>d.locator('.venue-map__track').evaluate(e=>parseFloat(e.style.getPropertyValue('--venue-offset')))).toBe(-60)" },
  EVENUEMAPSWIPE: { spec:'tests/e2e/venue-map.spec.js', grep:'10/9 首張', minTests:1,
    assertions:["await expect(image).toHaveAttribute('src',/taiyuan-abcd/)"],
    failure:"await expect(image).toHaveAttribute('src',/taiyuan-abcd/)" },
  ECLOCKVALUE: { spec:'tests/e2e/event-editor.spec.js', grep:'@clockedit', minTests:2,
    assertions:["expect((await dump(page))[PATH].clock.addedTimeSec).toBe(150)"],
    failure:"expect((await dump(page))[PATH].clock.addedTimeSec).toBe(150)" },
  EMEDICALTAP: { spec: 'tests/e2e/challenge-seven.spec.js', grep: '@medicaltap', minTests: 1,
    assertions: ['await expect.poll(async () => (await attempts(page)).length).toBe(1)'],
    failure: 'await expect.poll(async () => (await attempts(page)).length).toBe(1)' },
  EEVENTRECEIPT: { spec: 'tests/e2e/event-editor.spec.js', grep: '錯誤保留草稿', minTests: 1,
    assertions: ["await expect(dlg(page).getByRole('alert')).toContainText('尚未確認')"],
    failure: "await expect(dlg(page).getByRole('alert')).toContainText('尚未確認')" },
  EEVENTSCROLL: { spec: 'tests/e2e/event-editor.spec.js', grep: '@eventscroll', minTests: 1,
    assertions: ['expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)'], failure: 'expect(bounds.bottom).toBeLessThanOrEqual(viewport.height)' },
  EPWAFALLBACK: { spec: 'tests/e2e/appbar.spec.js', grep: '@pwainstall', minTests: 1,
    assertions: ["await expect(page.getByRole('dialog')).toContainText('安裝到裝置')"],
    failure: "await expect(page.getByRole('dialog')).toContainText('安裝到裝置')" },
  EPWAPOSITION: { spec: 'tests/e2e/appbar.spec.js', grep: '@pwainstall', minTests: 1,
    assertions: ["await expect(page.locator('.apphead__spacer + .apphead__venue + .apphead__install + a[data-nav]')).toHaveCount(1)"],
    failure: "await expect(page.locator('.apphead__spacer + .apphead__venue + .apphead__install + a[data-nav]')).toHaveCount(1)" },
  EFREQUENTSTAFFORDER: { spec: 'tests/e2e/my-home.spec.js', grep: '@frequentstaff', minTests: 1,
    assertions: ["await expect(buttons.first()).toContainText('賽務台')"], failure: "await expect(buttons.first()).toContainText('賽務台')" },
  EFREQUENTSTAFFCOLOR: { spec: 'tests/e2e/my-home.spec.js', grep: '@frequentstaff', minTests: 1,
    assertions: ['expect(colors[0]).not.toBe(colors[2])'], failure: 'expect(colors[0]).not.toBe(colors[2])' },
  EADJUDICATIONINPUT: { spec: 'tests/e2e/admin-match.spec.js', grep: '@matchdesign', minTests: 1,
    assertions: ['await expect(score).toBeFocused()'], failure: 'await expect(score).toBeFocused()' },
  EADJUDICATIONLAYOUT: { spec: 'tests/e2e/admin-match.spec.js', grep: '@matchdesign', minTests: 1,
    assertions: ['expect(desktopLayout.columns).toBe(2)'], failure: 'expect(desktopLayout.columns).toBe(2)' },
  ELIVECLOCKLOAD: { spec: 'tests/e2e/staff-console.spec.js', grep: '@clockload', minTests: 1,
    assertions: ["await expect.poll(() => page.locator('#match-clock').textContent()).not.toBe('00:00')"],
    failure: "await expect.poll(() => page.locator('#match-clock').textContent()).not.toBe('00:00')" },
  ELIVECLOCKDISPOSE: { spec: 'tests/e2e/staff-console.spec.js', grep: '@clocklifecycle', minTests: 1,
    assertions: ['expect(await page.evaluate(() => window.__clockIntervals.size)).toBe(1)'],
    failure: 'expect(await page.evaluate(() => window.__clockIntervals.size)).toBe(1)' },
  ESTANDTEAMWIDTH: { spec: 'tests/e2e/public-site.spec.js', grep: '@teamfade', minTests: 1,
    assertions: ['expect(before.statsInside).toBe(true)'], failure: 'expect(before.statsInside).toBe(true)' },
  ESTANDTEAMFADE: { spec: 'tests/e2e/public-site.spec.js', grep: '@teamfade', minTests: 1,
    assertions: ["expect(bounds.mask).toContain('linear-gradient')"],
    failure: "expect(bounds.mask).toContain('linear-gradient')" },
  EHOMEFINISH: { spec: 'tests/e2e/home-match-refresh.spec.js', grep: 'HOMEMATCHLIVE', minTests: 1,
    assertions: ["expect(score(page)).toHaveText('4-1')"], failure: "expect(score(page)).toHaveText('4-1')" },
  EHOMEFIELD: { spec: 'tests/e2e/home-match-refresh.spec.js', grep: 'HOMEMATCHPATCH', minTests: 1,
    assertions: ['expect(intact).toBe(true)'], failure: 'expect(intact).toBe(true)' },
  EHOMEONLINE: { spec: 'tests/e2e/home-match-refresh.spec.js', grep: 'HOMEMATCHRESUME', minTests: 1,
    assertions: ["expect(score(page)).toHaveText('5-2')"], failure: "expect(score(page)).toHaveText('5-2')" },
  "EHOMEDATE": { "spec": "tests/e2e/home-date.spec.js", "grep": "HOMEDATE.*2026-10-12", "assertions": ["expect(selected(page)).toContainText('10/' + day)"], "failure": "expect(selected(page)).toContainText('10/' + day)", "minTests": 1 },
  "EHOMEWATCH": { "spec": "tests/e2e/home-date.spec.js", "grep": "HOMEROLLOVER", "assertions": ["expect(selected(page)).toContainText('10/10')"], "failure": "expect(selected(page)).toContainText('10/10')", "minTests": 1 },
  "ECANCELRECEIPT": { "spec": "tests/e2e/admin-match.spec.js", "grep": "CANCELRECEIPT", "assertions": ["expect(page.locator('.toast--error')).toContainText('尚未確認撤銷開賽結果')"], "failure": "expect(page.locator('.toast--error')).toContainText('尚未確認撤銷開賽結果')", "minTests": 1 },
  EDEMOTIME: { spec: 'tests/e2e/demo-switch.spec.js', grep: 'Demo 可選測試日期', minTests: 1,
    failure: 'toContainText', assertions: ["await expect(page.locator('#demo-banner')).toContainText('10/10');"] },
  ECHECKPENDING: { spec: 'tests/e2e/checkin.spec.js', grep: 'CSV 待補資料可勾', minTests: 1,
    failure: 'toBeEnabled', assertions: ["await expect(page.getByLabel('小豆子 出賽', { exact: true })).toBeEnabled();"] },
  EDAILYCACHE: { spec: 'tests/e2e/challenge-days.spec.js', grep: '本機快取不完整', minTests: 2,
    failure: 'toContainText', assertions: ["await expect(page.locator('.chal__card--draw')).toContainText('離線資料，等待同步確認');"] },
  EMEMBERNAME: { spec: 'tests/e2e/admin-teams.spec.js', grep: '隊員更名 不完整回覆', minTests: 1,
    failure: 'toContainText', assertions: ["await expect(page.getByRole('alert')).toContainText('尚未確認');"] },
  EMANUALFORMAT: { spec: 'tests/e2e/admin-manual-schedule.spec.js', grep: '既有六隊', minTests: 1,
    failure: 'toContainText', assertions: ['await expect(issue).toContainText(`既有 9 場沿用賽制：${sixFormat.name}`);'] },
  EMANUALRESULT: { spec: 'tests/e2e/admin-manual-schedule.spec.js', grep: '不完整回應不假成功', minTests: 1,
    failure: 'toContainText', assertions: ["await expect(page.locator('.manual__failure')).toContainText('尚未確認');"] },
  ETEAMNAME1: { spec: 'tests/e2e/team-name.spec.js', grep: '不完整回覆不可', minTests: 1,
    failure: 'toContainText', assertions: ["await expect(page.getByRole('alert')).toContainText('尚未確認');"] },
  ETEAMNAME2: { spec: 'tests/e2e/team-name.spec.js', grep: '已核准鎖定球隊', minTests: 1,
    failure: 'toHaveCount', assertions: ["await expect(page.getByRole('dialog')).toHaveCount(0);"] },
  ESPONSOR1: { spec: 'tests/e2e/home-division-design.spec.js', grep: '首頁 A、固定六組色', minTests: 2,
    failure: 'Expected: < 1', assertions: ['expect(Math.abs(partners[0].top - partners[1].top)).toBeLessThan(1);'] },
  ELOGO1: { spec: 'tests/e2e/challenge.spec.js', grep: '公開首頁最上面有挑戰區入口', minTests: 1,
    failure: 'toBeLessThan', assertions: ['expect(y).toBeLessThan(600)'] },
  ESTREAM2: { spec: 'tests/e2e/stream-shares.spec.js', grep: '低階角色與非 LINE 登入', minTests: 1,
    failure: 'toBeVisible', assertions: ["await expect(page.getByRole('button', { name: '使用 LINE 登入', exact: true })).toBeVisible();"] },
  ESTREAM1: { spec: 'tests/e2e/stream-shares.spec.js', grep: '本人可移除自己的分享', minTests: 1,
    failure: 'toHaveCount', assertions: ["expect(page.locator('.pshares__remove')).toHaveCount(1)"] },
  ESOP4: { spec: 'tests/e2e/booth-sop.spec.js', grep: '七個玩法均顯示簡介', minTests: 1,
    failure: 'not.toContainText', assertions: ["expect(page.locator('.chal')).not.toContainText('中醫問診')"] },
  ESOP1: { spec: 'tests/e2e/booth-sop.spec.js', grep: '沒有內建辨識時相機', minTests: 1,
    failure: 'toBeEnabled', assertions: ["expect(page.getByRole('button', { name: '開啟相機掃描挑戰卡', exact: true })).toBeEnabled()"] },
  ESOP2: { spec: 'tests/e2e/booth-sop.spec.js', grep: '掃碼登入保留', minTests: 1,
    failure: 'toBe', assertions: ["expect(next).toBe(`/booth/${ids[5]}?id=${PID}`)"] },
  ESOP3: { spec: 'tests/e2e/booth-sop.spec.js', grep: 'CSV 下載重新讀取', minTests: 1,
    failure: 'toContain', assertions: ["expect.poll(() => page.evaluate(() => window.__CSV)).toContain('FEDA-0199')"] },
  E60: {spec:'tests/e2e/admin-match.spec.js',grep:'管理請求失敗保留原資料',minTests:1,
    failure:'尚未確認這次操作的結果',assertions:["expect(page.locator('.toast--error')).toContainText('尚未確認這次操作的結果')"]},
  "PRE1": {
    "spec": "tests/e2e/prelaunch.spec.js",
    "grep": "恢復登入延遲",
    "assertions": [
      "expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible()",
      "expect(page).toHaveURL(/#\\/admin\\/teams$/)"
    ],
    "failure": "expect(page.getByText('報名審核', { exact: true }).first()).toBeVisible()",
    "minTests": 1
  },
  "PRE2": {
    "spec": "tests/e2e/prelaunch.spec.js",
    "grep": "停用帳號",
    "assertions": [
      "expect(page.getByText(/沒有.*權限/).first()).toBeVisible()"
    ],
    "failure": "expect(page.getByText(/沒有.*權限/).first()).toBeVisible()",
    "minTests": 1
  },
  "PRE3": {
    "spec": "tests/e2e/prelaunch.spec.js",
    "grep": "切換帳號時",
    "assertions": [
      "expect(result).toEqual({ uid: 'visitor', allowed: false })"
    ],
    "failure": "expect(result).toEqual({ uid: 'visitor', allowed: false })",
    "minTests": 1
  },
  "EDISC1": {
    "spec": "tests/e2e/discipline.spec.js",
    "grep": "過期看板中的已刪除球隊",
    "assertions": [
      "expect(page.getByText('目前沒有可公布的紅黃牌統計', { exact: true })).toBeVisible()"
    ],
    "failure": "expect(page.getByText('目前沒有可公布的紅黃牌統計', { exact: true })).toBeVisible()",
    "minTests": 1
  },
  "EDISC2": {
    "spec": "tests/e2e/discipline.spec.js",
    "grep": "讀取失敗明示錯誤",
    "assertions": [
      "expect(page.getByText('統計資料暫時讀取失敗', { exact: true })).toBeVisible()"
    ],
    "failure": "expect(page.getByText('統計資料暫時讀取失敗', { exact: true })).toBeVisible()",
    "minTests": 1
  },
  "ERANK1": {
    "spec": "tests/e2e/home-division-design.spec.js",
    "grep": "首頁 A、",
    "assertions": [
      "expect(page.locator('#toast-root .toast:not(.is-leaving)')).toHaveText('請選擇組別查看排名')"
    ],
    "failure": "expect(page.locator('#toast-root .toast:not(.is-leaving)')).toHaveText('請選擇組別查看排名')",
    "minTests": 2
  },
  "ERANK2": {
    "spec": "tests/e2e/home-division-design.spec.js",
    "grep": "首頁 A、",
    "assertions": [
      "expect(page.locator('.pchips')).toBeInViewport({ratio:1})"
    ],
    "failure": "expect(page.locator('.pchips')).toBeInViewport({ratio:1})",
    "minTests": 2
  },
  "ERANK3": {
    "spec": "tests/e2e/home-division-design.spec.js",
    "grep": "首頁排名捷徑說明組別狀態：error",
    "assertions": [
      "expect(activeToast).toHaveText(message)"
    ],
    "failure": "expect(activeToast).toHaveText(message)",
    "minTests": 1
  },
  "EJER2": {
    "spec": "tests/e2e/jersey-public-teams.spec.js",
    "grep": "空背號可補 0 再清空",
    "assertions": [
      "expect(panel.y).toBeGreaterThanOrEqual(0)",
      "expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize().height)"
    ],
    "failure": "expect(panel.y).toBeGreaterThanOrEqual(0) OR expect(panel.y + panel.height).toBeLessThanOrEqual(page.viewportSize().height)",
    "minTests": 1
  },
  "EJER1": {
    "spec": "tests/e2e/jersey-public-teams.spec.js",
    "grep": "空背號可補 0 再清空",
    "assertions": [
      "expect(page.getByRole('alert')).toContainText('同隊已有球員使用 0 號')"
    ],
    "failure": "expect(page.getByRole('alert')).toContainText('同隊已有球員使用 0 號')",
    "minTests": 1
  },
  "EPUB1": {
    "spec": "tests/e2e/jersey-public-teams.spec.js",
    "grep": "報名關閉且無賽程積分榜",
    "assertions": [
      "expect(page.locator('.pteams__btn')).toHaveCount(1)"
    ],
    "failure": "expect(page.locator('.pteams__btn')).toHaveCount(1)",
    "minTests": 1
  },
  "EPUB2": {
    "spec": "tests/e2e/jersey-public-teams.spec.js",
    "grep": "讀取失敗獨立提示：讀不到球員名單",
    "assertions": [
      "expect(page.getByText(title, { exact: true })).toBeVisible()"
    ],
    "failure": "expect(page.getByText(title, { exact: true })).toBeVisible()",
    "minTests": 1
  },
  "E58": {
    "spec": "tests/e2e/home-division-design.spec.js",
    "grep": "單鍵主題循環、Toast",
    "assertions": [
      "expect(page.locator('#toast-root .toast:not(.is-leaving)').last()).toContainText(label)"
    ],
    "failure": "expect(page.locator('#toast-root .toast:not(.is-leaving)').last()).toContainText(label)",
    "minTests": 2
  },
  "E59": {
    "spec": "tests/e2e/home-division-design.spec.js",
    "grep": "首頁 A、",
    "assertions": [
      "expect(await tab.evaluate(n=>n.scrollWidth<=n.clientWidth+1 && n.getBoundingClientRect().right<=innerWidth)).toBe(true)"
    ],
    "failure": "expect(await tab.evaluate(n=>n.scrollWidth<=n.clientWidth+1 && n.getBoundingClientRect().right<=innerWidth)).toBe(true)",
    "minTests": 2
  },
  "E57": {
    "spec": "tests/e2e/button-system.spec.js",
    "grep": "球隊操作列完整.*dark",
    "assertions": [
      "expect(await contrast(danger)).toBeGreaterThanOrEqual(4.5)"
    ],
    "failure": "expect(await contrast(danger)).toBeGreaterThanOrEqual(4.5)",
    "minTests": 1
  },
  "E55": {
    "spec": "tests/e2e/mobile-rosters.spec.js",
    "grep": "名冊完整姓名",
    "failure": "[M:E55]",
    "minTests": 2
  },
  "E56": {
    "spec": "tests/e2e/mobile-rosters.spec.js",
    "grep": "名冊完整姓名",
    "failure": "[M:E56]",
    "minTests": 2
  },
  "E1": {
    "spec": "tests/e2e/demo-switch.spec.js",
    "grep": "切換身分之後權限真的生效",
    "assertions": [
      "expect(page.locator('.acct__roles')).toHaveText('記錄員')"
    ],
    "failure": "expect(page.locator('.acct__roles')).toHaveText('記錄員')",
    "minTests": 1
  },
  "E2": {
    "spec": "tests/e2e/demo-switch.spec.js",
    "grep": "切換之後身分卡有名字",
    "assertions": [
      "expect(card).not.toContainText('沒有名稱')"
    ],
    "failure": "expect(card).not.toContainText('沒有名稱')",
    "minTests": 1
  },
  "E3": {
    "spec": "tests/e2e/my-home.spec.js",
    "grep": "一般使用者只看到球隊",
    "assertions": [
      "expect(page.locator('.acct__card', { hasText: '我的功能' })).toHaveCount(0)"
    ],
    "failure": "expect(page.locator('.acct__card', { hasText: '我的功能' })).toHaveCount(0)",
    "minTests": 1
  },
  "E4": {
    "spec": "tests/e2e/admin-perms.spec.js",
    "grep": "關掉會寫進來源那一階",
    "assertions": [
      "expect(perms['match.score.write']).toBe(true)"
    ],
    "failure": "expect(perms['match.score.write']).toBe(true)",
    "minTests": 1
  },
  "E5": {
    "spec": "tests/e2e/admin-perms.spec.js",
    "grep": "關掉會寫進來源那一階",
    "assertions": [
      "expect(perms['match.score.write']).toBe(true)"
    ],
    "failure": "expect(perms['match.score.write']).toBe(true)",
    "minTests": 1
  },
  "E6": {
    "spec": "tests/e2e/perm-effect.spec.js",
    "grep": "主辦關掉「送出完賽」之後",
    "assertions": [
      "expect(page.getByRole('button', { name: /完賽送出/ })).toHaveCount(0)"
    ],
    "failure": "expect(page.getByRole('button', { name: /完賽送出/ })).toHaveCount(0)",
    "minTests": 1
  },
  "E7": {
    "spec": "tests/e2e/perm-effect.spec.js",
    "grep": "檢錄員沒有出場名單的權限",
    "assertions": [
      "expect(page.getByRole('button', { name: /確認出場名單/ })).toHaveCount(0)"
    ],
    "failure": "expect(page.getByRole('button', { name: /確認出場名單/ })).toHaveCount(0)",
    "minTests": 1
  },
  "E8": {
    "spec": "tests/e2e/perm-effect.spec.js",
    "grep": "關掉「看球員個資」之後",
    "assertions": [
      "expect(page.locator('.chk__verify').first()).toContainText('主辦已關閉個資顯示')"
    ],
    "failure": "expect(page.locator('.chk__verify').first()).toContainText('主辦已關閉個資顯示')",
    "minTests": 1
  },
  "E9": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "名單上印得出核對用的生日",
    "assertions": [
      "expect(row).toContainText('小豆子')"
    ],
    "failure": "expect(row).toContainText('小豆子')",
    "minTests": 1
  },
  "E10": {
    "spec": "tests/e2e/admin-audits.spec.js",
    "grep": "還沒同步的時間顯示",
    "assertions": [
      "expect(page.locator('.adm__audit').last()).toContainText('同步中')"
    ],
    "failure": "expect(page.locator('.adm__audit').last()).toContainText('同步中')",
    "minTests": 1
  },
  "E11": {
    "spec": "tests/e2e/admin-audits.spec.js",
    "grep": "四筆都列出來",
    "assertions": [
      "expect(page.locator('.adm__audit').first()).toContainText('核准了')",
      "expect(page.locator('.adm__audit').last()).toContainText('撤回了')"
    ],
    "failure": "expect(page.locator('.adm__audit').first()).toContainText('核准了') OR expect(page.locator('.adm__audit').last()).toContainText('撤回了')",
    "minTests": 1
  },
  "E12": {
    "spec": "tests/e2e/admin-audits.spec.js",
    "grep": "只有 staff 文件的人",
    "assertions": [
      "expect(item(page, 'Demo 管理員')).toHaveCount(1)"
    ],
    "failure": "expect(item(page, 'Demo 管理員')).toHaveCount(1)",
    "minTests": 1
  },
  "E13": {
    "spec": "tests/e2e/admin-registration.spec.js",
    "grep": "空白的截止日填得進去",
    "assertions": [
      "expect(page.locator('#reg-closes')).toHaveValue('115')"
    ],
    "failure": "expect(page.locator('#reg-closes')).toHaveValue('115')",
    "minTests": 1
  },
  "E14": {
    "spec": "tests/e2e/admin-registration.spec.js",
    "grep": "空白的截止日填得進去",
    "assertions": [
      "expect(page.locator('#reg-closes-d')).toHaveValue('25')"
    ],
    "failure": "expect(page.locator('#reg-closes-d')).toHaveValue('25')",
    "minTests": 1
  },
  "E15": {
    "spec": "tests/e2e/my-home.spec.js",
    "grep": "「我報名的球員」跨球隊",
    "assertions": [
      "expect(card).toContainText('我報名的球員（2）')",
      "expect(card).not.toContainText('別人家的')"
    ],
    "failure": "expect(card).toContainText('我報名的球員（2）') OR expect(card).not.toContainText('別人家的')",
    "minTests": 1
  },
  "E16": {
    "spec": "tests/e2e/admin-match.spec.js",
    "grep": "逾時的申訴要先講後果",
    "assertions": [
      "expect(page.locator('.modal')).toContainText('賽後三十分鐘內')"
    ],
    "failure": "expect(page.locator('.modal')).toContainText('賽後三十分鐘內')",
    "minTests": 1
  },
  "E17": {
    "spec": "tests/e2e/challenge.spec.js",
    "grep": "沒登入（只有手機上的快取）",
    "assertions": [
      "expect(page.locator('.chal__card--contact')).toContainText('登入', { timeout: 15_000 })"
    ],
    "failure": "expect(page.locator('.chal__card--contact')).toContainText('登入', { timeout: 15_000 })",
    "minTests": 1
  },
  "E18": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "名單上印得出核對用的生日",
    "assertions": [
      "expect(row).toContainText('小豆子')"
    ],
    "failure": "expect(row).toContainText('小豆子')",
    "minTests": 1
  },
  "E19": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-02 已登入的人",
    "assertions": [
      "expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/my')"
    ],
    "failure": "expect.poll(() => page.evaluate(() => location.hash), { timeout: 15_000 }).toBe('#/my')",
    "minTests": 1
  },
  "E20": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-04 現場代建的卡",
    "failure": "[M:E20]",
    "minTests": 1
  },
  "E21": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-03 「最近登錄」讀不到",
    "assertions": [
      "expect(page.locator('#booth-recent-error')).toBeVisible({ timeout: 15_000 })"
    ],
    "failure": "expect(page.locator('#booth-recent-error')).toBeVisible({ timeout: 15_000 })",
    "minTests": 1
  },
  "E22": {
    "spec": "tests/e2e/admin-schedule.spec.js",
    "grep": "SLOCK",
    "assertions": [
      "expect(page.getByRole('button', { name: '自動／逐場調整（已上鎖）' })).toBeDisabled()"
    ],
    "failure": "expect(page.getByRole('button', { name: '自動／逐場調整（已上鎖）' })).toBeDisabled()",
    "minTests": 1
  },
  "E23": {
    "spec": "tests/e2e/admin-match.spec.js",
    "grep": "D-12 棄賽鈕反灰時",
    "assertions": [
      "expect(page.locator('#walkover-reason')).toContainText('已取消')"
    ],
    "failure": "expect(page.locator('#walkover-reason')).toContainText('已取消')",
    "minTests": 1
  },
  "E24": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-13 攤位人員",
    "assertions": [
      "expect(page.getByRole('button', { name: '檢錄' })).toHaveCount(0)"
    ],
    "failure": "expect(page.getByRole('button', { name: '檢錄' })).toHaveCount(0)",
    "minTests": 1
  },
  "E25": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-14 找不到頁面",
    "assertions": [
      "expect(page).toHaveTitle(/找不到頁面/)"
    ],
    "failure": "expect(page).toHaveTitle(/找不到頁面/)",
    "minTests": 1
  },
  "E26": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-07 單節組別",
    "assertions": [
      "expect(page.locator('.psb__ht')).toHaveCount(0)"
    ],
    "failure": "expect(page.locator('.psb__ht')).toHaveCount(0)",
    "minTests": 1
  },
  "E27": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-15 主題切換鈕",
    "assertions": [
      "expect(box.height).toBeGreaterThanOrEqual(44)"
    ],
    "failure": "expect(box.height).toBeGreaterThanOrEqual(44)",
    "minTests": 1
  },
  "E28": {
    "spec": "tests/e2e/admin-match.spec.js",
    "grep": "D-06 重開退回最後打過的那一期",
    "assertions": [
      "expect((await matchOf(page)).period).toBe('h2')"
    ],
    "failure": "expect((await matchOf(page)).period).toBe('h2')",
    "minTests": 1
  },
  "E29": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-08 賽務台記進球",
    "assertions": [
      "expect(page.locator('.sheet__opt', { hasText: '林教練' })).toHaveCount(0)"
    ],
    "failure": "expect(page.locator('.sheet__opt', { hasText: '林教練' })).toHaveCount(0)",
    "minTests": 1
  },
  "E30": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-08 出場名單",
    "assertions": [
      "expect(names).toEqual(['小豆子', '阿光', '沒背號', '林教練'])"
    ],
    "failure": "expect(names).toEqual(['小豆子', '阿光', '沒背號', '林教練'])",
    "minTests": 1
  },
  "E31": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "D-08 出場名單",
    "assertions": [
      "expect(coach.getByRole('button', { name: '先發' })).toHaveCount(0)"
    ],
    "failure": "expect(coach.getByRole('button', { name: '先發' })).toHaveCount(0)",
    "minTests": 1
  },
  "E32": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "D-01b 名單讀不到",
    "assertions": [
      "expect(page.locator('#chk-roster-error')).toBeVisible({ timeout: 15_000 })"
    ],
    "failure": "expect(page.locator('#chk-roster-error')).toBeVisible({ timeout: 15_000 })",
    "minTests": 1
  },
  "E33": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "C-9 檢錄員可以從清單",
    "assertions": [
      "expect(sh).toContainText('檢錄')"
    ],
    "failure": "expect(sh).toContainText('檢錄')",
    "minTests": 1
  },
  "E34": {
    "spec": "tests/e2e/booth.spec.js",
    "grep": "手機相機掃到玩家的 QR",
    "assertions": [
      "expect(page.locator('.booth__nick')).toContainText('阿哲', { timeout: 15_000 })"
    ],
    "failure": "expect(page.locator('.booth__nick')).toContainText('阿哲', { timeout: 15_000 })",
    "minTests": 1
  },
  "E35": {
    "spec": "tests/e2e/challenge.spec.js",
    "grep": "沒登入開 #/challenge/join",
    "assertions": [
      "expect(page.locator('.chal__login')).toBeVisible({ timeout: 15_000 })"
    ],
    "failure": "expect(page.locator('.chal__login')).toBeVisible({ timeout: 15_000 })",
    "minTests": 1
  },
  "E36": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "R-1 生日只打了年",
    "assertions": [
      "expect(page.locator('#m-birth')).toHaveValue('106')"
    ],
    "failure": "expect(page.locator('#m-birth')).toHaveValue('106')",
    "minTests": 1
  },
  "E37": {
    "spec": "tests/e2e/register.spec.js",
    "grep": "系統退件的成員留在名單頁上",
    "assertions": [
      "expect(box).toBeVisible()"
    ],
    "failure": "expect(box).toBeVisible()",
    "minTests": 1
  },
  "E38": {
    "spec": "tests/e2e/register.spec.js",
    "grep": "隊職員的表單沒有背號欄",
    "assertions": [
      "expect(page.locator('#m-no')).toHaveCount(0)"
    ],
    "failure": "expect(page.locator('#m-no')).toHaveCount(0)",
    "minTests": 1
  },
  "E39": {
    "spec": "tests/e2e/register.spec.js",
    "grep": "背號撞號在「加入名單」",
    "assertions": [
      "expect(page.locator('.reg__hint--err')).toContainText('背號 9 已經是「小豆子」的了')"
    ],
    "failure": "expect(page.locator('.reg__hint--err')).toContainText('背號 9 已經是「小豆子」的了')",
    "minTests": 1
  },
  "E40": {
    "spec": "tests/e2e/register.spec.js",
    "grep": "草稿可以由隊長自己取消",
    "assertions": [
      "expect.poll(async () => (await dump(page))[`events/${EVENT}/teams/${TEAM}`]?.status, { timeout: 10_000 }).toBe('withdrawn')"
    ],
    "failure": "expect.poll(async () => (await dump(page))[`events/${EVENT}/teams/${TEAM}`]?.status, { timeout: 10_000 }).toBe('withdrawn')",
    "minTests": 1
  },
  "E41": {
    "spec": "tests/e2e/register.spec.js",
    "grep": "同一帳號已經有一筆待審申請時",
    "assertions": [
      "expect(page.locator('.reg__box--warn')).toContainText('已經有一筆待審的申請')"
    ],
    "failure": "expect(page.locator('.reg__box--warn')).toContainText('已經有一筆待審的申請')",
    "minTests": 1
  },
  "E42": {
    "spec": "tests/e2e/register.spec.js",
    "grep": "送出後被系統退件，原因留在加入頁",
    "assertions": [
      "expect(page.locator('#join-rejected')).toContainText('已經有一筆待審的申請')"
    ],
    "failure": "expect(page.locator('#join-rejected')).toContainText('已經有一筆待審的申請')",
    "minTests": 1
  },
  "E43": {
    "spec": "tests/e2e/admin-match.spec.js",
    "grep": "頁首印出目前比分，含 PK",
    "assertions": [
      "expect(page.locator('#match-score-now')).toContainText('PK 4:3')"
    ],
    "failure": "expect(page.locator('#match-score-now')).toContainText('PK 4:3')",
    "minTests": 1
  },
  "E44": {
    "spec": "tests/e2e/admin-schedule.spec.js",
    "grep": "SMANUAL",
    "assertions": [
      "expect(page.locator('.manual__workspace')).toBeVisible()"
    ],
    "failure": "expect(page.locator('.manual__workspace')).toBeVisible()",
    "minTests": 1
  },
  "E45": {
    "spec": "tests/e2e/booth.spec.js",
    "grep": "代建新卡：系統配號",
    "failure": "[M:E45]",
    "minTests": 1
  },
  "E46": {
    "spec": "tests/e2e/my-home.spec.js",
    "grep": "「我的球隊」點進去是管理頁",
    "assertions": [
      "expect(page).toHaveURL(/team\\/t-1\\/manage/)"
    ],
    "failure": "expect(page).toHaveURL(/team\\/t-1\\/manage/)",
    "minTests": 1
  },
  "E47": {
    "spec": "tests/e2e/booth.spec.js",
    "grep": "B-5 作廢要選原因",
    "assertions": [
      "expect(page.locator('.sheet')).toBeVisible()"
    ],
    "failure": "expect(page.locator('.sheet')).toBeVisible()",
    "minTests": 1
  },
  "E48": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "C-3 標了「有問題」",
    "assertions": [
      "expect(row.locator('.chk__box')).toBeDisabled()"
    ],
    "failure": "expect(row.locator('.chk__box')).toBeDisabled()",
    "minTests": 1
  },
  "E49": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "C-5 只勾 1 人",
    "assertions": [
      "expect(page.locator('#chk-finish')).toBeDisabled()"
    ],
    "failure": "expect(page.locator('#chk-finish')).toBeDisabled()",
    "minTests": 1
  },
  "E50": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "C-5 人數夠了才按得下去",
    "assertions": [
      "expect.poll(async () => (await matchDoc(page))?.checkin?.homeConfirmed ?? null, { timeout: 10_000 }).toBe(true)"
    ],
    "failure": "expect.poll(async () => (await matchDoc(page))?.checkin?.homeConfirmed ?? null, { timeout: 10_000 }).toBe(true)",
    "minTests": 1
  },
  "E51": {
    "spec": "tests/e2e/checkin.spec.js",
    "grep": "C-5 管理員可以在人數不足時放行",
    "assertions": [
      "expect(page.locator('.modal')).toHaveCount(0)"
    ],
    "failure": "expect(page.locator('.modal')).toHaveCount(0)",
    "minTests": 1
  },
  "E52": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "S-5 換人選單分得出場上與場下",
    "assertions": [
      "expect(dlg.locator('.sheet__opt', { hasText: '阿光' })).toContainText('場下')"
    ],
    "failure": "expect(dlg.locator('.sheet__opt', { hasText: '阿光' })).toContainText('場下')",
    "minTests": 1
  },
  "E53": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "S-9 管理員看鎖定場次",
    "assertions": [
      "expect(page.locator('.notice')).toContainText('場次改判頁')"
    ],
    "failure": "expect(page.locator('.notice')).toContainText('場次改判頁')",
    "minTests": 1
  },
  "E54": {
    "spec": "tests/e2e/audit-fixes.spec.js",
    "grep": "S-5 出場名單確認之後",
    "assertions": [
      "expect(page.locator('.sheet__opt', { hasText: '小豆子' })).toBeVisible()"
    ],
    "failure": "expect(page.locator('.sheet__opt', { hasText: '小豆子' })).toBeVisible()",
    "minTests": 1
  }
};
