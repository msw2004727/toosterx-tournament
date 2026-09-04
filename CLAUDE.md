# toosterx-tournament｜AI 專案指引

> 這份是給 AI 助手（與新加入的人）的單一真相來源。完整規格在 `docs/`。
>
> `docs/00`–`10` 是**規格**，是實作的依據。
> `docs/90`、`91` 是**背景文件**（原始企劃書與贊助提案），說明「為什麼」，
> 兩者衝突時**一律以編號規格為準**——那是後來討論修正過的版本。

## 專案本質

以**設定檔驅動**的賽事營運系統。飛達盃只是第一個 Event。
程式碼中**不得**出現 `if (divisionId === 'women')`、`if (eventId === 'feda-cup-2026')` 這類判斷。
賽制、積分、同分排序、遊戲成績型態一律讀 Firestore 的 `config/*`。

## 技術棧

前端 Vanilla ES6（無打包工具）／Firestore（讀直連、寫由 rules 守衛）／
Cloud Functions v2 nodejs22 @ asia-east1／LINE LIFF + Firebase Custom Token／Cloudflare Pages

## 環境

| | 正式 | Demo |
|---|---|---|
| 分支 | `main` | `demo` |
| Firebase | `feda-cup-2026` | `feda-cup-demo` |
| Pages | `feda-cup` | `feda-cup-demo` |
| 網域 | cup.toosterx.com | cup-demo.toosterx.com |

環境判斷**只有** `js/firebase-config.js` 一處，依 `location.hostname`。
本機一律連 demo，永遠不會誤寫正式資料庫。

## 開發流程（方向不可反）

```
改東西 → push demo → 在 cup-demo.toosterx.com 驗證 → merge 進 main → 上正式站
```

```bash
git checkout demo
# ...改東西...
git add -A && git commit -m "..."
git push                 # demo 站自動更新，先在那裡驗證

git checkout main
git merge demo
git push                 # 驗證過才上正式站
```

**正式站永遠只拿到已經在 demo 驗證過的程式碼。** 不要直接在 main 上開發。
唯一例外是 CI 設定、文件這類不影響網站行為的檔案。

## 硬性規則

| ID | 規則 |
|---|---|
| R-ID-007 | 建立文件一律 `doc(id).set()`，禁 `add()`；例外：`timeline` / `attempts` / `audits` |
| R-ID-003 | 使用者欄位命名：`staff`→`uid`、`checkins`→`scannedBy`、`audits`→`actor.uid` |
| R-CODE-001 | 新增邏輯用 `async/await`，禁止新增 `.then()` 鏈 |
| R-CODE-002 | 隊名／球員名／暱稱／備註等不可信內容一律 `escapeHTML()` 或 `textContent` |
| R-CODE-004 | 模組用 `Object.assign(App, {...})` 掛載，禁止新增全域變數 |
| R-REL-003 | 版號 `0.YYYYMMDD{suffix}`，只用 `node scripts/bump-version.js` |
| R-REL-013 | Service Worker 禁止 HTML cache-first |
| R-REL-014 | 新靜態資源必須由 bump 腳本納管 |
| R-ENG-001 | 積分／排名邏輯只能有一份實作，放 `js/engine/`，`functions/` 以 require 共用 |
| R-SEC-001 | 密鑰（QR SECRET、LINE Channel Secret）只放 Secret Manager，絕不進前端 |
| R-SEC-002 | 稽核文件只能新增，不可 update / delete |
| R-PRIV-001 | 身分證只存後四碼；未滿 13 歲球員公開端顯示遮蔽名，照片預設不公開 |
| R-SEED-001 | `scripts/seed.js` 只允許對 ID 含 "demo" 的專案執行，正式資料庫一律走管理後台匯入 |
| R-GIT-001 | 改動先進 `demo` 驗證，再 merge 進 `main`（見上方「開發流程」） |
| R-RULES-001 | `firestore.rules` 的角色判斷一律經過 `myRoles()`，禁止 `isA()` 呼叫 `isB()` 的巢狀鏈——會撞到每請求 1000 運算式上限，讓合法寫入被誤擋 |
| R-RULES-003 | 身分（`staff/{uid}.roles`）只有 `super_admin` 寫得動，且角色白名單**不含** `super_admin`——大總管不能由介面產生第二個。不看 `rolePermissions`（見 R-RULES-002）|
| R-RULES-002 | 動態權限（`rolePermissions`）只用在 UI 層，不進 rules；rules 只做粗粒度的角色 × 指派範圍 × 欄位白名單 |
| R-ENG-002 | 引擎的比分／數值一律用嚴格型別檢查，禁用 `Number(v)`——`Number(null)` 是 0，會把「沒填比分」判成 0:0 平手 |
| R-ENG-003 | 行為分（−3／−5）是「同一場、同一球員」的判定，彙總時分堆鍵**必須含 matchId**；卡片時序以 `clockSec` 為權威 |
| R-ENG-004 | 引擎不呼叫 `Date.now()` 或任何隨機來源。時間戳由呼叫端填，同分排不出來就標 `hasUnresolvedTie`，絕不隨機 |
| R-ENG-005 | 缺資料時一律 fail-closed（回 `null`／`ready:false` 並附原因），不可「沒資料就當作通過」 |
| R-TEST-001 | 修好一個缺陷就要在 `scripts/mutation-check.cjs` 加一條變異，證明測試真的抓得到。全綠但沒有鑑別力的測試比沒有測試更危險 |
| R-TEST-002 | 變異測試被強制中止會把原始碼留在**被改壞**的狀態。`scripts/mutation-guard.cjs` 掛在每個測試指令與 CI 最前面，看到 `.mutation-in-progress.json` 就還原並中止。**不要繞過它** |
| R-SRC-001 | 原始碼不得含 NUL 位元組（git 會當成二進位檔，看不到 diff）。CI 有檢查 |
| R-SRC-002 | 行尾一律 LF，由 `.gitattributes` 釘死。Windows 的 `core.autocrlf=true` 會讓 checkout 變成 CRLF，而變異測試用逐字多行比對——**單行的照樣對得上、多行的全部對不上**，看起來像腳本過期 |
| R-UI-001 | 換節點一律用 `mount(node, ...)`，禁用 `node.replaceChildren(...)`——後者會把 `null` 印成字串 "null" |
| R-UI-002 | 送出後**不可** `await` Firestore 的 Promise 再更新 UI。離線時它永遠不會 resolve，畫面會卡住 |
| R-UI-003 | 所有 `onSnapshot` 一律經 `store.hold(scope, unsub)` 註冊，換頁自動回收 |
| R-UI-004 | 功能性 UI **不得用 emoji**，一律 `icon()` / `iconText()`（`js/core/icons.js`）。emoji 各平台形狀不一、顏色寫死在字型裡（深色主題換不掉）、放大會糊。狀態圓點用 `.dot[data-status]`。`tests/unit/icons.test.js` 會掃描整個前端 |
| R-UI-005 | 主題只靠 `<html data-theme>`，CSS 裡**不得**出現 `@media (prefers-color-scheme)`；淺色一定要寫在裸 `:root`（JS 掛掉時畫面不能沒有顏色）。需要深淺不同色的地方用語意色組（`--warn-bg/-text/-border`），不要在元件裡寫深色覆蓋 |
| R-UI-006 | 版面最小驗證寬度 **320px**、設計基準 360px。窄機優先調 token，不逐個元件改 |
| R-REL-015 | `js/` 與 `css/` 一律 `max-age=0, must-revalidate`（見 `_headers`）。Cloudflare Pages 預設 4 小時，會造成「新 HTML 配舊模組」的混版；動態 import 的網址帶不了版號，這是唯一的解 |
| R-REL-016 | 動態 `import()` 一律經過 `router.lazy()`，並在網址加 `?v=CACHE_VERSION`：重試要換 query 才有效（瀏覽器會記住失敗的模組網址） |
| R-DEMO-001 | Demo 專屬程式碼只放 `js/modules/demo/`，正式版**不 import**（不是用旗標關掉） |
| R-PWA-001 | `img/*.png` 由 `scripts/make-icons.mjs` 產生並**進版控**，CI 有 `--check`。manifest 指到不存在的圖示時 Chrome 不給安裝選項，而且**一個字都不印** |
| R-NAV-001 | 公開端與報名端每一頁都要回得去首頁與「我的」（`js/core/appbar.js`）。少了它，建完隊的家長會以為球隊不見了 |
| R-ROLE-001 | 角色代碼、階層、標籤與 FC-Football 對齊，權威在 `js/config.js` 的 `ROLE_INFO`。任何地方都不得再寫第二份角色標籤表 |
| R-ROLE-002 | 賽務角色**向上包含**，繼承鏈明列在 `STAFF_CHAIN`，**不得用 `level` 比大小**（FC 的 `venue_owner` level 3 夾在記錄員與管理員之間）|
| R-PERM-001 | 前端權限判斷一律 `can('權限碼')`，不得在頁面裡再列一次角色。權限碼字典在 `js/config.js` 的 `PERMISSIONS` |
| R-PERM-002 | `destructive: true` 的權限**同時寫在 `firestore.rules`**；其餘的開關只控畫面，不可以拿來保護資料 |
| R-NAV-002 | 頂部導覽在每一頁、每一種身分下都一樣：首頁／安裝／登入或我的／三個主題圖示。「首頁」永遠是公開首頁 |
| R-REG-001 | 組別的名稱、參賽資格、上場人數、比賽時間、用球、同分判定、棄權比分一律**照競賽規章**，權威在 `js/engine/formats.js`，`tests/unit/regulation-parity.test.js` 盯著。改這裡等於改規章 |
| R-REG-002 | 民國年**只存在於畫面上**。資料庫與引擎一律西元 ISO `YYYY-MM-DD`，轉換走 `js/lib/roc.js`。兩種紀年混在同一個欄位差 1911 年，而且不會報錯 |
| R-PRIV-002 | 未成年名單只存**暱稱＋身分證後四碼＋生日**，不存真名。檢錄靠後四碼與生日跟證件核對。`nameKind:'nickname'` 的顯示名不再遮蔽（遮暱稱遮不到個資，只會讓家長以為名字被打錯）|

