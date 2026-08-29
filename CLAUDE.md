# toosterx-tournament｜AI 專案指引

> 這份是給 AI 助手（與新加入的人）的單一真相來源。完整規格在 `docs/`。

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
| R-RULES-002 | 動態權限（`rolePermissions`）只用在 UI 層，不進 rules；rules 只做粗粒度的角色 × 指派範圍 × 欄位白名單 |
| R-ENG-002 | 引擎的比分／數值一律用嚴格型別檢查，禁用 `Number(v)`——`Number(null)` 是 0，會把「沒填比分」判成 0:0 平手 |
| R-ENG-003 | 行為分（−3／−5）是「同一場、同一球員」的判定，彙總時分堆鍵**必須含 matchId**；卡片時序以 `clockSec` 為權威 |
| R-ENG-004 | 引擎不呼叫 `Date.now()` 或任何隨機來源。時間戳由呼叫端填，同分排不出來就標 `hasUnresolvedTie`，絕不隨機 |
| R-ENG-005 | 缺資料時一律 fail-closed（回 `null`／`ready:false` 並附原因），不可「沒資料就當作通過」 |
| R-TEST-001 | 修好一個缺陷就要在 `scripts/mutation-check.cjs` 加一條變異，證明測試真的抓得到。全綠但沒有鑑別力的測試比沒有測試更危險 |
| R-SRC-001 | 原始碼不得含 NUL 位元組（git 會當成二進位檔，看不到 diff）。CI 有檢查 |
| R-UI-001 | 換節點一律用 `mount(node, ...)`，禁用 `node.replaceChildren(...)`——後者會把 `null` 印成字串 "null" |
| R-UI-002 | 送出後**不可** `await` Firestore 的 Promise 再更新 UI。離線時它永遠不會 resolve，畫面會卡住 |
| R-UI-003 | 所有 `onSnapshot` 一律經 `store.hold(scope, unsub)` 註冊，換頁自動回收 |
| R-REL-015 | `js/` 與 `css/` 一律 `max-age=0, must-revalidate`（見 `_headers`）。Cloudflare Pages 預設 4 小時，會造成「新 HTML 配舊模組」的混版；動態 import 的網址帶不了版號，這是唯一的解 |
| R-REL-016 | 動態 `import()` 一律經過 `router.lazy()`，並在網址加 `?v=CACHE_VERSION`：重試要換 query 才有效（瀏覽器會記住失敗的模組網址） |
| R-DEMO-001 | Demo 專屬程式碼只放 `js/modules/demo/`，正式版**不 import**（不是用旗標關掉） |

## 不可協商的產品行為

1. **送出三態**：賽務端每一次送出都要明示「已儲存／待同步／失敗」，絕不假成功
2. **離線可用**：檢錄與比分記錄在飛航模式下必須能完成，恢復連線自動補送
3. **一切可修正、一切留痕**：所有結果性資料 Admin 都能改，且必留 before/after/who/when/why
4. **同分不隨機**：條件用盡就標記 `hasUnresolvedTie`，等主辦裁定

## 測試

```
npm run test:unit    賽制引擎（T01–T16，見 docs/02 §11）
npm run test:rules   R01–R23（見 docs/07 §2.4）
npm run test:e2e     Playwright
```

CI 紅燈必須先修復。targeted test 不能替代完整 suite。

## 部署

```
npm run deploy:rules:demo      firestore.rules + 索引（Spark 方案就能跑）
npm run deploy:storage:demo    storage.rules（需 Blaze + Console 先啟用 Storage）
npm run deploy:fn:demo         Cloud Functions（需 Blaze）
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
- [ ] M4 公開端　[ ] M5 檢錄＋Challenge　[ ] M6 彩排　[ ] M7 上線

## 賽務端（M3）

```
js/core/
├── firebase.js   SDK 初始化（本機持久化快取）、Auth、連線偵測、伺服器校時
├── store.js      onSnapshot 註冊與回收（超過 MAX_LISTENERS 會警告）
├── sync.js       送出三態 queued / saved / failed，離線佇列與重試
├── clock.js      比賽時鐘（純函式）＋ 期別狀態機
├── router.js     hash 路由，換頁自動回收該頁監聽
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

## 賽制引擎（M2）

```
js/engine/
├── berger.js        循環賽程 + 蛇形分組（純函式）
├── formats.js       Format / RankingRule / Division 設定（純資料）
├── tally.js         「一批場次 → 每隊統計」的原語，standing 與 ranking 共用
├── standing.js      積分榜：computeRows / buildStanding / isStaleWrite / diffRanking
├── ranking.js       同分排序（§6.4 遞迴）＋ 行為分
├── advancement.js   晉級解算 / 最終排名
└── awards.js        射手榜 / 門將榜 / 行為分排行
```

相依方向是單向的：`tally ← ranking ← standing ← advancement`。
`ranking` 不可 import `standing`（會形成循環），需要積分計算時用 `tally`。

全部是純函式：不碰 Firestore、不呼叫 `Date.now()`、不用隨機。
Function 負責讀寫與填 `serverTimestamp`，引擎只負責算。

### 測試

```bash
npm run test:unit                  # 221 個案例（引擎 T01–T28 ＋ 賽務端核心）
npm run test:mutation              # 14 條變異，證明測試有鑑別力
npm run test:rules                 # 52 個案例，自動起 Emulator
npm run test:e2e                   # 26 個 Playwright 案例（賽務台）
npm run test:e2e:offline           # 只跑離線三態那一條
```

E2E 用 `tests/e2e/fake-firebase.js` 取代 gstatic 的 SDK：
測的是我們的程式，不是 Google 的網路，而且離線行為可以精準控制。

改過 `firestore.rules` 一定要重跑 `test:rules`。輸出中若出現
`maximum of 1000 expressions`，代表角色判斷又寫成巢狀鏈了（見 R-RULES-001）。

改過 `js/engine/` 一定要跑 `test:unit` **和** `mutation-check`。
第一版實作的 115 個測試曾經全綠，卻抓不到三個真實缺陷——
「測試綠」本身不是證據，鑑別力才是（見 R-TEST-001）。