## 不可協商的產品行為

1. **送出三態**：賽務端每一次送出都要明示「已儲存／待同步／失敗」，絕不假成功
   ・**離線時不得畫出任何「看起來可以按」的限時操作**。三分鐘自撤回就是例子：
   　離線時伺服器認可的送出時間還不存在（`serverTimestamp` 在本機快照是 `null`），
   　硬畫一個倒數，賽務會照著按，然後在恢復連線的瞬間被 rules 擋掉——那就是假成功
2. **離線可用**：檢錄與比分記錄在飛航模式下必須能完成，恢復連線自動補送
3. **一切可修正、一切留痕**：所有結果性資料 Admin 都能改，且必留 before/after/who/when/why
4. **同分不隨機**：條件用盡就標記 `hasUnresolvedTie`，等主辦裁定

## 測試

```
npm run test:unit         賽制引擎（T01–T32，見 docs/02 §11）
npm run test:rules        R01–R31（見 docs/07 §2.4）
npm run test:fn           結果管線 F01–F14（Emulator，見 docs/07 §3.1）
npm run test:e2e          Playwright
npm run test:mutation     引擎與前端的變異測試
npm run test:mutation:e2e 畫面層時序的變異測試（只跑目標 spec，約 20 秒）
npm run test:mutation:fn  結果管線的變異測試
```

CI 紅燈必須先修復。targeted test 不能替代完整 suite。

## 部署

```
npm run deploy:rules:demo      firestore.rules + 索引（Spark 方案就能跑）
npm run deploy:storage:demo    storage.rules（需 Blaze + Console 先啟用 Storage）
npm run deploy:fn:demo         Cloud Functions（需 Blaze；predeploy 會自動同步 engine）
```

**三者不可合併成一條指令。** Storage 與 Functions 都需要 Blaze 方案，
在專案還沒升級前，把它們跟 firestore 綁在一起會讓整批部署失敗，
連本來可以成功的 rules 都上不去。

## 目前進度

- [x] M0 規格定案（`docs/00`–`08`）＋互動原型
- [x] 雲端環境開通（GitHub / Firebase ×2 / Cloudflare Pages ×2 / 自訂網域 / CI）
- [x] M1-a 賽制設定檔 `js/engine/formats.js`（4 個 Format、3 組 RankingRule、6 組別）
- [x] M1-b 種子資料 `scripts/seed.js`：38 隊、75 場、1176 筆文件，含排程自檢
- [x] M1-c rules 測試 `tests/firestore-rules/`：40 個案例，**已實跑全綠**
- [x] M1-d rules 效能修正：角色判斷改用扁平的 `myRoles()`，避免撞到 1000 運算式上限
- [x] M1-e 部署 rules 與索引到 demo，灌入 1176 筆種子資料，並於 cup-demo.toosterx.com 實地驗證
      （5 個 matches 複合索引可用、公開／私密讀取邊界正確、0 衝堂）
- [x] M2 賽制引擎：`tally / standing / ranking / advancement / awards`，144 個單元測試（T01–T28）
      ＋ 14 條變異測試。程式碼審查抓出 12 個缺陷，全數修正並補上對應測試
- [x] M3 賽務端：前端核心（firebase/store/sync/clock/ui/router）＋ LIVE 賽務台、
      賽務首頁、出場名單。221 個單元測試 ＋ 26 個 E2E（含離線三態實測）
- [x] M3.5 主題重做：FC token 系統、三態主題（系統／淺色／深色）、SVG 圖示取代 emoji、
      320px 窄版、拿掉 `venue_lead`、完賽三分鐘自撤回。
      254 單元 ＋ 24 變異 ＋ 96 E2E（三種視窗寬度）＋ 70 rules
- [x] M3.9 結果管線：把 M2 引擎接上 Firestore。`functions/` 改 ESM、
      `js/engine/` 由 `scripts/sync-engine.js` 同步進部署範圍，
      積分榜／晉級／最終排名／射手榜全部自動化。21 個模擬器整合測試（F01–F14）
      ＋ 10 條變異。實測 Functions 在真的執行環境載得起來（23 個 endpoint）
- [x] M5 公開端：8 條路由（首頁／賽程／比賽／組別／球隊／球員／統計／直播牆）
      ＋ 404 頁。322 單元 ＋ 47 變異 ＋ 171 E2E。整合時修掉四個欄位路徑錯誤
      （見下方「公開端」章節）
- [x] M4-a 報名的資料模型與權限邊界：`users/{uid}` 名錄、`config/registration`、
      球隊狀態機、名單凍結、身分授權收斂到 super_admin。
      R34–R64 共 40 個 rules 測試 ＋ 12 條規則變異
- [x] M4 Function：`onMemberWritten` 公開投影（未滿 13 歲遮名、白名單欄位）、
      `onTeamWritten` 建隊數、重複申請退件。FR01–FR08 ＋ 4 條變異
- [x] M4-b①  LINE 登入：`js/core/liff.js`、`#/login`、`#/my`。
      LIFF ID 已接（正式 2011382367 / demo 2011382448，同一個 Provider）
- [x] M4-b②  報名流程畫面：`#/register`、`#/register/new`、`#/join/:code`、
      `#/team/:id/manage`。18 個 E2E × 3 種視窗
- [x] M4-b③  全站頁首（首頁／我的／安裝／主題）＋ PWA 可安裝 ＋ 角色字典與 FC 對齊
- [ ] M4-c   管理後台（依主辦指定的順序逐項實作）
      - [x] 報名審核 `#/admin/teams`（名單檢核＋核准／退回＋留痕）
      - [ ] 身分授權　[ ] 權限開關　[ ] 稽核紀錄
      - [ ] 報名開關　[ ] 賽程管理　[ ] 挑戰攤位（M6 子系統）
      ・總管仍由 `scripts/grant-super-admin.mjs` 建立（Admin SDK，不經 rules）
- [ ] M4-d   「我的球員」（需要 members 的 collectionGroup 索引與規則）
- [x] M4-b④  依競賽規章校正設定＋未成年組教練管理名單＋檢錄台
- [x] M4-b⑤  資訊架構重整：角色階層（向上包含）＋權限矩陣＋專屬首頁＋
      常駐頁首（登入／我的）＋主題只留圖示＋移除關注功能
- [ ] M6 Challenge 挑戰系統　[ ] M7 彩排 → 上線

## 現在的狀態（2026-09-02，Claude Code 接手後已全數實跑）

M3.5 的四關全部實跑過了，`test:rules` 那一關的疑慮解除：分支 (D) 用到的三個新語法
（`resource.data.get()`、`duration.value(3,'m')`、`== request.time`）模擬器都吃得下。

| 關卡 | 狀態 |
|---|---|
| `npm run test:unit` | ✅ 530 全綠（27 個 suite） |
| `npm run test:mutation` | ✅ 110 / 110 全被抓到 |
| `npm run test:mutation:e2e` | ✅ 3 / 3 全被抓到（畫面層時序） |
| `npm run test:e2e` | ✅ 465 全綠（mobile / desktop / 320px 三種寬度） |
| `npm run test:rules` | ✅ 155 全綠（含 R34–R72 報名、R73–R82 檢錄、R83–R92 階層、R93–R98 審核） |
| `npm run test:mutation:rules` | ✅ 27 / 27 全被抓到 |
| `npm run test:fn` | ✅ 40 全綠（F01–F14 結果管線、FR01–FR13 報名與登入） |
| `npm run test:mutation:fn` | ✅ 16 / 16 全被抓到 |

### 這一輪審查抓到並修掉的三個缺陷

1. **`tests/unit/icons.test.js` 在 Windows 上整個 suite 崩潰**（高）
   `new URL('../../', import.meta.url).pathname` 在 Windows 是 `/D:/…`，
   丟給 `fs.readdirSync` 會被解成 `D:\D:\…` 而 ENOENT。改用 `fileURLToPath()`。
   影響不只是少六條案例——掛掉的正好是**掃描整個前端「不得有 emoji」的守門測試**，
   而 jest 只會印一行 `1 failed`，案例總數默默從 253 變成 247。

2. **CI 的 NUL 位元組檢查是一盞紅不起來的綠燈**（中）
   `grep -rlIz -P '\x00'` 永遠不會命中：`-I` 把含 NUL 的檔當二進位跳過，
   `-z` 又把 NUL 當行分隔符。R-SRC-001 等於沒有人在守。改成 Node 直接讀 bytes，
   並實測過「乾淨 → 綠、植入 NUL → 紅」。

3. **rules 允許「完賽但不上鎖」**（中高，`firestore.rules` 分支 (B)）
   賽務只要在送出完賽時不寫 `lock.locked = true`，場次就停在「已完賽但未鎖定」，
   分支 (B) 的 `lock.locked == false` 永遠成立——**已完賽的比分可以無限期改寫**，
   而且完全不受三分鐘視窗約束。已用模擬器實證（改動前 P1／P2 都通過）。
   修法是新增 `finishMustLock()` 並在分支 (B) 串上，補 R31／R31b／R31c 三條規則測試、
   一條讀 `firestore.rules` 的單元測試，以及變異 #21／#22。

### 已知但未修（低）

- `buildFinishPatch` / `buildUndoPatch` 寫 `lock` 時只給 `{locked, lockedBy}`，
  沒有 `lockedAt`。`updateDoc` 的巢狀 map 是整包取代，所以 `lock.lockedAt`
  （docs/01b §262 有定義、seed 也會寫）會被靜靜刪掉。目前沒有任何程式讀它，
  純粹是 schema 漂移，等 M4 一起處理。
- `app.js` 的 `mountAppHeader()` 進到 `#/staff` 時直接 `replaceChildren()`，
  沒有呼叫 `themeSwitch()` 的 `destroy`，訂閱者要等下一次主題變動才自清。
  數量有界且會自癒，不影響現場。

### R-REL-015｜為什麼 `_headers` 這麼重要（已修復，留著當教訓）

自訂網域前面那層 Cloudflare zone 原本把 `/js/*`、`/css/*` 的 `Cache-Control`
整條換成 4 小時。**2026-09-02 已改成 Respect Existing Headers**，兩個網域實測
都回我們自己的值。

設定改好之前剛好親眼看到這條規則要防的事：M4-b 部署後，瀏覽器拿到
**新的 `js/core/liff.js` 配舊的 `js/firebase-config.js`**，整頁掛在
`does not provide an export named 'LIFF'`。伺服器上兩個檔都是新的，
壞的是還沒過期的瀏覽器快取。

`app.js` 靜態 import 的三個模組（`firebase-config.js` / `config.js` / `theme.js`）
帶不了版號——沒有打包工具，只有動態 import 的網址加得上 `?v=`。
所以那一層只能靠 HTTP 標頭守。**不要動 `_headers`，CI 有檢查。**

### 等對方（小麥）處理的事

> 逐步操作手冊在 **`docs/11-上線前設定步驟.md`**（含每一項的驗證方法）。
> 換一台電腦接手看 **`docs/12-換設備接手指引.md`**。

1. ~~Blaze 升級~~ ✅　~~兩組 LIFF Channel~~ ✅　~~報名截止日~~ ✅（demo，截止 10/8 00:00）
   ⚠️ 截止日仍建議提前到 9/28 或 10/1——彩排排在 10/6–10/7，
   10/8 才截止的話彩排時名單還沒定案
2. ~~授權 `signBlob`~~ ✅ demo 已完成。
   ⚠️ **正式站的那一份要等第一次 `deploy:fn:prod` 之後才做得了**——
   `{編號}-compute@developer.gserviceaccount.com` 是部署 Functions 時才被建立的，
   現在對 `feda-cup-2026` 跑會得到 `NOT_FOUND: Unknown service account`（docs/11 §1.5）
3. ~~Cloudflare Browser Cache TTL~~ ✅ 已完成，兩個網域實測都回我們自己的標頭
4. **Functions 映像檔清理政策**（`npx firebase functions:artifacts:setpolicy`）

### 下一個里程碑

M4 報名與球隊管理，規格在 `docs/10-報名與球隊管理.md`（已定案，經三輪討論）。
後端要等 Blaze 與 LIFF，但前端畫面可以先做。

## 變異測試的殘留（R-TEST-002，2026-09-03 出過事）

變異測試會把原始碼「改回錯的」再跑一次。正常結束會還原，但**被 SIGKILL
砍掉時還原沒有機會執行**——`process.on('exit')` 與 SIGINT 都攔不住。

那一天為了釋放 8080 埠，我從外面砍掉 emulator 的行程，`firestore.rules`
就停在變異狀態，而且被 commit 並部署到 demo：

| 殘留的變異 | 後果 |
|---|---|
| `staff` 的 create/update 從 `isSuperAdmin()` 變成 `isAdmin()` | **管理員可以指派身分，包含把自己升成總管** |
| `checkins` 的 `allow delete` 從 `false` 變成 `isCheckin()` | **檢錄紀錄可以被刪除**，誰放行了誰查不到 |

CI 有紅，但 CI 是**推上去之後**才跑的。

### 三層防護

1. `mutate.cjs` 多攔 SIGTERM／SIGHUP／SIGBREAK，`restoreAll` 冪等。
2. 磁碟上留 `.mutation-in-progress.json`（含 pid、時間、每個檔案的原始內容）。
   正常結束刪掉；被砍掉就留著。
3. `scripts/mutation-guard.cjs` 掛在 `test:unit` / `test:rules:unit` /
   `test:e2e` 與 CI 第一步：
   ・**pid 還活著** → 只警告「變異正在跑」，**不動檔案**
   　（動了會把進行中的那一次弄壞）
   ・**pid 已死** → 自動還原並以非零結束碼中止
   ・沒有標記 → 靜默通過

> ⚠️ 變異執行器呼叫測試時帶 `FEDA_MUTATION_RUN=1` 讓守衛放行。
> **不放行的話每一條變異都會因為守衛失敗而看起來「被抓到」**，
> 整個變異測試就變成一盞永遠是綠的燈——正是 R-TEST-001 在講的那種。

三種情境都實測過（pid 存活不插手／pid 已死自動還原且逐位元組相同／無殘留靜默通過）。

### 同一天的第二個坑：CRLF（R-SRC-002）

修完上面那件事之後跑 `git checkout firestore.rules`，27 條變異突然有 18 條
變成「找不到要變異的程式碼」。看起來像腳本過期，其實是**行尾**：

全域 `core.autocrlf=true` 讓 Windows 的 checkout 產生 CRLF。
`git status` 看起來乾淨（git 比對時會正規化），但檔案在磁碟上真的變了。
變異用的是逐字多行比對——**單行的樣式照樣對得上，多行的全部對不上**，
所以症狀是「部分變異失效」而不是「全部失效」，更難聯想到環境。
CI 跑 Linux，永遠不會重現。

修法兩層：`.gitattributes` 的 `* text=auto eol=lf` 釘死行尾；
`mutate.cjs` 在開跑前檢查目標檔案有沒有 CRLF，有就直接說明白並中止。

## E2E 的靜態伺服器（2026-09-04）

`playwright.config.js` 的 webServer 是 **`scripts/dev-server.mjs`**，
不是 `python3 -m http.server`。換掉的原因是套件長到四百多條之後開始偶發紅燈：

| 症狀 | 真正的原因 |
|---|---|
| 隨機一條在 `waitForFunction(() => !!window.__fake)` 逾時 | python 的 ThreadingHTTPServer 每連線一條執行緒，Windows 上會 `WinError 10053` |
| 隨機一條在 `page.goto` 丟 `ERR_NO_BUFFER_SPACE` | **併發數沒有限制**（`workers: undefined` 會用一半的核心數），Windows 的暫時埠被 TIME_WAIT 吃光 |

兩件都不是那條測試壞了，但看起來完全像。修法：

1. 自己的 Node 靜態伺服器（事件驅動、keep-alive 30 秒、不增加相依）
2. `workers` 本機也**明確限制**成 3，不留 undefined

改動後連續兩輪 465 全綠，時間從 2.6 分降到 2.0 分。

> ⚠️ 不要換回 `python3 -m http.server`。

## 競賽規章（權威文件）

全文在 **`docs/FEDA-CUP-2026-競賽規章.md`**（主辦 2026-09-03 由官方 PDF 轉錄）。
**設定檔的數字一律以規章為準**，`tests/unit/regulation-parity.test.js`
把規章的值抄成常數盯著，設定一改就撞紅。

| 條 | 內容 | 對應 |
|---|---|---|
| 十一 | 六個組別與參賽資格（學童三組 2020/2018/2016-09-01 以後出生）| `DIVISIONS[].eligibility` |
| 十二 | 球員最多 15、隊職員 3（領隊/教練/管理各 1）、每人限報乙隊 | `REGISTRATION_LIMITS` |
| 十五 | 上場人數：學童三組＋女子公開 5 人、男子兩組 9 人 | `playersOnField` |
| 十七 | 用球：學童 4 號、其餘 5 號 | `ballSize` |
| 十八-2 | 比賽時間 25／30 分鐘，**不分上、下半場** | `matchDurationMin`、`periods:1` |
| 十八-3 | 賽前 30 分鐘檢錄，冒名頂替停止整隊資格 | 檢錄台 |
| 十八-6 | 逾時 5 分鐘不出場**棄權論 0:2** | `DEFAULT_WALKOVER` |
| 十八-8 | 當日 2 次（不同場）黃牌**不需停賽**、紅牌下一場可回復 | 引擎刻意**沒有**停賽邏輯 |
| 十九 | 同分：對戰關係 → 正負球數 → 進球數 → 被進球數少 → 抽籤 | `RR_FEDA_2026` |

### 三個容易誤判成缺陷的地方

1. **引擎沒有累計停賽邏輯是對的。** 第十八條第 8 款明文「不需停賽一場」。
2. **仁慈規則（比分封頂）已關閉。** 規章沒有這一條，是先前自己加的。
   公開端顯示 7:0、實際 12:0，對家長來說是系統在騙他。
3. **`drawLots` 不會擲骰子。** 規章第 5 順位是抽籤，但抽籤由主辦執行；
   引擎只標記 `hasUnresolvedTie` 等人回填（R-ENG-004）。

### 規章有、系統還沒有的

每人限報乙隊的跨隊檢查、球員人數上限的伺服器端強制、
申訴（賽後 30 分鐘＋保證金 2000）、眼鏡切結書、退費機制。

### 組別的兩個名字（R-REG-001）

| divisionId | `name`（畫面）| `shortName` | `officialName`（規章）|
|---|---|---|---|
| u6 | U6兒童組 | U6 | 學童幼稚園 |
| u8 | U8兒童組 | U8 | 學童低年級 |
| u10 | U10兒童組 | U10 | 學童中年級 |
| women | 女子組 | 女子 | 女子公開組 |
| adult-fun | 成人興趣組 | 興趣 | 男子興趣組 |
| adult-open | 成人公開組 | 公開 | 男子公開組 |

📌 **規章原文沒有 U6/U8/U10 這種寫法**（官方 PDF 與 `docs/` 的轉錄本都查過）。
U 制是主辦 2026-09-03 指定的顯示慣例。

報名頁的組別列**兩個一起顯示**：只寫 U 制的話，家長拿著印「學童中年級」的
報名表會對不上，而「我到底要報哪一組」是報名期間最常見的詢問。

## 未成年組報名與檢錄（M4-b④）

主辦 2026-09-03 指定：學童三組**不走邀請碼、不掃碼檢錄**。

```
建立球隊 → 選學童組別 → 教練直接新增小球員（暱稱／後四碼／民國年生日）
  → 送出報名（凍結）→ 當天教練帶證件到檢錄處
  → 檢錄員核對「生日＋後四碼」→ 勾選確認出賽
```

**為什麼不走邀請碼**：小球員沒有 LINE 帳號，家長也不見得會操作。
留一組沒有人用得到的邀請碼，只會讓教練一直等隊友來申請。

**為什麼只存暱稱**：主辦決定不收未成年真名。系統從頭到尾沒有存過
那個孩子的全名，檢錄能核對的就是「身分證後四碼＋出生年月日」——
所以那兩格在學童組是**必填**，而且在檢錄台上要印得夠大。

### 判斷「哪一組走教練模式」

`isYouthDivision(division)` 看的是 **`eligibility.bornOnOrAfter != null`**，
不是 divisionId。`if (divisionId === 'u10')` 在辦第二場時就會錯
（專案本質是設定檔驅動）。變異 #R13 專門守這件事——
只測現有六個組別抓不到寫死代碼，要測「代碼沒見過但有年齡門檻」的組別。

### 民國年（R-REG-002）

```
js/lib/roc.js       rocToIso / isoToRoc / rocLabel / rocShort
js/modules/register/bits.js  rocDateInput()：三格數字，對外回西元 ISO
```

不用 `<input type="date">`：原生選擇器是西元，家長手上的證件是民國年，
每填一次要心算一次；三格數字鍵盤照著證件抄最快也最不會錯位。

⚠️ `toInt()` 用嚴格正規表示式而不是 `Number()`。`Number('')` 是 0、
`Number('0x69')` 是 105、`Number('1e2')` 是 100——民國年的範圍檢查（1–200）
會把 0 接住，所以「空字串」那條測試在改用 `Number()` 之後照樣是綠的
（變異 #R15 就是這樣逃掉的）。

### 權限邊界

| 誰 | 能做什麼 |
|---|---|
| 隊長（教練）| 新增／編輯／移除**自己填的**那幾筆（`source: 'coach'`）|
| 隊長 | 家長送來的只能同意／婉拒，**改不動內容** |
| 檢錄員 `checkin` | 寫 checkins、讀 members（生日與後四碼在那裡）|
| 檢錄員 | **改不動比分、不能完賽、不能改判** |

`source: 'coach'` 不只是標記——`coachMemberEditOk()` 靠它判斷這筆是不是
隊長自己填的。R65–R72 共 10 條 rules 測試守著。

## 檢錄台（js/modules/staff/checkin.js）

```
checkin.js          畫面（#/staff/checkin/:matchId）
checkin-actions.js  純邏輯：建立紀錄、進度統計、開賽人數
checkin-data.js     Firestore 存取（寫入一律經 sync.track）
```

三件不可協商：

1. **勾選不 await Firestore 的 Promise**（R-UI-002）。離線時它永遠 pending，
   檢錄員勾第一個人畫面就卡住。先更新本機狀態、立刻重畫，
   真正的狀態交給 `sync.js` 的三態燈。
2. **取消勾選是把 `result` 設成 null，不是刪文件。** rules 也不放行 delete——
   「誰在幾點確認了誰出賽，後來又取消」整段都要留痕。
3. **進度分母只算球員。** 把領隊教練算進去，「2 / 5」會讓檢錄員
   一直找那三個不存在的小孩。

⚠️ 檢錄讀的是 **`members`**（私密）不是公開的 `roster`：生日與身分證
後四碼只存在 members 上，`ROSTER_FIELDS` 白名單刻意沒有它們。

## 資訊架構（主辦 2026-09-03 指定）

### 全站只有兩個入口

```
#/     公開首頁   訪客也看得到：賽程、比分、積分榜、球隊
#/my   專屬首頁   登入後的落點，內容依身分展開
```

頂部導覽**在每一頁、每一種身分下都長一樣**：

```
[首頁]                         [安裝] [登入／我的] [▣ ☀ ☾]
```

・**「首頁」永遠是公開首頁。** 總管也看得到家長看到的畫面——
　現場有人回報「我看到的不是這樣」時核對得起來。
・**右邊那一格依登入狀態變**：未登入是「登入」（→ `#/login`），
　登入後是「我的」（→ `#/my`）。位置與圖示不變，只換文字與去處。
・**主題只留圖示**（任何寬度）。文字標籤仍在 DOM 裡給螢幕閱讀器，
　但用 `clip-path` 藏起來——`display:none` 連讀都讀不到。
・這一列在 `#/staff` 底下**也顯示**，所以賽務首頁自己那顆主題切換已拿掉。

**為什麼不做 `#/staff-home`、`#/admin-home` 好幾條專屬路由**：
一個人可能同時是隊長與記錄員，分成幾條就要決定「他登入後該去哪一條」，
而且每加一個層級就多一個入口要維護。同一條路由、內容依權限展開，
新增一個功能只要在 `js/config.js` 的 `FEATURES` 加一行。

## 管理後台（M4-c）

```
js/modules/admin/
├── index.js   路由（lazy() ＋ ?v=，同 staff/index.js）
├── data.js    Firestore 存取 ＋ 錯誤翻譯 ＋ writeAudit
├── bits.js    共用頁首與「沒有權限」畫面
└── teams.js   報名審核 #/admin/teams
```

新增一個功能要動三個地方，`tests/unit/perms.test.js` 會檢查前兩者對得起來：

1. `js/config.js` 的 `PERMISSIONS` 加一條權限碼
2. `js/config.js` 的 `FEATURES` 加一行（含 `route`）
3. `js/modules/admin/index.js` 註冊路由

守衛只擋「有沒有登入」，「有沒有這項權限」由頁面自己顯示原因——
擋在路由層只會得到一個空白頁，使用者看不出是權限問題還是壞掉。

### 報名審核的檢核（js/engine/review.js）

`reviewTeam()` 是純函式，回傳 findings ＋ `canApprove`。
**error 與 warn 的界線很重要**：

| level | 收什麼 |
|---|---|
| `error` | 規章明文（人數、年齡）＋「放行之後會產生錯誤結果」（背號重複）|
| `warn` | 提醒，主辦仍可核准（例如還沒填背號）|

規章沒寫、也不會弄錯結果的事情不要升成 error——那等於系統替主辦
訂了一條規章沒有的規則。每一條 finding 都帶 `source`，
背號重複標的是**「系統限制」而不是「規章」**，因為規章真的沒有那一條。

### 兩個方向相反的鎖

| 動作 | `status` | `rosterLocked` |
|---|---|---|
| 核准 | `approved` | **true**（第二道鎖，要改只能退回）|
| 退回 | `rejected` | **false**（解凍，隊長改完再送）|

⚠️ 退回時**不可以**順手鎖起來。`rosterFrozen()` 看的是
`status in ['draft','rejected'] && !rosterLocked`——鎖了的話隊長改不動，
卻完全看不出為什麼。變異 #A6 守這件事。

## 角色階層與權限（R-ROLE-002）

### 向上包含

```
挑戰攤位 booth 2.1
  └ 檢錄員 checkin 2.2
      └ 裁判 referee 2.3
          └ 記錄員 scorer 2.4
              └ 管理員 admin 4
                  └ 總管 super_admin 5
```

權威在 `js/config.js` 的 `STAFF_CHAIN`。`impliedRoles(['scorer'])` 會展開成
`['booth','checkin','referee','scorer']`，所以指派一個記錄員就夠了，
不必再另外指派檢錄員。

> ⚠️ **鏈是明列的，不是比 `level` 大小。**
> FC 的 `venue_owner` 是 level 3，數值正好夾在記錄員(2.4)與管理員(4)之間。
> 用 `level >=` 判斷的話，一個從 FC 同步過來的「場主」會自動拿到記錄員的
> 全部權限——那個人可能只是租場地的老闆。`level` 只用來排序與顯示。

### 每個角色實際能做的事

| | 挑戰攤位 | 檢錄員 | 裁判 | 記錄員 | 管理員 | 總管 |
|---|---|---|---|---|---|---|
| 挑戰成績 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 檢錄勾選、看球員個資 | | ✅ | ✅ | ✅ | ✅ | ✅ |
| 出場名單 | | | ✅ | ✅ | ✅ | ✅ |
| 比分／時鐘／完賽／自撤回 | | | | ✅ | ✅ | ✅ |
| 覆核、改判、賽程、報名審核 | | | | | ✅ | ✅ |
| 身分授權、權限開關、報名開關 | | | | | | ✅ |

**覆核完賽刻意不在記錄員身上**：覆核的意義是「第二雙眼睛」，
記分的人自己覆核自己等於沒有覆核。

**裁判在系統裡的職能是名單與檢錄**，不是記分。時鐘與比分在 rules 裡是
`matches` 文件上的一道整體閘（`isScorer()`），拆成兩支會讓那條規則長一倍。
場上的哨音本來就不需要系統。

### 權限開關

`js/config.js` 的 `PERMISSIONS` 是每一個「獨立功能」一條，
`minRole` 是預設歸屬。總管可以在 `config/rolePermissions/{role}` 逐條覆寫：

```js
{ role: 'scorer', perms: { 'match.finish': false } }   // 關掉記錄員的送出完賽
{ role: 'referee', perms: { 'match.score.write': true } }  // 把記分下放給裁判
```

四條規矩：

1. **開優先於關。** 一個人身兼兩個角色、其中一個被關掉某項時，不該讓他比
   單一角色更弱——反過來設計會讓「多給一個身分」變成一種懲罰。
2. **總管不受開關影響。**「調整權限開關」本身也是一條權限，關掉就再也打不開了。
3. **讀不到矩陣走預設，不是全部關閉。** 設定讀取失敗的當下把賽務按鈕
   全部收掉，現場會以為系統壞了。
4. **`destructive: true` 的那幾條同時寫在 `firestore.rules` 裡**
   （主辦決定：破壞性操作進規則，其餘只控畫面）。
   非 destructive 的條目**只控制畫面**——不要用它們來保護資料。

> ⚠️ `config/rolePermissions` 的初始值由 `scripts/seed` 從 `PERMISSIONS`
> **推導**，不要手寫第二份。手寫的那一份 2026-09-03 已經跟程式碼分岔過
> （裁判有覆核權、沒有 checkin 這個角色），而分岔不會有任何錯誤訊息。

### 前端一律走 `can()`

```js
import { can } from './js/core/firebase.js';
if (can('match.finish')) { /* 畫送出完賽的按鈕 */ }
```

不要在頁面裡再列一次角色清單。角色與權限的對應只有 `js/config.js` 一份。

## 已移除：關注（follow）

2026-09-03 拿掉。關注按鈕是這個功能唯一的入口，按鈕移除之後首頁置頂與
賽程的「我的關注」篩選就沒有東西可以填了——留一個永遠是空的篩選器
比沒有更糟。`js/modules/public/follows.js` 已刪除，`onlyFollowed`
與 `followTeamIds` 也從 selectors 移除。「我的球隊」取代了它的用途。

## 角色與身分（與 FC-Football 對齊）

兩個專案共用同一批 LINE 使用者（uid 完全相同，docs/10 §8.5 已實機驗證），
未來要把身分資料對接。權威字典在 `js/config.js` 的 `ROLE_INFO`，
`tests/unit/roles-fc-parity.test.js` 會盯著它不要漂移。

| 代碼 | level | 標籤 | FC 也有 |
|---|---|---|---|
| `super_admin` | 5 | 總管 | ✅ |
| `admin` | 4 | 管理員 | ✅ |
| `referee` | 2.6 | 裁判 | ✗ 賽事專用 |
| `scorer` | 2.4 | 記錄員 | ✗ 賽事專用 |
| `booth` | 2.2 | 挑戰攤位 | ✗ 賽事專用 |
| `venue_owner` | 3 | 場主 | ✅（這裡用不到，保留以便看懂 FC 的資料）|
| `captain` | 2 | 領隊 | ✅ |
| `coach` | 1 | 教練 | ✅（同上）|
| `user` | 0 | 一般用戶 | ✅ |

### 兩邊刻意不同的三件事

1. **形狀**：FC 是 `user.role` 單一字串＋數值階層；這裡是 `staff/{uid}.roles`
   **陣列**。賽事現場一個人真的會同時是記錄員與裁判，而且權限是
   「角色 × 指派範圍（場地／組別）」的交集，壓不成一條線（R-RULES-002）。
   **`level` 只用來排序與顯示，不用來判權限**——不可以寫 `level >= 4`。
2. **多三個賽務角色**，level 用小數插在領隊(2)與管理員(4)之間，
   不撞到 FC 既有的整數。
3. **少用 coach／venue_owner**，但字典裡保留：對接時要看得懂 FC 傳來的值，
   不能因為沒用到就當成無效。`topRole()` 遇到完全不認識的角色會**丟掉**
   而不是猜——猜錯的方向是「給了不該給的權限」。

### 總管（super_admin）只能由 Admin SDK 建立

`firestore.rules` 有兩份白名單，**兩份都不含 `super_admin`**：

| 函式 | 管的事 |
|---|---|
| `staffRolesAssignable()` | 總管能指派出什麼身分 |
| `validSelfServe()` | demo 上能自己拿什麼身分（正式專案整段是關的）|

任何一份放行 `super_admin`，就等於「登入一次就能發身分給任何人」。
所以第一位（與每一位）總管只能走這支腳本或 Console：

```bash
node scripts/grant-super-admin.mjs --project feda-cup-demo --uid U... --name 小麥
node scripts/grant-super-admin.mjs --project feda-cup-demo --list
```

> ⚠️ 兩條同名的 `hasOnly([...])` 曾經讓變異測試逃掉一次：
> `staffRolesAssignable()` 與 `validSelfServe()` 的那一行字面完全相同，
> 測試若用整檔搜第一個 hasOnly，改壞其中一個不會紅。
> 這是本專案第四次遇到「兩道一模一樣的守衛互相遮蔽」。

## 全站頁首與 PWA（M4-b③）

```
js/core/appbar.js   首頁／我的／安裝／主題，公開端與報名端常駐（#/staff 收起）
js/core/install.js  三種安裝環境的判定與教學
scripts/make-icons.mjs  產生 img/*.png（只用 Node 內建 zlib，不裝套件）
```

**為什麼要有頁首**：2026-09-03 的回報是「建立球隊成功後退出瀏覽器再回來
就無法找到自己的球隊」。球隊一直都在 `#/my`，但公開端每一頁都只有內容，
畫面上沒有任何一條路通往那裡——看起來像資料不見了，不像少了一個連結。

**安裝在三種環境是三件事，只有一種有 API**：

| 環境 | `beforeinstallprompt` | 做法 |
|---|---|---|
| Android／桌面 Chrome | 有 | 叫原生安裝對話框 |
| iOS Safari | 沒有，永遠不會有 | 教「分享 → 加入主畫面」|
| LINE／FB 內建瀏覽器 | 沒有，而且根本裝不了 | 教改用外部瀏覽器開 |

第三種對這個專案特別重要：報名的家長是從 LINE 點連結進來的。
**沒接到事件就不畫按鈕**——按了沒反應是最難回報的故障。

⚠️ `beforeinstallprompt` 在首次繪製前後就派發，那時 `app.js`（type=module，
等同 defer）還沒載。攔截寫在 `index.html` 的 inline script 裡，存進
`window.__fedaInstall`。搬進模組的話按鈕在多數情況下**永遠不會出現**，
而且不會有任何錯誤。

### `/img/*` 為什麼不能長快取（2026-09-03 實地發生）

Cloudflare Pages 對**找不到的路徑回 200 ＋ SPA fallback 的 index.html**，
不是 404。`_headers` 原本給 `/img/*` 七天快取，於是：

```
manifest 指到 /img/icon-192.png，但 img/ 是空的
  → 有人打了一次，邊緣把 index.html 存成這個路徑的答案，TTL 七天
  → 隔天圖檔補上去、原站回正確的 PNG
  → 自訂網域仍然回 text/html（Age 93586、cf-cache-status: HIT）
  → Chrome 拿到 HTML 當圖示，判定 manifest 無效，安裝選項照樣不出現
```

兩層修法，缺一不可：

1. **結構**：`/img/*` 改成 `max-age=0, must-revalidate, no-cache`，
   讓「404 被當成成功答案存起來」這件事最多只影響一次請求。CI 有守。
2. **眼前這一筆**：圖示網址帶 `?v=`（`manifest.json`、`index.html`、`sw.js`
   三處，由 `scripts/bump-version.js` 一起改）。換查詢字串就是換快取鍵，
   推版當下立刻繞開已經被毒化的那一筆，不用等 TTL 也不用進後台清快取。

> `sw.js` 的版號從 `CACHE_NAME` 推出來，不要再寫第四個地方。
> 預先快取的網址跟 manifest 差一個 `?v=` 就是不同的鍵，離線時照樣抓不到。

## 賽務端（M3）

```
js/core/
├── firebase.js   SDK 初始化（本機持久化快取）、Auth、連線偵測、伺服器校時
├── store.js      onSnapshot 註冊與回收（超過 MAX_LISTENERS 會警告）
├── sync.js       送出三態 queued / saved / failed，離線佇列與重試
├── clock.js      比賽時鐘（純函式）＋ 期別狀態機
├── router.js     hash 路由，換頁自動回收該頁監聽
├── theme.js      系統／淺色／深色 三態（首屏由 index.html 的 inline script 負責）
├── icons.js      SVG sprite ＋ icon() / iconText()（取代所有 emoji）
└── ui.js         escapeHTML / mount / toast / confirmDialog / sheet

js/modules/staff/
├── index.js         路由與守衛
├── home.js          賽務首頁（S01：0 次額外點選）
├── live.js          LIVE 賽務台（S02：4 次點擊記一顆球）
├── sheet.js         出場名單
├── live-actions.js  純邏輯：比分推算、事件建構、卡片判定、完賽 patch
├── data.js          Firestore 存取（寫入一律經 sync.track）
└── sync-indicator.js 常駐三態燈與重試清單
```

**送出三態是不可協商的**（docs/04 §5.7）。實作重點：
Firestore 的 `setDoc()` 在離線時回傳的 Promise **永遠 pending**，
所以絕不能 `await` 它再更新 UI；正確做法是立刻顯示「已記錄」，
真正的狀態交給 `sync.js` 追蹤並反映在右上角的燈號上。

## 路由（js/core/router.js）

換頁是 `hash → handle()`，中間有好幾個 await（cleanup、guard、動態 import
頁面模組）。這件事帶來兩個**每一頁都會中**的陷阱，兩個都已修並有 E2E 守住：

1. **同一個位置被處理兩次。** `initRouter()` 在沒有 hash 時會
   `location.replace('#/')`（排一個 hashchange），接著又直接呼叫一次 `handle()`。
   重複掛載不只是多畫一次——頁面會註冊兩份監聽、跑兩次一次性讀取，
   而且第二次會把第一次的狀態蓋掉。用 `lastHandled` 擋掉；
   `navigate()` 對「已經在這一頁」的情況傳 `force` 明確要求重跑。
2. **兩次導頁同時在跑。** 頁面模組是「邊載入邊畫」的，所以光在最後檢查
   世代沒有用——過期的那一頁在 await 回來之前就已經把東西畫進去了。
   解法是**每一次導頁擁有自己的容器**，被換掉之後它繼續畫也只是畫在一個
   離開文件的節點上。（實測：LINE 導回後網址是 `/login`、畫面卻是首頁。）

> 頁面模組收到的 `view` 是那一次導頁的容器，不是 `#app-view` 本身。
> 不要去抓 `document.getElementById('app-view')` 自己畫。

## 帳號與 LINE 登入（M4-b①，已實機驗證 ✅）

2026-09-02 實測成功：`U7774e1410479bafff4997f51b2c47b95` 出現在 Firebase Auth，
**與 FC-Football 的 uid 完全一致**。一次驗證了三件事——
LIFF 建在正確的 Provider、signBlob 授權有效、custom token 流程通了（docs/10 §8.5）。

⚠️ **custom token 登入的 Firebase user 沒有 displayName／photoURL**，永遠是 null。
名稱與頭像的權威在 `users/{uid}`（由 lineLogin Function 每次登入時更新），
畫面要讀那一份，不要讀 Firebase 使用者身上的欄位。


```
js/core/liff.js            LIFF SDK 載入與登入流程
js/modules/account/
├── index.js               路由（/login、/my）
├── login.js               登入頁 ＋ needLogin() 共用區塊
└── my.js                  我的：身分、uid、我帶的球隊
```

**一個登入入口通吃三種人**（隊長、家長、工作人員）。登入之後是誰、能做什麼，
由 `staff/{uid}.roles` 與 `teams/{id}.captainUid` 決定，不在路由層分流。
賽務端的登入頁也導到同一支——兩套登入等於兩套「拿不到 idToken 該怎麼辦」的
處理，遲早會分岔。

### 三件容易寫錯的事

1. **callable 的回傳有兩層 `data`**：`httpsCallable` 把 Function 的回傳值包在
   `.data`，而我們的 Function 本身回 `{ ok, data }` 信封，所以 customToken 在
   `res.data.data.customToken`。先前 `signInWithLine` 讀的是 `res.data.customToken`，
   永遠是 undefined——LIFF 一接上就會卡在「沒有回傳 customToken」。
2. **LIFF 只在註冊過的 Endpoint URL 上運作**。在 localhost 按登入會被導去
   demo 站，不會回到本機。要測登入請直接開 demo 站。
3. **SDK 載不到時不可以留一顆按不動的按鈕**。`#/login` 會換成看得懂的原因
   加一顆「再試一次」，而且**同時把登入鈕收掉**——E2E 有一條專門守這件事。
4. **從 LINE 授權回來時要自動完成登入**。`liff.login()` 會離開這一頁，
   授權後導回來是**全新的一次載入**：LINE 那側已登入、Firebase 這側還沒。
   第一版少了自動換發，使用者授權完只看到同一顆按鈕，以為失敗——
   實測時 `lineLogin` 一次都沒被呼叫到（Function 日誌與 `users/` 集合都是空的）。
   在 LINE 內建瀏覽器裡也受惠：那裡本來就已登入，連按都不用按。
5. **換發失敗的原因必須留在畫面上**，不能只跳一個會自己消失的提示。
   「按了沒反應」是最難回報的故障。

`#/my` 會把 uid 顯示出來而且可以複製：那是跨專案對帳唯一的鍵
（飛達盃的 uid 必須等於 FC-Football 的 uid，docs/10 §8.5），出問題第一個要對它。

## 報名端（M4-b②）

```
js/modules/register/
├── index.js      路由（/register、/register/new、/join/:code、/team/:id/manage）
├── data.js       Firestore 存取 ＋ 把錯誤碼翻成人話
├── bits.js       表單欄位、狀態徽章、日期格式
├── home.js       報名說明（免登入可看）
├── new-team.js   建立球隊
├── join.js       用邀請碼加入
└── manage.js     隊長端：審核、送出／撤回、公告
```

四頁對應 docs/10 §3 的流程：建隊 → 給邀請碼 → 隊友申請 → 隊長逐筆同意 →
送出報名（凍結）→ 主辦審核。

### 三條寫在畫面上的規矩

1. **報名關著就不要留一顆按下去會失敗的按鈕。** 開放條件是 AND
   （`open === true` **且**在起訖之間），前端與 rules 用同一套判斷，
   而且**讀不到設定一律當關閉**——不然畫面說「開放中」卻在送出時被擋。
2. **送出的申請一定是 `pending`。** 知道邀請碼只能「申請」，隊長同意才是閘門
   （§3.3）。rules 也只放行 pending（R56），前端擋一次只是為了給好的訊息。
3. **凍結要先講，不要讓人填完才被擋。** 球隊已送審時，加入頁直接說明並收掉表單。

`data.explain()` 把 `permission-denied` 翻成「可能是報名已截止，或名單已送審凍結」
——對報名的家長來說，「權限不足」四個字毫無幫助。

### ⚠️ 頁面模組的順序陷阱（已經踩過四次）

頁面模組的共同結構是「先啟動監聽 → 再宣告 helper → render()」。
但 **`onSnapshot` 的第一筆快照可能同步送達**（替身 SDK 會，本機快取命中時也很早），
於是 `render()` 在 helper 還沒宣告時就被呼叫：

```
ReferenceError: Cannot access 'isCaptain' before initialization
```

整頁空白，而且**單元測試看不到**（那是 DOM 層的執行順序）。

> **規矩：`render()` 會用到的東西一律寫成具名函式**（會被提升），
> 不要用 `const foo = () => …`。已經在 `home.js`（M5）、`schedule.js`、
> `division.js`、`match.js`、`register/home.js`、`register/manage.js` 上各中一次。
> E2E 抓得到——每一頁都要有一條「頁面畫得出來」的案例。

## 公開端（M5）

```
js/modules/public/
├── index.js      路由註冊（lazy() ＋ ?v=，同 staff/index.js）
├── data.js       Firestore 存取，onSnapshot 一律經 store.hold
├── selectors.js  純邏輯：排序／分群／篩選／積分榜投影／隱私白名單
├── follows.js    關注（localStorage，免登入個人化）
├── bits.js       共用元件
└── home / schedule / match / division / team / stats
```

公開端**完全免登入**，前端不假裝擋任何東西——邊界在 `firestore.rules`
（公開集合 `allow read: if true`，`members` 連讀都讀不到，已對 demo 實測 403）。

### 這一輪整合時修掉的四個欄位路徑錯誤

M5 是照**想像的 schema** 寫的，四個欄位在真實資料庫裡都不存在（已對
`feda-cup-demo` 逐一核對）。共同特徵是**寫錯路徑不會噴錯，只會安靜地不生效**：

| 讀成 | 實際 | 後果 |
|---|---|---|
| `division.youth` | 沒有這個欄位 | 「兒童組不公開個人射手榜」的守衛永遠不會生效 |
| `division.featureFlags` | `config/featureFlags`（另一份文件） | 同上 |
| `division.mercyRule` | `division.display.mercyRule` | 仁慈規則封頂永遠不生效，兒童組的 12:0 照實印 |
| `division.qualifyCount` | 不存在（規格也沒有） | 晉級區反白永遠不亮 |

判斷「哪些組別不公開個人榜」現在走 `selectors.hiddenScorerDivisions()`，
依據是 `display.scorerBoard === false`（seed 對 u6/u8/u10 就是這樣寫的），
**不把 divisionId 寫死**。而且要在「全部組別」的檢視也篩掉——
只在選了組別時才擋，等於沒擋。

> E2E 的替身資料當時也照著錯的 schema 寫，所以測試看起來全綠。
> **替身資料寫錯 schema 比沒有測試更危險**：它會主動證明錯的東西是對的。
> 現在替身種子已對齊真實資料庫，並補了四條 E2E 專門盯欄位路徑。

### 統計頁只有兩張榜

`boards/scorers`（球員）與 `boards/fairplay`（球隊）是**兩份文件、兩種 rows 形狀**，
畫面分開渲染，不可以互相退回去當備援——那會畫出一張看起來正常、但每個人都 0 分的錯表。

docs/03 §9.1 還列了「助攻榜」，這裡沒有：賽務端目前根本不記錄助攻
（`buildGoalEvent` 有 `assistPlayerId` 欄位，但沒有任何介面會填它），引擎也沒有這張榜。
掛一個永遠「整理中」的分頁只會讓人以為網站壞了，等 M6 補上記錄再開。

## 結果管線（M3.9）

M2 的引擎一直到 M3.9 之前都**沒有任何東西呼叫**——`standing / ranking /
advancement / awards` 有 254 個測試證明算得對，但賽務端送出完賽之後，
積分榜不會動、晉級不會解、最終排名算不出來。M3.9 就是把這條線接起來。

```
functions/
├── index.js      觸發器與 callable：只接參數、驗權限，不含任何計算
├── pipeline.js   結果管線：重算積分榜／解晉級／算最終排名／重建看板
├── store.js      Firestore 存取（設定一律讀 config/*，缺資料一律丟錯）
├── admin.js      firebase-admin 的單一入口（見下方「兩份 admin」）
└── engine/       ⚠️ 建置產物，js/engine/ 的複本，不進版控
```

### 引擎怎麼給 Functions 用（R-ENG-001）

Firebase 部署**只上傳 `functions/` 這一個目錄**，而 `js/engine/` 必須留在
網站根目錄下讓瀏覽器直接載——兩邊都動不了。所以：

```bash
npm run sync:engine          # js/engine/ → functions/engine/
node scripts/sync-engine.js --check   # 檢查一致（CI 會跑）
```

`js/engine/` 是唯一的真相來源；`functions/engine/` 進 `.gitignore`，
由 `firebase.json` 的 `predeploy` 在每次部署前重新產生。
**不要編輯 `functions/engine/` 底下的任何檔案**，下一次同步就會被蓋掉。

`functions/package.json` 是 `"type": "module"`：engine 是給瀏覽器載的 ES module，
不可能改寫成 CJS，而 `require()` 一個 ESM 在 nodejs22 上的行為取決於 patch 版本。

### 兩份 firebase-admin 這個坑

專案裡有兩份 firebase-admin：根目錄一份（測試用）、`functions/` 一份（部署用）。
Node 依檔案位置解析，`functions/` 底下的程式碼拿到的是 `functions/node_modules`
那一份。測試若自己 `initializeApp()`，初始化的是**另一份**的 AppStore，
pipeline 一呼叫 `getFirestore()` 就是「default Firebase app does not exist」。

麻煩的是它只在「有人在 functions/ 跑過 npm install」之後才出現——
CI 只在根目錄 `npm ci`，剛好躲過；本機一起模擬器就炸。
所以所有人一律經過 `functions/admin.js` 拿 db，包含測試。

### 併發模型

積分榜重算放在交易裡，**場次與現有 standing 都在交易內重讀**。
兩個 trigger 同時進來時，後 commit 的那個會撞到版本衝突而重試，
重試會重新讀到最新的場次——所以最後落地的一定是用最新資料算出來的。
（只比 `version` 大小擋不住：兩邊都是 `prev + 1`，先寫的反而可能資料比較新。）

### 公開名冊（roster）的鐵則

`members` 有生日與身分證後四碼，`roster` 是它唯一合法的出口（docs/01b §1.6.1）。

1. **投影是「挑出來」，不是「刪掉不要的」**。前者在 members 新增欄位時預設
   不外洩，後者預設外洩。白名單在 `js/engine/privacy.js` 的 `ROSTER_FIELDS`。
2. **遮蔽依據是年齡，不是組別**。`if (divisionId === 'u10')` 在兩件事上會錯：
   兒童組偶爾有超齡的隨隊職員，成人組也可能有未滿 13 歲的球員。
3. **算不出年齡就遮**。生日缺漏、格式不對、賽事日期讀不到——一律當成未成年。
   反過來寫的話，一筆沒填生日的兒童資料會直接以真名出現在公開端。
4. 不是 `approved` 的成員，投影要**刪掉**。被移除的隊員留在公開名冊上比沒有更糟。

### 公開看板的兩條鐵則

`boards/*` 是 `allow read: if true`，寫進去的東西全世界都看得到。

1. **姓名一律取自 `teams/{t}/roster/{m}` 的 `displayName`**（已遮蔽），
   不可以用 timeline 事件上的 `playerName`——那是賽務端記的真名。
   名冊查不到就留 `null`，公開端顯示背號（R-PRIV-001、docs/03 §7.3）。
2. **單一文件**：`boards/scorers`、`boards/fairplay` 各一份，rows 帶 `divisionId`。
   規格要求首頁只監聽一份文件；每組一份的話公開端得先知道有哪些組別再開六個監聽。

遮蔽規則是「姓氏＋名字首字＋＊」（王小明 → 王小＊）。
`js/lib/format.js` 的 `maskName` 原本寫成「王○明」——遮蔽力更弱，
而且跟 `scripts/seed/build.js` 寫進名冊的那一份不一致，已修正並補上變異 #27。

### fail-closed 是預設值

`rankingRuleId` 打錯、小組設定讀不到、分組賽還沒打完、最終排名算不完整——
一律**丟錯或原地返回，一個欄位都不寫**。fail-open 的程式碼在正常情況下
跟正確的長得一模一樣，只有在資料缺漏的那一天才會現形，而那一天通常是比賽當天。
`npm run test:mutation:fn` 的七條變異守的就是這件事。

## 賽制引擎（M2）

```
js/engine/
├── berger.js        循環賽程 + 蛇形分組（純函式）
├── formats.js       Format / RankingRule / Division 設定（純資料）
├── timeline.js      事件流 → 比分（烏龍球記給對隊）＋ 對帳，賽務端與 Function 共用
├── privacy.js       遮蔽姓名／年齡判定／members → roster 公開投影
├── tally.js         「一批場次 → 每隊統計」的原語，standing 與 ranking 共用
├── standing.js      積分榜：computeRows / buildStanding / isStaleWrite / diffRanking
├── ranking.js       同分排序（§6.4 遞迴）＋ 行為分
├── advancement.js   晉級解算 / 最終排名
└── awards.js        射手榜 / 門將榜 / 行為分排行
```

相依方向是單向的：`tally ← ranking ← standing ← advancement`。
`timeline.js` 不相依任何人（純粹是事件流 → 比分），所以誰都可以用它。
`ranking` 不可 import `standing`（會形成循環），需要積分計算時用 `tally`。

全部是純函式：不碰 Firestore、不呼叫 `Date.now()`、不用隨機。
Function 負責讀寫與填 `serverTimestamp`，引擎只負責算。

### 測試

```bash
npm run test:unit                  # 345 個案例（引擎 T01–T32 ＋ 賽務端核心 ＋ 主題／圖示／撤回）
npm run test:mutation              # 53 條變異，證明測試有鑑別力
npm run test:rules                 # 111 個案例，自動起 Emulator
npm run test:mutation:rules        # 12 條權限規則變異
npm run test:fn                    # 35 個 Function 整合測試（F01–F14 結果管線、FR01–FR08 報名）
npm run test:mutation:fn           # 16 條 Function 變異
npm run test:e2e                   # 264 個 Playwright 案例（× mobile / desktop / 320px）
npm run test:e2e:offline           # 只跑離線三態那幾條
```

E2E 用 `tests/e2e/fake-firebase.js` 取代 gstatic 的 SDK：
測的是我們的程式，不是 Google 的網路，而且離線行為可以精準控制。

改過 `firestore.rules` 一定要重跑 `test:rules`。輸出中若出現
`maximum of 1000 expressions`，代表角色判斷又寫成巢狀鏈了（見 R-RULES-001）。

改過 `js/engine/` 一定要跑 `test:unit` **和** `mutation-check`。
第一版實作的 115 個測試曾經全綠，卻抓不到三個真實缺陷——
「測試綠」本身不是證據，鑑別力才是（見 R-TEST-001）。

E2E 也一樣要驗鑑別力。M3.5 的「離線不給撤回」原本有兩條綠燈的 E2E，
但把 `online` 檢查整條拿掉之後**還是全綠**：那兩條測的情境剛好
`scoreSubmittedAt` 本來就是 `null`，被下一道防線接住了。
真正只有 `online` 擋得住的是「線上送出之後才斷線」，補上那一條才有鑑別力。
改完一個行為，順手把它改壞一次再跑一遍——這件事只花一分鐘。
