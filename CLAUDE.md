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
| R-SCHED-001 | 賽程的產生與排定只有 `js/engine/schedule.js` 一份實作，種子腳本與管理後台共用。抽籤的亂數**種子由呼叫端提供**並寫進 `audits`——規章第十四條要的是抽籤，而抽籤的價值在於事後重放得出來 |
| R-SCHED-002 | 組別只要有**任何一場**已開打（非 `scheduled`／`checkin`／`ready`／`postponed`／`cancelled`）就不得重新產生賽程。重抽一次籤，打完的那幾場會變成不同小組之間的比賽 |
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
npm run test:unit         賽制引擎（T01–T45，見 docs/02 §11）
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
- [x] M4-c   管理後台（七項全部完成）
      - [x] 報名審核 `#/admin/teams`（名單檢核＋核准／退回＋留痕）
      - [x] 身分授權 `#/admin/staff`（指派／場地／停用，總管專屬）
      - [x] 權限開關 `#/admin/perms`（逐條開關＋留痕，總管專屬）
      - [x] 稽核紀錄 `#/admin/audits`（唯讀，兩種欄位形狀都讀得懂）
      - [x] 報名開關 `#/admin/registration`（開關／起訖／規章欄位唯讀，總管專屬）
      - [x] 賽程管理 `#/admin/schedule`（抽籤／產生／排定／檢查／發布，見下方章節）
      - [x] 挑戰攤位 `#/booth`（M6-b，見下方章節）
      ・總管仍由 `scripts/grant-super-admin.mjs` 建立（Admin SDK，不經 rules）
- [x] M4-c＋ 場次改判 `#/admin/match/:matchId`（覆核／重開／改判／棄賽，見下方章節）
- [x] M4-c＋ 人工裁定同分 `#/admin/standings`（抽籤／裁定／解除，見下方章節）
- [x] M4-d   「我的球員」：`#/my` 跨球隊列出自己報的球員（collectionGroup 規則 R134、T53、
      E2E、變異 #MP1–#MP4／#E15／RU#38–#39，見下方「我報名的球員」）
- [x] M4-b④  依競賽規章校正設定＋未成年組教練管理名單＋檢錄台
- [x] M4-b⑤  資訊架構重整：角色階層（向上包含）＋權限矩陣＋專屬首頁＋
      常駐頁首（登入／我的）＋主題只留圖示＋移除關注功能
- [x] M6 Challenge 挑戰系統（a 引擎與管線、b 攤位端、
      c 玩家端＝QR 產生器／Game Pass／首頁／排行榜、d 抽獎名單 CSV）
- [x] 規章補齊（2026-09-05）：申訴登記與裁決、眼鏡切結書、取消報名／退費、
      直播設定、中獎聯絡方式、三張教學卡、Lighthouse 首次量測與首屏修正
- [ ] M7 彩排 → 上線

## 現在的狀態（2026-09-05）

| 關卡 | 狀態 |
|---|---|
| `npm run test:unit` | ✅ 1117 全綠（46 個 suite） |
| `npm run test:mutation` | ✅ 281 / 281 全被抓到 |
| `npm run test:mutation:e2e` | ✅ 17 / 17 全被抓到（畫面層時序、權限與替身語意） |
| `npm run test:e2e` | ✅ 1068 全綠（mobile / desktop / 320px 三種寬度） |
| `npm run test:rules` | ✅ 229 全綠（…、R133 球員上限、R134 我的球員、R135 申訴、R136 取消退費、R137 聯絡方式、R138 眼鏡切結書、R139 憑證雜湊） |
| `npm run test:mutation:rules` | ✅ 42 / 42 全被抓到 |
| `npm run test:fn` | ✅ 84 全綠（F01–F15j 結果管線與同分裁定、FR01–FR15e 報名／登入／規章第十二條、FC01–FC15f 挑戰與聯絡方式） |
| `npm run test:mutation:fn` | ✅ 27 / 27 全被抓到 |

### 「變異漏掉」有四種原因，不是只有一種

R-TEST-001 的重點是鑑別力，但報告上的紅字要先分清楚是哪一種：

| 症狀 | 原因 | 例子 |
|---|---|---|
| `❌ 漏掉` | **測試不夠力** | #CH4：用 3 分測「沒有上下限就擋下」，被下一行 `n > max` 接住了；真正會漏的是 0 分 |
| `❌ 漏掉` | **那段程式碼沒有作用** | #S16 的日期過濾、#CH12 的 `voided !== true`——上游已經濾過了，濾不濾都一樣 |
| `❌ 漏掉` | **測試剛好走在等價的那一邊** | #LB6：`String(null).localeCompare(String(null))` 也是 0，兩邊都 null 的測試證明不了那個守衛；混合的那一種才會 -1 |
| `❌ 漏掉` | **只有別的層在測** | #GP7／#GP8：E2E 明明有守「抽獎張數是 0」，但 `test:mutation` 跑的是**單元測試**，所以照樣逃掉 |
| `⚠️ 找不到要變異的程式碼` | **錨點過期** | #H4 的字串帶著 `pending: true`，功能上線把旗標拿掉之後就對不上了 |

第四種很容易看漏：**「某一層有測」不等於「變異抓得到」**。
每一支變異執行器只跑它自己那一套測試——

| 執行器 | 跑的是 |
|---|---|
| `test:mutation` | `test:unit` |
| `test:mutation:e2e` | 指定的那幾支 spec |
| `test:mutation:fn` | `test:fn`（Emulator）|
| `test:mutation:rules` | `test:rules` |

所以一段**只有 E2E 在守**的邏輯，`test:mutation` 一定抓不到。
`newPlayerDoc` 就是這樣：E2E 明明斷言了 `luckyDrawEntries === 0`，
但那是純函式、該有單元測試（補上 T46-9 之後才有鑑別力）。

最後那一種在 `mutate.cjs` 會印 `⚠️` 並在清單標「（變異失效）」，跟前幾種區分得很清楚——
**但用 grep 過濾輸出時很容易把它濾掉**（2026-09-05 就這樣誤判了一次）。
過濾時樣式要包含 `⚠️`，或者跑完直接看最後幾行。

> 想單獨檢查所有錨點還對不對：`npm run check:anchors`（兩秒，唯讀）。
> 它把四支 mutation-*.cjs 當文字解析，逐條確認 `from` 還在目標檔裡找得到。
> CI 也有這一步，排在變異殘留檢查後面。
>
> ⚠️ **不要 `require()` 那幾個檔案**：結尾是 `process.exit(runMutants(...))`，
> require 等於真的跑一次整套變異（2026-09-05 不小心啟動過一次，被守衛接住）。
> `check:anchors` 因此純粹做文字解析，一行原始碼都不寫。
>
> ⚠️ 變異正在跑的時候它會**拒絕執行**（結束碼 2）：那一刻原始碼本來就是
> 被改壞的，比對錨點會得到一堆假的「過期」。第一次跑就中了這個。

**2026-09-05 的實例**：拿掉 `players` 規則裡的 `contact` 之後，RU#34 的錨點
就對不上了。報告印的是 `⚠️ 找不到要變異的程式碼`，但它跟「漏掉」一起
列在最後的清單裡——而且是**跑完 25 分鐘才知道**。`check:anchors` 就是
為了把那 25 分鐘變成兩秒。

### 這一輪（賽程管理）值得記下的兩件事

1. **`schedule.manage` 的 `pending: true` 一拿掉，`permtoggle.test.js` 就紅了。**
   那正是它存在的理由（見「`pending: true` 的意思被釘死成…」那一段）——
   功能接上 `can()` 的那一刻，測試會提醒你把旗標拿掉。
   那條測試現在改用 `match.confirm` 當「還沒上線」的例子。

2. **第一版的變異 #S16 抓不到，因為它改的是一段沒有作用的程式碼。**
   原本寫「佔用要濾掉別的日期」，但佔用是用**時間區間**判斷的，
   別天的場次算出來的區間本來就不會重疊——濾不濾都一樣。
   而且用 `date` 欄位濾**反而有害**：`date` 跟 `kickoffAt` 對不起來的資料，
   會讓一個真的撞場被濾掉。所以拿掉那段，把 #S16 改成守
   「自己這一組要濾掉」（不濾的話重排一次就整批往後擠）。

   ⚠️ 改完之後它**還是抓不到**：測試給了兩片場地，被自己擋住的那一場
   挪到另一片，時間仍然是 08:30。改成只給一片場地才有鑑別力。
   「變異抓不到」有兩種原因——測試不夠力，或那段程式碼根本沒有作用。
   兩種都要查清楚是哪一種，不要直接補一條測試了事。

### 上一輪（M3.5 收尾）審查抓到並修掉的三個缺陷

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

- ~~`buildFinishPatch` / `buildUndoPatch` 會靜靜刪掉 `lock.lockedAt`~~
  ✅ **已修**：`buildUndoPatch` 自己寫齊三個欄位，`submitFinish`（資料層）
  補 `lockedAt: serverTimestamp()`。管理端的 `buildReopenPatch` /
  `buildWalkoverPatch` 也一樣寫齊，變異 #MA4 守著。
  ⚠️ 這條規矩在**任何**寫 `lock` 的地方都成立：`updateDoc` 對巢狀 map 是
  整包取代，少列一個欄位就等於把它從文件上刪掉。
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

**正式站已於 2026-09-05 第一次完整部署**：`main` = demo（0aa9184）、rules／索引、
22 支 Functions、34 筆設定文件（`scripts/bootstrap-prod.mjs`）、signBlob 授權、
映像檔清理政策（asia-east1，3 天）。煙霧測試 14 項全過（免登入 REST 打 rules）。

1. ~~Blaze 升級~~ ✅　~~兩組 LIFF Channel~~ ✅　~~報名截止日~~ ✅（demo，截止 10/8 00:00）
   ⚠️ 截止日仍建議提前到 9/28 或 10/1——彩排排在 10/6–10/7，
   10/8 才截止的話彩排時名單還沒定案
2. ~~授權 `signBlob`~~ ✅ demo 與正式站都已完成（正式站 2026-09-05，在第一次 `deploy:fn:prod` 之後）
3. ~~Cloudflare Browser Cache TTL~~ ✅ 已完成，兩個網域實測都回我們自己的標頭
4. ~~Functions 映像檔清理政策~~ ✅ 兩個專案都設好（要帶 `--location asia-east1`，
   不帶的話它去找 us-central1 然後說「請先部署 Functions」）
5. ~~GitHub Actions 帳務~~ ✅ 主辦 2026-09-05 決定把倉庫改成**公開**，Actions 不再計費
   （私有倉庫每月 2,000 分鐘，9/4 一天就燒掉近 1,000 分鐘——每次 push 五條工作含三套變異）。
   改公開前掃過整個歷史：沒有私鑰、沒有憑證檔，兩個 zip 快照裡也沒有
6. ~~LINE Developers~~ ✅ LIFF `2011382367` 的 Endpoint URL 本來就是 `https://cup.toosterx.com`
7. ~~正式站的總管~~ ✅ uid `U7774e14…`（與 demo 的「小麥（大總管）」同一個 LINE Provider，uid 相同）
   已用 `grant-super-admin.mjs` 授權
8. **正式站 `#/admin/registration` 開放報名並設截止日**（主辦指定 2026-09-24 00:00）

> ⚠️ **正式站的 Firebase Authentication 要先在 Console 按一次「開始使用」**（2026-09-05 才發現）。
> 沒按之前 Auth 的設定根本不存在，`signInWithCustomToken` 會回
> `auth/configuration-not-found`，`listUsers()` 回「There is no configuration corresponding
> to the provided identifier」——LINE 那邊授權成功、回到站上卻登不進去。
> demo 能用是因為建 demo 時有人按過。**不需要啟用任何登入方式**：正式站只用 custom token，
> demo 的「匿名」只給 `js/modules/demo/` 的自助身分用（R-DEMO-001）。docs/11 §1.6。

> 第一次對新專案部署 Firestore 觸發器會拿到
> `Permission denied while using the Eventarc Service Agent`（HTTP 400）——
> 不是設定錯，是 Eventarc 服務代理的權限還在傳播。等兩三分鐘再對那幾支重跑
> `firebase deploy --only functions:onMatchWritten,… --project prod` 就好。2026-09-05 就是這樣過的。

### 下一個里程碑

**M4-c 七項全部完成**，加上場次改判、人工裁定同分，以及 **M6 挑戰系統全部完成**
（引擎／管線／攤位端／玩家端／抽獎名單 CSV）。
主辦在 demo 上可以走完一整條線：
報名 → 審核 → 抽籤 → 產生賽程 → 排定時間 → 發布 → 檢錄 → 記分 →
積分榜 → **裁定同分** → 晉級 → 最終排名 → **覆核／改判** → 挑戰攤位登錄。

接下來依序是：

1. **正式站上線**（2026-09-05 進行中）：merge main → `deploy:rules:prod` →
   `deploy:fn:prod` → 小麥授權 signBlob → `bootstrap-prod.mjs` → 小麥 LINE 登入 →
   `grant-super-admin.mjs` → 開報名。步驟在 docs/11 §5。
2. ~~M4-d「我的球員」~~ ✅ 2026-09-05 完成。
3. **M7 彩排（10/6–10/7）**。

CI 曾在 2026-09-04 18:19 到 09-05 之間完全沒有跑（私有倉庫的 Actions 分鐘用完、
預算 $0）。主辦 2026-09-05 把倉庫改成公開後重跑 `main` 與 `demo`，兩條都綠——
CI 跑 Linux，專門抓 CRLF、路徑大小寫這類本機看不到的問題，現在又有人在守了。

規章有、系統原本沒有的三件——申訴（賽後 30 分鐘＋保證金 2000）、眼鏡切結書、退費機制——
**2026-09-05 已全部做完**（見「規章補齊」那一節），連同直播設定與中獎聯絡方式。
（每人限報乙隊的跨隊檢查、球員人數上限的伺服器端強制：同日已做，見「規章第十二條」那一節。）

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

### ⚠️ 不要自己寫一支「只跑幾條變異」的臨時腳本（2026-09-05 又中一次）

想快速確認新加的幾條變異抓不抓得到，很容易寫一支十幾行的腳本：讀
`mutation-check.cjs`、逐條套用、跑測試、`finally` 還原。**那支腳本會在
`finally` 裡出錯**——我那一次是 `finally` 引用了一個改名後不存在的變數，
於是 `js/modules/challenge/pass.js` 與 `js/engine/challenge.js` 停在變異狀態，
而且**`.mutation-in-progress.json` 不存在，守衛完全不會發現**。

上面那三層防護保護的是 `scripts/lib/mutate.cjs`，不是你臨時寫的東西。
所以規矩很簡單：**要跑變異就跑 `npm run test:mutation`**，慢十分鐘總比
把一個「暱稱上限 20」的變異 commit 進去好——那一條會讓畫面說可以、
送出被 rules 擋掉，而且在測試裡是綠的。

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

### 規章有、系統原本沒有的

申訴（第二十條）、眼鏡切結書（附件二）、退費機制（第二十七條）——**2026-09-05 已做**
（見「規章補齊」那一節）。每人限報乙隊與 15 人上限的伺服器端強制同日已做（見下一節）。

### 規章第十二條的伺服器端強制（2026-09-05）

```
js/engine/review.js      isPlayer（唯一定義）、personKeysOf（「這是誰」的鍵）
functions/pipeline.js    recountTeamMembers（多維護 playerCount）、
                         rejectCrossTeamDuplicate、enforceRosterCap
firestore.rules          playerRoomLeft(tid, kind)：擋第 16 位的建立與同意
firestore.indexes.json   members 的 collection-group fieldOverride（idLast4、guardianUid）
```

**球員最多 15 人**是兩層：

| 層 | 做什麼 | 為什麼還需要另一層 |
|---|---|---|
| rules | 看球隊文件上的 `playerCount < 15`，第 16 位一按下去就被擋 | 那個數字是 Function **事後**算的，兩位教練同一秒各加一人兩筆都會過 |
| Function | `enforceRosterCap`：已核准的球員依核准時間排序，第 16 位起退件 | 權威。rules 只是讓人不用等一秒才知道不行 |

⚠️ **只數球員**（`isPlayer`，跟審核頁同一份）。把教練也算進 15 人，一支滿編的隊
就登記不了領隊——那是比賽當天才會發現的事（R133c、FR15d、FN#24）。

⚠️ rules 裡的 `15` 是寫死的（rules 進不了 formats.js）。
`tests/unit/regulation-parity.test.js` 逐字對照 `REGISTRATION_LIMITS.maxPlayers`。

**每人限報乙隊**只在 Function（rules 查不到別隊的名單）。「同一個人」的判斷在
`personKeysOf`：身分證後四碼＋生日**兩個都有**才算，或本人用自己帳號報名的 uid。
**家長的 uid 不算**——一位家長替兩個小孩報不同隊是合法的（FR07、FR14f）。

⚠️ 查的是 `members` 的 **collection group**。`idLast4` 與 `guardianUid` 在
`firestore.indexes.json` 有 collection-group 的 fieldOverride，**正式站沒部署索引
會直接 FAILED_PRECONDITION，而模擬器不會**（模擬器不查索引）。`deploy:rules:*` 會一起部署。

### 正式站的設定怎麼進去（`scripts/bootstrap-prod.mjs`）

種子腳本依 R-SEED-001 只准對 demo 跑，而後台沒有建立組別／場地／關卡的介面——
所以正式站的設定由這一支灌：用**同一份** `scripts/seed/build.js` 的 builder，
只留設定類的 34 筆（組別、場地、五關、抽獎規則、賽程參數、LINE、報名開關、
角色權限、空排行榜），1198 筆假隊伍與比賽整批丟掉。

三條規矩：**只補不存在的、永遠不覆蓋**（重跑不會把總管調過的東西打回去）；
對正式專案要 `--yes`；路徑白名單以外一筆都不寫。`seedData` 旗標一律拿掉——
`seed.js --reset` 是依那個旗標刪文件的。

```bash
node scripts/bootstrap-prod.mjs --project feda-cup-2026 --dry-run
node scripts/bootstrap-prod.mjs --project feda-cup-2026 --yes
```

### 拿掉的兩支排程 Function（2026-09-05）

`refreshBoards`（每 1 分鐘）與 `detectAnomalies`（每 5 分鐘）從 M3.9 起一直是空的
stub，卻部署在 demo 上每分鐘白跑。已從程式與 demo 雲端刪除（docs/07 §3.1 已註記）。
要做保底重建時再加回來，而且要有內容。

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
├── teams.js   報名審核 #/admin/teams
├── staff.js   身分授權 #/admin/staff
├── perms.js   權限開關 #/admin/perms
├── audits.js  稽核紀錄 #/admin/audits
└── registration.js 報名開關 #/admin/registration
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

### 身分授權（js/engine/assign.js）

總管在 `#/admin/staff` 把賽務身分指派給人。四件不可協商：

1. **指派不出總管。** `ASSIGNABLE_ROLES` 寫成 `STAFF_CHAIN.slice(0, -1)`
   而不是另外列一份陣列——兩份清單遲早分岔，而分岔的方向如果是
   「多列了 super_admin」，就是一個介面上點得到的提權漏洞。
   單元測試把它跟 `firestore.rules` 的 `staffRolesAssignable()` 白名單對比。
2. **總管自己那一列連編輯器都不畫**（`assignableHere()`）。
   把總管改成管理員在 rules 上完全合法（admin 在白名單裡），畫面也會顯示
   「已更新」——但可指派的清單裡沒有 super_admin，**降下去就再也升不回來**。
   最後一位總管降級等於再也沒有人指派得了身分。
3. **身分是單選，而且每一顆按鈕都寫著「含挑戰攤位、檢錄員、裁判」。**
   向上包含（R-ROLE-002）看不見的話，總管會四個角色各指派一次。
4. **停用是改 `active` 不是刪文件。** 賽後要查得到某一筆比分是誰記的。

`staff.roles` **只存被指派的那一個**，不存展開後的四個：存展開的話
「他到底被指派了什麼」就再也看不出來，而且日後調整階層要重寫所有人的資料。
展開是讀取時算的（`impliedRoles`）。

管理員以上不受場地限制（rules 的 `assignedVenue()` 對 admin 直接放行），
所以選了管理員就把場地選擇器收掉、舊的 `venueIds` 也一併清空——
留著會顯示一組其實不生效的限制。

#### 名錄是 `users`，不是憑空查得到的

LINE 的 uid 沒辦法憑空產生，所以「指派身分」的第一步永遠是
「請對方先用 LINE 登入一次」，這句話寫在頁面上。

⚠️ `onTeamWritten` 會把 `teamCount` 寫進 `users/{captainUid}`，
所以**隊長的名錄文件本來就會存在，只是沒有 displayName**。
種子因此補寫隊長的名字——不補的話 demo 上會出現三十幾列只有 uid 的空白項目
（`tests/unit/perms.test.js` T42-7 盯著）。正式站不會有這個問題。

⚠️ 這一頁管不到的角色（已移除的 `venue_lead`、FC 同步過來的 `captain` 等）
要**照原樣印出來**，不可以顯示成「未指派」——看起來像沒有身分的話，
總管永遠不會發現它還在資料庫裡。demo 上真的有兩份 `venue_lead` 的殘留。

### 稽核紀錄（`#/admin/audits`、`js/engine/audit.js`）

整頁唯讀。稽核只能新增（R-SEC-002），所以這裡連一顆「清除」都不該有。

⚠️ **這個集合有兩種欄位形狀**，因為歷史上有三個寫入者：

| 寫入者 | 目標欄位 |
|---|---|
| `js/modules/staff/data.js`（賽務端）| `entity` / `entityId` |
| `functions/store.js`（結果管線）| `entity` / `entityId` |
| `js/modules/admin/data.js`（管理後台，早期）| `targetType` / `targetId` |

管理後台已改用 `entity` / `entityId`（跟另外兩個一致），但 demo 上已經有
14 筆舊形狀的紀錄，而**稽核紀錄不可以改寫**——所以 `normalizeAudit()`
的收斂只能發生在讀取時，而且**要永遠留著**。變異 #G1 守這件事。

三件容易做錯的：

1. **`actor.name` 不能信。** 賽務端寫的是 Firebase 使用者的 displayName，
   而 custom token 登入的人那一格永遠是 null（docs/10 §8.5）。
   名字一律讀取時再查，而且**要查兩個集合**：先 `users/{uid}`（LINE 名稱），
   查不到再 `staff/{uid}`——用 `grant-super-admin.mjs` 建立的總管與
   demo 的自助身分**只有後者**，少了那一路稽核頁會印出一長串 uid。
   兩邊都查不到才退回 uid，顯示空白會讓人以為紀錄壞了。

   ⚠️ 「by 誰」由 `actorText()` 算，**畫面與搜尋用同一支**。第一版畫面
   自己算一份、搜尋另外組一份，結果每一列都寫著「by 金小麥」，
   搜「金小麥」卻是 0 筆——使用者搜的是他看到的字（變異 #G6）。
2. **還沒同步的時間顯示「同步中」**，不要填本機時間：那會讓稽核的
   時間軸失真，而時間軸正是這一頁的用途。而且它在 desc 排序裡會落在
   **最後**（Firestore 的 null 最小），不是假裝自己最新。
3. **不認得的動作照原樣印出來。** 日後新增的動作在 `describeAudit()`
   還沒有分支時，主辦仍然要看得到「發生過某件事」。

### 報名開關（`#/admin/registration`、`js/engine/registration.js`）

開放條件是 **AND**：主辦手動開關 **且** 現在在起訖區間內。所以這一頁最上面
顯示的是「現在到底開不開放」，不是那個開關本身——只看開關會讓主辦以為
還開著，而家長看到的是「報名已經截止」。

判斷只有一份（`registrationState()`），報名端 `js/modules/register/data.js`
轉一手。單元測試逐字比對 `firestore.rules` 的 `regOpen()`：兩邊分岔的方向是
「畫面說開放、送出被規則擋掉」。讀不到設定一律當關閉（fail-closed）。

**人數上限與費用不在這一頁**：那些照規章第十二條，權威在
`js/engine/formats.js` 的 `REGISTRATION_LIMITS`（R-REG-001）。
寫入一律 `merge`，不會把 `config/registration` 上那幾個欄位抹掉。

日期提醒（起訖顛倒、截止已過、晚於比賽日）**全部是 warn，沒有一條擋得住
儲存**——規章沒寫的事情不要升成錯誤（跟報名審核同一條界線）。

#### ⚠️ 空白的日期要填得進去（正式站 2026-09-05 開報名時中的）

民國年三格每打一格就 `onChange`，日期還不完整時收到的是 `null`；頁面照著
`render()` 整頁重畫，三格從空的草稿重建——**剛打的「115」立刻不見**，空白的截止日
永遠填不進去。demo 有種子日期（只改年份就是合法日期），所以 E2E 全綠、沒人發現。

修法兩件：`rocDateInput` 多收 `parts`（打到一半的三格）並在 `onChange` 一起吐回來，
頁面把它存在 `state.parts` 重畫時傳回去；重畫完用 `restoreFocus()` 把焦點與游標放回
原本那一格——不然「24」會打成「2」就得再點一次。E2E 從空白填到完整、再用鍵盤改
一格，變異 #E13／#E14 守著。**任何會在 `onChange` 裡重畫的頁面用 `rocDateInput` 都要傳 `parts`**；
`register/manage.js` 的球員生日不重畫，所以沒事。

#### ⚠️ Firestore 的規則跨路徑是 OR，不是「以最具體的為準」

`registration.manage` 的 minRole 是 super_admin 而且 destructive，
所以 `config/registration` 的寫入要收到總管（R-PERM-002）。

**不可以**另外加一條 `match /config/registration` 來收緊：

```
match /config/registration { allow write: if isSuperAdmin(); }   ← 沒有用
match /config/{key}        { allow write: if isAdmin(); }        ← 這條照樣放行
```

多條路徑同時命中時 Firestore 是 **OR**——上面那樣寫，管理員仍然改得動，
而且看起來完全像收緊了。條件必須放進**同一條**：

```
match /config/{key} {
  allow write: if key == 'registration' ? isSuperAdmin() : isAdmin();
}
```

變異 RU#30 就是把那個錯版本試一次，確認 R114 抓得到。

### 場次改判（`#/admin/match/:matchId`）

```
js/modules/admin/match-actions.js  純邏輯：各種 patch 與護欄
js/modules/admin/match.js          畫面
```

⭐ **這是比賽當天記錯分時唯一的補救工具。** 賽務台送出完賽超過三分鐘就鎖住了
（rules 分支 (D) 的視窗過了），在這一頁出現之前，現場只能請主辦直接開
Firestore Console 改資料。入口在賽程管理頁——已開打的那幾列。

| 動作 | 權限碼 | 行為 |
|---|---|---|
| 覆核完賽 | `match.confirm` | `finished` → `confirmed`。**不必填原因**（不是破壞性的）|
| 重開場次 | `match.reopen` | 退回 `live`、解鎖、清 result。**比分與事件全部保留** |
| 改判比分 | `match.score.override` | 含 PK，`result` 跟著重算，`revisionCount` 累加 |
| 判棄賽 | 同上 | 規章第十八條第 6 款 **0:2**，由 `DEFAULT_WALKOVER` 算 |
| 延期／取消 | 同上 | **不清比分**（延期的場次改天還要打）|

#### 四件不可協商

1. **改比分一定要重算 `result`。** `result.winner` 與積分是積分榜的唯一依據；
   只改 score 不改 result，畫面顯示 2:1、積分卻記著對手贏，而且不會報錯（變異 #MA1）。
2. **PK 只在正規時間平手時才決定勝負**（變異 #MA2）。反過來寫的話，
   2:1 但 PK 輸的那一場會被判成敗——那在足球裡不存在。
3. **棄賽比分不給填。** 手填會讓不同場次的判法不一致，而那要到頒獎才看得出來（#MA5）。
   `walkoverSide` 記的是**棄賽那一方**，對手獲判勝（#MA6）。
4. **每個動作必填原因並寫進 audits**，而且**按下去之前先講後果**——
   重開會讓積分榜收回分數、已解算的晉級要等重新完賽才更新。

⚠️ 重開之後，**已經解出來的晉級名單不會自動回捲**：`canResolve` 要求該階段
全部完賽，重開之後條件不成立，所以要等這一場重新完賽才會重解。下游若還沒開打
就會被正確覆寫，這件事寫在確認框裡。

### 人工裁定同分（`#/admin/standings`）

```
js/modules/admin/standing-actions.js  純邏輯：同分群、上下移、抽籤、pins
js/modules/admin/standings.js         畫面
functions/pipeline.js                 setManualRankingFor / clearManualRankingFor
functions/index.js                    callable `setManualRanking`
```

⭐ **這是「完全同分」唯一的出口。** 規章第十九條列了五個順位，第五項是抽籤，
而引擎依 R-ENG-004 不擲骰子——它只標 `hasUnresolvedTie` 等人回填。
在這一頁出現之前那個標記是**死路**：

```
hasUnresolvedTie: true
  → explainTeamSource 回 miss
  → 晉級永遠解不開（冠軍賽的隊伍停在「A組第1名」）
  → 最終排名算不出來
  → 那一組打不完，而且不會有任何錯誤訊息
```

U6 只有 3 隊、女子組 5 隊，全部同分的機率不是零（F15 用「六場全部 1:1」
在模擬器上重現了一次）。

#### 引擎早就準備好了，缺的只有入口

`buildStanding({ ..., manualPins })`、`applyManualRanking`、`manualPinsOf`、
`standing.manualOverride` 從 M2 就在，T21 也一直綠著——但
`functions/index.js` 那一行是 `unimplemented('setManualRanking', 'M4')`，
所以**引擎算得再對也沒有任何東西呼叫它**（跟 M3.9 之前的積分榜同一個形狀）。

#### 五件不可協商

1. **一定要走 callable，前端不直接寫 `standings/`**（雖然 rules 對 admin 放行）。
   名次要由 `buildStanding` 重算，而重算需要 `rankingRule`、`cardEvents`、
   `withdrawnTeamIds`、`mercyRule`——前端自己拼一份 opts 遲早會跟管線分岔，
   而分岔的症狀是「積分榜的數字對不上」，不會有任何錯誤訊息。
   而且直接寫的話晉級不會被解算，那正是這個功能存在的理由（F15b）。
2. **名次用原本那一群佔的名次，不是 1、2、3**（變異 #SR1）。第 3、4 名同分時
   裁定的是「誰第 3 誰第 4」；寫成 1、2 的話 `applyManualRanking` 不會抱怨，
   它只是照著釘——然後那兩隊會被搬到榜首。
3. **抽籤要留下種子**（變異 #SR7、R-ENG-004）。規章要的是抽籤，而抽籤的價值
   在於事後重放得出來。種子由畫面產生（`newSeed()` 是唯一碰 `Math.random()`
   的地方，它刻意**不在引擎裡**），寫進 `audits` 與 `manualOverride.drawSeed`。
   洗牌直接用 `js/engine/schedule.js` 的 `drawOrder`，不寫第二份。
4. **旗標要寫在重算之前。** `recalcStandingForGroup` 裡是整份
   `tx.set(ref, {...doc})`（不是 merge），而 `doc.manualOverride` 是從交易內
   讀到的 prev 抄過來的——先重算再補旗標的話，中間那一瞬間只要有另一個
   `onMatchWritten` 進來就會讀到 `enabled: false` 而把裁定沖掉。
5. **解除裁定之後「待裁定」會變回來——那是對的**（F15e）。條件真的用盡了，
   系統不該假裝排得出來。

#### 兩個 fail-closed

・**積分榜還沒算過就不准裁定**（F15i）。旗標是用 `merge` 寫的，不擋的話會憑空
　生出一份只有 `manualOverride`、沒有 `rows` 的 standing——公開端的積分榜
　會變成一張空表而且不會報錯。
・**不屬於這一組的隊伍不准釘**（F15g）、名次不准重複、原因不准空白。

#### 跟 docs/05 §7.2 的差異

規格畫的是「抽籤 / 主辦裁定」單選 ＋ 拖曳排序。這一版是**兩顆按鈕＋上下移**：
抽完想改一格不必先切換模式，而 320px 的觸控拖曳既難做對也難測
（跟賽程管理同一個決定）。

⚠️ E2E 只守得到「畫面把正確的東西送出去」——替身的 `httpsCallable` 沒辦法
真的執行 Function。「裁定之後積分榜長什麼樣、晉級有沒有解開」由
`test:fn` 的 F15–F15j 用真的模擬器守。替身現在會把呼叫記進
`window.__FAKE_CALLS`，spec 檢查的就是那一份。

### 匯出資料（`#/admin/export`、`js/engine/csv.js`、M6-d）

MVP 只做**匯出抽獎名單**（企劃書第二十六章明示；抽獎工具是 P2）。

#### ⭐ CSV 公式注入

暱稱是玩家自己取的，而且 `players` 的暱稱**連未登入的人都改得動**
（docs/06 §5.1 的取捨）。`=1+1`、`+A1`、`-2`、`@SUM(…)` 這些開頭在
Excel／Google 試算表裡會被**執行**——主辦打開抽獎名單的那一刻就中了。

`sanitizeCell` 在危險開頭前面加一個單引號。`	` 與 `` 也要擋：
它們可以夾帶在公式前面繞過只看 `= + - @` 的檢查（變異 #CSV2）。

#### 另外三件錯了不會有錯誤訊息的事

| | 少了會怎樣 |
|---|---|
| UTF-8 BOM | Excel 在中文 Windows 上用 CP950 解讀，整份亂碼（#CSV3）|
| CRLF 行尾 | 舊版 Excel 把整份檔案讀成一列（#CSV4）|
| 逗號／雙引號逸出 | 那一列後面每一欄往左移一格，看起來像資料錯亂（#CSV5、#CSV6）|

⚠️ **驗 BOM 要驗位元組，不是字元。** `Blob.text()` 依規範會把開頭的 BOM
吃掉（UTF-8 decode 的行為），所以 E2E 只看文字永遠會得到「沒有 BOM」的
錯誤結論。要 `blob.arrayBuffer()` 看前三個位元組是不是 `EF BB BF`。

#### 三件不可協商

1. **張數用 `player.luckyDrawEntries`（Function 寫的權威值）**，不在前端
   重算（#CSV11）。重算要讀 `config/challengeRewards` 與關卡總數，跟管線
   分岔的話「名單上的張數」跟「玩家手機上看到的」會不一樣——那是在抽獎
   現場才會吵起來的事。
2. **0 張的人不進名單**（#CSV8）。要主辦自己在試算表裡篩一次，漏篩就等於
   把沒有資格的人放進抽獎箱。
3. **排序穩定**（張數多的在前，同張數依代號，#CSV9）。主辦重匯一次要拿到
   同一份名單，不然沒辦法比對。

⚠️ 全破人數依 `challengeTotal` 算，**不可以寫死 5**（#CSV10）——這個系統
一個 `challengeId` 都沒有寫死（驗收 C08），在這裡寫死等於「加了第六關
之後全破人數永遠是錯的」。

⚠️ 「聯絡方式」欄目前一定是空的：表單還沒做，而 rules 也不放行訪客寫
（見上面 `contact` 那一段）。欄位留著是為了讓檔案格式從頭到尾一致。

### 挑戰區玩家端（`#/challenge/*`、M6-c）

```
js/lib/qr-render.js            QR 產生（純函式，無相依）
js/modules/challenge/pass.js   Game Pass 身分：localStorage、找回、配號
js/modules/challenge/data.js   Firestore（公開讀 ＋ 建立 Game Pass）
js/modules/challenge/home.js   #/challenge　　　　五關 ＋ 我的進度
js/modules/challenge/join.js   #/challenge/join　建立／找回
js/modules/challenge/me.js     #/challenge/me　　我的 QR、進度、抽獎張數
js/modules/challenge/board.js  #/challenge/board/:challengeId　排行榜
```

⚠️ **路由要把 `/challenge` 註冊在最後**（router 先註冊先贏），
不然 `/challenge/join` 會被 `/challenge` 接走。

⚠️ **公開首頁的挑戰區入口放在最上面**（`js/modules/public/home.js`）。
現場立牌的 QR 掃進來就是首頁，而掃立牌的人多半是路過想玩遊戲的，
不是來看比分的——藏在最底下的話攤位就沒有人。E2E 會量它的 Y 座標。

**這一端完全免登入，路由上沒有守衛。** 掛一個 `requireLogin` 上去就等於把
「免註冊」整個推翻掉。身分是 localStorage 裡的一組 `FEDA-0182`。

#### 配號：隨機 ＋ 伺服器擋碰撞（不是計數器）

`newPlayerId()` 抽一個四位數，**唯一性完全靠 `firestore.rules`**：
`players` 只放行 `create`，撞到已存在的文件時 `setDoc` 會被當成 `update`
而被擋下（fail-closed），`data.createPass()` 接到 `permission-denied`
就換一組再試，最多五次。

不做計數器，是因為計數器要讓**任何人都寫得動**（玩家沒有登入），
那等於開一個誰都能把號碼燒光的入口。

⚠️ 這條規則若失守，症狀是**後來的人把先來的人整份蓋掉**——那個孩子的
完成關卡與抽獎張數瞬間歸零，而且沒有任何錯誤訊息。R17b／RU#34 守著。

⚠️ `tests/e2e/fake-firebase.js` 的 `setDoc` 現在會依 `window.__FAKE_CREATE_ONLY`
模擬「只放行 create」。少了它，撞號重試在 E2E 裡永遠測不到——
替身跟真的語意分岔已經出過三次事（深層 merge、`orderBy` 的 Timestamp、
`null` 排序），這是第四道。

#### 排行榜只存前 50 名——名次要另外算（`ladder`）

`leaderboards/{id}` 的 `rows` 只有前 50 列（`LEADERBOARD_TOP_N`）。
規格 §5.3 要「自己不在前 50 時底部固定顯示自己那一列」，但客戶端
**沒有東西可以算名次**——而那一列正是玩家點進排行榜的理由。

所以 `buildLeaderboard` 一併回傳 `ladder`，管線把它寫進同一份文件：

```js
ladder: { values: [5, 4, 3, 3, 1, …], times: [1760…, …] }   // 全部玩家，只有數字
```

⚠️ **只有數字，沒有 playerId 也沒有暱稱**（變異 #LB2）。代號空間只有一萬組、
掃得完，而知道代號就改得動那個人的暱稱——ladder 上放 ID 等於公布一份
完整的代號名冊。

⚠️ **ladder 不可以跟著 `rows` 一起截斷**（#LB1）。截了的話第 51 名之後
永遠算不出名次，而畫面看起來完全正常（那一格就只是空的）。

⚠️ **排序邏輯只有 `compareEntries` 一份**。`buildLeaderboard` 排名次用它，
`rankInLadder` 算「我第幾名」也用它——兩份的話玩家看到的名次會跟榜上
對不起來，而那種錯不會有任何錯誤訊息。前 50 名的每一列都會被 T46-10
拿去逐一驗證「算出來 == 榜上的」。

⚠️ 玩家端算自己的時間戳一律用引擎的 `attemptMs`：ladder 上的時間就是它
算出來的，換一支（例如 `js/lib/format.js` 的 `toMillis`）就可能差一點而排錯。

#### `contact` 刻意不開放訪客改（2026-09-05 決定）

`players` 的 `allow update` **沒有任何身分條件**——代號空間只有
`FEDA-0000`–`9999` 一萬組、掃得完，等於「任何人都改得動任何人的這幾格」。
所以白名單只留 `nickname` 與 `lastActiveAt`：

| | 被亂改的後果 | 決定 |
|---|---|---|
| `nickname` | 玩笑。重新輸入就好 | **維持開放**，為了它多一支 callable 不划算 |
| `contact` | 兌獎爭議。中獎人聯絡不到，而 `players` 不寫稽核，查不出是誰 | **收掉** |

⚠️ docs/06 §7.2 的「填寫聯絡方式」做出來時要走 Function 寫。
在那之前收在規則裡最便宜——**今天沒有任何一行程式在更新 `contact`**
（唯一提到它的是 `newPlayerDoc` 的初始值，走 `allow create`），
拿掉不會壞任何東西。等表單做好再收，就要同時改規則、加 Function、
改畫面，還要處理已經填過的資料。R17d 與變異 RU#35 守著。

#### Game Pass 的欄位形狀只有一份

`js/engine/challenge.js` 的 `newPlayerDoc()`。攤位代建與玩家自建都從那裡拿——
rules 用 `hasOnly([...])` 逐項列了准許的鍵，兩邊分岔會被整筆擋掉，
而現場只看得到「permission-denied」。

#### `localStorage` 每一次存取都要 try/catch

無痕視窗、把網站資料設成封鎖——`localStorage` 這個**屬性本身**就會丟例外，
不是回傳 null。沒接住的話頁面模組在第一行就死了，玩家只會看到一片空白
（變異 #GP1、E2E 有一條專門守這件事）。

⚠️ 存不進去**不算失敗**：ID 仍然有效，只是下次要自己輸入。所以
「我的挑戰卡」一定會把代號印得很大——那也是 QR 掃不到時的備援。

### QR 產生器（`js/lib/qr-render.js`）

**Byte 模式／版本 1–4／容錯等級 M**，只有這一種組合。不是偷懶，是
「沒有人用的分支最容易寫錯又最不會被發現」（#CH2 就是這樣）。
這一種裝得下 62 個位元組，`FEDA-0182` 只要 9 個。

不裝套件、不從 CDN 載：挑戰區整天在戶外用手機網路，CDN 一慢玩家的 QR
就畫不出來——而那是他整個下午唯一的身分。

#### 一張畫錯的 QR 看起來跟畫對的一模一樣

所以 T50 從四個不同的角度驗，而不是比對一張寫死的矩陣：

| 角度 | 驗什麼 |
|---|---|
| GF(256) 的表 | `EXP[8]=0x1D`、`EXP[255]=1`——本原多項式 0x11D 決定的，可獨立查證 |
| 生成多項式 | α 指數要跟公開的 ISO 表逐項相同（n=10、n=16 兩份）|
| RS 的定義性質 | 碼字在 α⁰..α^(n-1) 上取值全為 0——用**求值**驗**除法** |
| 往返 | 把矩陣當掃碼器讀回來。解碼器用**反向步驟重寫一次**，不重用被測程式 |

⚠️ **往返測試看不到補滿用的位元組。** 解碼器只讀表頭說的那幾個位元組，
後面填什麼都「讀得回原文」——但補 0x00 會排出一大片同色，罰分變高、
掃碼變難。所以那一條要直接驗位元組是 `0xEC / 0x11` 交替（變異 #QR4）。

#### 這一輪抓到的兩個缺陷

1. **保留格式資訊區時把第 6 列／欄一起洗白** —— 那是時序圖樣，而時序圖樣
   正是掃碼器用來對格線的。QR 看起來完全正常，只是掃不到（變異 #QR1）。
2. **`qrMatrix(null)` 編出 4 個位元組的 "null"** —— `TextEncoder().encode(null)`
   會這樣。那是一張**掃得出來、但內容是錯的** QR，攤位只會看到
   「查不到玩家」，沒有人會想到問題出在 QR 上（變異 #QR11）。

⚠️ **這一組證明不了「真的手機掃得到」。** 那是光學問題（對比、尺寸、白邊、
鏡頭），Windows 桌面 Chrome 沒有 `BarcodeDetector`，只能拿真的手機掃一次。
所以畫面上 QR 旁邊一律同時印大字代號，攤位也保留手動輸入。

### 挑戰攤位（`#/booth`、`js/engine/challenge.js`）

```
js/engine/challenge.js             成績型態抽象、best、排行榜、抽獎張數（純函式）
js/modules/booth/actions.js        送出的文件、去重、作廢視窗
js/modules/booth/{data,booth}.js   Firestore 與畫面
functions/pipeline.js              onAttemptSubmitted：best → 券 → 排行榜 → 統計
```

一個 `challengeId` 都沒有寫死（驗收 C08：新增第六關只要在後台加一筆設定）。

#### 五件不可協商

1. **抽獎張數是算出來的，不是累加的。** `luckyDrawEntries += 1` 在觸發器重放時
   會多發一張，而**券發出去就收不回來**（變異 FN#17）。
2. **用 `onDocumentWritten` 不是 `onDocumentCreated`。** 作廢是 update，
   只接 create 的話被作廢的成績會永遠留在榜首（驗收 C07、變異 FN#18）。
   一關全部作廢時還要從完成清單移除、券退回去。
3. **次數滿了不硬擋。** 顯示「已達上限（3/3）」但仍可由工作人員加場送出
   （`source:'staff'`）——規格明文「現場彈性比嚴格限制重要」（#BT8）。
4. **離線時不畫作廢鈕。** 伺服器認可的送出時間還不存在，畫了就是假成功
   （跟賽務端「離線不給撤回」同一條規矩，#BT10）。
5. **`rankingRule: 'lower'` 兩個方向都要測。** 五關目前都是 higher，
   沒有人用的分支最容易寫錯又最不會被發現（驗收 C09、變異 #CH2／#CH14）。

#### 攤位端的三個坑（E2E 抓到，單元測試看不到）

1. **`sync.track()` 回傳 `{id, promise}` 而且永不 reject。** 對它 `.catch()`
   會直接 TypeError；而且方向也錯——失敗要由三態燈呈現，再補一個 toast
   等於開第二條互相競爭的錯誤通道。
2. **時間戳一定要處理字串那一路。** 真的 Firestore 回 Timestamp 物件所以漏掉
   看不出來，但替身 SDK 與任何序列化過的資料都是字串——回 null 的話作廢鈕
   永遠顯示「還在等伺服器確認」。`js/lib/format.js` 的 `toMillis` 是那一份，
   **不要自己再寫一個**（引擎不能 import lib，只好各留一份，變異 #CH21 守著）。
3. **stepper 的起始值要真的是數字，不能留 null。** 畫面顯示 0 但 state 是 null
   的話，「一次都沒中」這個很常見的成績要先按 ＋ 再按 − 才送得出去。

### 賽程管理（`#/admin/schedule`、`js/engine/schedule.js`）

五個步驟（docs/05 §6.1）：**分組 → 產生對戰 → 排定時間 → 檢查衝突 → 發布**。

```
js/engine/schedule.js              演算法（純函式，種子與後台共用，R-ENG-001）
js/modules/admin/schedule-actions.js  Firestore 形狀 ↔ 引擎形狀的轉換與護欄
js/modules/admin/schedule.js       畫面
config/schedule                    開賽時間／結束時間／緩衝／休息下限／各日場地
```

⚠️ **`scripts/seed/build.js` 的 `buildDivisionSchedule` 與 `scheduleDay` 現在是
薄包裝**，實作在引擎裡。種子與正式站排出來的東西不一樣的話，
要到比賽當天才會發現。

#### 六件不可協商

1. **抽籤要留下種子。** 規章第十四條寫的是「統一由大會代為抽籤排定」，
   而抽籤最重要的性質是**事後查得到**。`drawOrder(items, seed)` 的 seed 由
   呼叫端給（R-ENG-004），寫進 `audits` 與 `division.draw.seed`，任何人都能
   重放出同一組分組。引擎自己 `Math.random()` 的話，抽完就再也證明不了
   那一次抽了什麼（變異 #S1）。
2. **手動調整是「兩隊對調」，不是「把一隊搬過去」。** 搬一隊會讓兩組隊數不等，
   而 8 隊範本的交叉表引用了 A、B 組各四個名次——少一個名次的那一組，
   `resolveAdvancement` 會永遠解不開，而且不會報錯。
3. **已經開打就不能重新產生**（`canRegenerate`）。只要有**任何一場**是
   live／halftime／finished／confirmed／walkover 就整組擋下來。
   「只重產沒打的那幾場」聽起來合理，但分組是一整組一起算的：重抽一次籤，
   已經打完的那幾場就變成不同小組之間的比賽，積分榜會靜靜算出一份
   沒有人看得懂的結果（變異 #S13）。

   ⚠️ 這個守衛還撐著第二件事：**Firestore 刪文件不會刪子集合**，
   而 matchId 是決定性的，重產會產出同樣的 id——舊的 `timeline` 事件
   會黏回新場次上。沒開打的場次不會有 timeline，所以現在安全。
   日後若放寬重產條件，`data.deleteMatches()` 要一併處理子集合。
4. **error 擋發布、warn 不擋。** 跟報名審核同一條界線：
   ・`error`＝放行之後會產生**錯誤的結果**（沒排時間、場地重疊、同隊撞場、
   　9 人制排進 5v5 場、名次賽排在來源之前）
   ・`warn`＝休息不足、空等太久。**規章沒有規定休息時間**，把它升成錯誤
   　等於系統替主辦訂了一條規章沒有的規則（變異 #S10）。
5. **衝突檢查一律看全賽事的場次。** 只看自己這一組的話，兩個組別排到
   同一片場地的同一個時段是看不出來的（變異 #S6、#S16）。
6. **整體順延不動已經開打的場次。** 把一場正在進行的比賽往後推三十分鐘，
   賽務台的時鐘就跟排定時間對不起來了（變異 #S11）。

#### 隊數不是 4／6／8 的時候

現成範本只有 4／6／8 隊，而實際報名可能是 5 隊或 7 隊。
`genericFormat(n, { groupCount })` 會產生一份通用範本：

| groupCount | 結構 | 名次怎麼決定 |
|---|---|---|
| 1（預設 n ≤ 5）| 單循環 | 直接由積分榜決定，沒有名次賽 |
| 2（預設 n ≥ 6）| 兩組循環 ＋ 同名次對決 | A組第k名 vs B組第k名 |

⚠️ **通用範本一定要寫回 `config/formats`**（`data.addFormat()`），
不能只改 `division.formatId`——Cloud Functions 解晉級時讀的是
`config/formats`，只改組別設定的話，晉級會在比賽當天才失敗。

奇數隊時兩組差一隊，多出來的那一隊沒有名次賽，名次接在後面。
這件事寫在 `description` 裡讓主辦在按下產生之前就看得到——
不要讓他到現場才發現有一隊少打一場（變異 #S3 守 finalRankingMap 涵蓋 1..N）。

#### `schedulePublished`：發布之前公開端看不到

`divisions/{id}.schedulePublished === false` 時，公開端的首頁、賽程頁、
組別頁與球隊頁都不顯示那一組的場次（`selectors.publishedMatches()`）。

⚠️ **只有明確的 `false` 才隱藏。** 既有的組別文件根本沒有這個欄位，
把「沒有欄位」當成未發布的話，這一版一上線，demo 與正式站上原本看得到的
賽程會全部從公開端消失，而且不會有任何錯誤訊息（變異 #S14）。

⚠️ **這不是安全邊界。** `matches` 的讀取規則是 `allow read: if true`，
未發布的場次仍然讀得到，只是畫面不顯示。這句話寫在管理後台的畫面上——
主辦要知道「未發布」擋不住真的想看的人。

⚠️ 首頁有**兩條**路會畫出場次（`boards/live` 看板與當日場次），
而看板是 Cloud Function 產的、裡面沒有過濾。兩條都要過閘門，
只濾其中一條的話，首頁會在看板還沒產生時正確、產生之後又漏出來。

#### `matchNo` 一旦有人開打就凍結

`assignMatchNos(matches, { frozen })`：`frozen` 的意思是「已經有場次開打」。
那時候重編號碼會讓紙本賽程表與現場廣播的「第 31 場」全部對不上，
所以只給還沒有號碼的場次接續編下去（變異 #S12）。

#### 跟 docs/05 §6.2 的差異

規格畫的是「橫軸時間、縱軸場地」的拖曳時間軸。**這一版做的是清單式編輯**
（主辦 2026-09-04 決定）：現場多半是拿手機改一兩場，觸控拖曳在 320px 上
既難做對也難測。時間軸視圖等真的有人需要再說。

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

### 權限開關（`#/admin/perms`、`js/engine/perms.js`）

`js/config.js` 的 `PERMISSIONS` 是每一個「獨立功能」一條，
`minRole` 是預設歸屬。總管可以在 `rolePermissions/{role}` 逐條覆寫
（**頂層集合，不在 `config` 底下**）：

```js
{ role: 'scorer', perms: { 'match.finish': false } }   // 關掉記錄員的送出完賽
{ role: 'checkin', perms: { 'member.read': false } }        // 關掉檢錄員看個資
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

> ⚠️ `rolePermissions` 的初始值由 `scripts/seed` 從 `PERMISSIONS`
> **推導**，不要手寫第二份。手寫的那一份 2026-09-03 已經跟程式碼分岔過
> （裁判有覆核權、沒有 checkin 這個角色），而分岔不會有任何錯誤訊息。

#### 介面上調得動的只有「來源那一階」

`effectivePerms()` 是**開優先於關的聯集**，而種子把每個角色的預設權限
都寫成 `true`。所以在「記錄員」那一列關掉挑戰成績登錄，會被「挑戰攤位」
那一列的 `true` 蓋過去——**開關完全沒有作用**（T37-A 有實測）。

因此 `#/admin/perms` 讓每一條權限只在它的 `minRole` 那一階可調，
其他列寫明「這一條屬於挑戰攤位，請到那裡調整」。同理，總管那三條
（指派身分／權限開關／報名開關）連開關都不畫：`effectivePerms()` 對
super_admin 直接回傳全部權限，按下去不會有任何效果。

**這一頁只做得到收窄，做不到放寬。** 破壞性的權限同時寫在
`firestore.rules` 裡（R-PERM-002），把記分下放給裁判在畫面上會成功、
在資料庫會被擋——那就是「假成功」。上面第 2 條規矩底下原本舉的
`referee: { 'match.score.write': true }` 例子是**錯的**，已換掉。

關掉之後那一列要寫「管理員、總管仍然可以」——少了這句，主辦會以為
整個功能被關掉了，然後在現場找不到人送出完賽。

寫入一律 `setDoc(..., { merge: true })`：整份覆蓋會把同一個角色其他
權限的設定一起抹掉，而抹掉之後畫面看起來完全正常（讀不到值就走預設）。
真的 Firestore 對 merge 是**深層**合併，`tests/e2e/fake-firebase.js` 起初
寫成淺層——R109 用真的模擬器盯著這一條，替身再漂移一次就有人會發現。

### ⚠️ 「有 `can()` 的判斷」與「判斷真的有效果」是兩件事

2026-09-04 在真站上實測抓到兩個缺陷，兩個都通過了當時全部 561 條測試：

1. 總管把「送出完賽」關掉之後，賽務台的按鈕**照樣在**——那一頁從來
   沒有問過 `can('match.finish')`。當時 19 條權限碼只有 5 條有人讀。
2. `sheet.js` 把出場名單擋在 `canScore()`（＝`match.score.write`，記錄員），
   但那個功能的權限碼是 `matchsheet.write`（裁判）。**結果是裁判編不了
   出場名單**——而那正是裁判在這個系統裡唯一的職能。
   實測：裁判的名單頁 4 顆按鈕，記錄員 25 顆。

所以現在有三層守著，缺一不可：

| 層 | 守什麼 | 在哪裡 |
|---|---|---|
| 靜態 | 每一條權限碼都要有畫面在讀 | `scripts/perm-usage.cjs` ＋ T42-8 |
| 行為 | 讀了之後畫面真的會變 | `tests/e2e/perm-effect.spec.js` |
| 鑑別 | 上面兩層真的抓得到 | 變異 #C10–#C13、#E6–#E8 |

**`pending: true` 的意思被釘死成「真的沒有任何畫面在讀它」**（目前 9 條，
都是還沒做的功能）。權限開關那一頁看到 pending 就不畫開關，只寫
「功能尚未上線」——否則那是一個按了不會有效果的切換。
功能做好、接上 `can()` 的那一刻 T42-8 會紅，提醒你把旗標拿掉。

> ⚠️ E2E 斷言「某個東西不存在」之前，一定要先等頁面**真的畫出來**。
> `toHaveCount(0)` 在還沒渲染的空白頁上會立刻成立——變異 #E7 第一次
> 就是這樣逃掉的（把權限判斷改成永遠放行，11 條全綠）。
> `perm-effect.spec.js` 的 `ready()` 就是在做這件事。

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

## 規章補齊（2026-09-05：申訴、切結書、退費、直播設定、中獎聯絡方式）

```
js/engine/appeal.js      申訴：30 分鐘窗口、登記文件、裁決（保證金去向由規章決定）
js/engine/refund.js      退費：15 天內不退、不可抗力全退、報名費依組別、金額不同要寫原因
js/engine/formats.js     APPEAL_RULES / REFUND_RULES（規章第二十、二十七條；parity 測試 T37-7 盯著）
js/lib/youtube.js        YouTube 網址 → 影片／頻道 ID（貼整串網址也行）
js/lib/format.js         APPEAL_STATUS_LABEL（公開端不 import 引擎，狀態文字放 lib）
```

| 功能 | 在哪裡 | 資料 | 規則 |
|---|---|---|---|
| 申訴登記與裁決 | `#/admin/match/:id` 的「申訴」卡 | `events/{e}/appeals/{matchId-teamId}`，場次上只掛 `appeal:{status,teamId}` | 只有 admin 讀寫、不可刪（R135） |
| 眼鏡切結書 | 報名表單勾「配戴眼鏡」→ 同意切結書；教練記「切結書已收」；檢錄台標記；審核頁提醒 | `members.glasses` / `members.glassesWaiver` | 白名單多這兩欄（R138） |
| 切結書全文 | `#/register/waiver`（免登入、可列印） | — | — |
| 取消報名／退費 | 隊長在球隊頁「申請取消」→ 主辦在報名審核頁「取消報名／退費」 | `teams.cancelRequest` → `status:'withdrawn'`＋`teams.refund` | 隊長只能寫 cancelRequest，withdrawn 只有 admin（R136） |
| 直播設定 | `#/admin/stream`（場地整日）＋場次改判頁的「這一場的直播」（單場覆蓋） | `venues.stream` / `matches.stream` | admin |
| 中獎聯絡方式 | 玩家在 `#/challenge/me` 填；攤位替代建的卡登記 | `events/{e}/playerContacts/{playerId}`（只有 admin 讀）；`players.contactKeyHash` | 寫入只走 `setPlayerContact` Function（R137） |

### 五件容易做錯的

1. **申訴的 30 分鐘從「送出完賽」算**（`scoreSubmittedAt`），不是排定的開賽時間。逾時的申訴規章不受理，
   主辦要破例必須在畫面上確認，而且文件記 `late: true`（變異 #AP1、#E16）。
2. **保證金的去向由規章決定，畫面上沒有選項**：成立退還、不成立沒收（#AP2）。
3. **退費「15 天內」從 10/9 往回算，9/24 00:00 起不退**；規章沒寫 15 天以前退幾成，系統算「建議全額」，
   主辦改金額一定要寫原因（#RF1–#RF3）。報名費依組別設定判斷（`feeOf`），不寫死代碼。
4. **電話不能放在 players 文件上**（任何人都讀得到、代號掃得完）。憑證本體只在建卡的那支手機，
   Firestore 只存 sha256；Function 比對過才把電話寫進只有管理員讀得到的 `playerContacts`。
   找回的卡沒有憑證——畫面直接說「到攤位登記」，不畫一個會失敗的表單（#E17、FN#26）。
5. **YouTube 貼整串網址要抽成 ID**（#YT1）。存整串網址進去 embed 會壞而且不報錯。

### 教學卡與 Lighthouse

`docs/cards/{scorer,checkin,booth}.html` → `node scripts/make-cards.mjs` 產生 PDF（用專案的 Playwright Chromium）。
`docs/lighthouse/` 放量測報告（`mobile.report.*` 是修改前的正式站、`demo-mobile.report.*` 是修改後的 demo）。
2026-09-05 首次量測手機版效能 **66**：LCP 7.1 秒，是等 Firebase SDK 載完才畫的空狀態文字。
兩步修到 **96**（FCP／LCP 1.7 秒）：
1. `index.html` 加 preconnect（gstatic、firestore）、十個核心模組的 modulepreload、載入中的靜態標題（`.boot-hero`）→ 80
2. 七個模組 CSS 改成不擋首次繪製（`media="print" onload`＋noscript 退路；tokens／base／components 仍阻塞，頁首與 toast 在裡面）→ 96
規格要求手機版 ≥ 85。剩下的分數在 Firebase SDK 的重量（約 400 KB），不打包就降不下去。

## 我報名的球員（`#/my`，M4-d）

```
js/modules/account/my-players.js   純邏輯：路徑 → teamId、配隊、排序、標題人數
js/modules/account/my.js           loadPlayers()：collectionGroup('members') ＋ 逐隊讀隊名
firestore.rules                    根層級 match /{path=**}/members/{memberId}（只開 read）
```

一個 LINE 帳號可以對應多個球員，分在不同隊（docs/10 §1.3），所以要**跨球隊**查。
四件容易做錯的：

1. **巢狀路徑的規則吃不到 collectionGroup 查詢**，要在根層級另開一條（跟 timeline 一樣）。
   少了它，畫面永遠是 PERMISSION_DENIED（變異 RU#39）。
2. **`where('guardianUid', '==', 自己)` 不是過濾，是門票。** rules 對查詢是看條件能不能
   證明每一筆都通過，沒帶的話整個查詢被擋（R134c）。替身 SDK 沒有 rules，所以 E2E 直接
   盯「別人家的小孩不能出現」（變異 #E15）。這份文件上有生日與身分證後四碼。
3. **規則裡不用 `.get('guardianUid', '')` 給預設值。** 教練填的小球員沒有 guardianUid，
   本來就不該從這條路讀到；欄位缺漏時求值失敗＝拒絕，正是要的方向。
   賽務要看名單走球隊底下那條（R134e）。
4. **查不到球隊文件的那一筆仍然要列**，隊名退回 id（變異 #MP4）。整列消失會讓家長
   以為報名不見了。標題的人數只算「等同意」與「在名單上」的（#MP3）。

`tests/e2e/fake-firebase.js` 的 `collectionGroup()` 是這一輪加的：任何深度底下、
倒數第二段叫那個名字的文件都算——真的 Firestore 就是這樣，不看在哪一棵樹底下。

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

### ⚠️ 頁面模組的順序陷阱（已經踩過七次）

頁面模組的共同結構是「先啟動監聽 → 再宣告 helper → render()」。
但 **`onSnapshot` 的第一筆快照可能同步送達**（替身 SDK 會，本機快取命中時也很早），
於是 `render()` 在 helper 還沒宣告時就被呼叫：

```
ReferenceError: Cannot access 'isCaptain' before initialization
```

整頁空白，而且**單元測試看不到**（那是 DOM 層的執行順序）。

> **規矩：`render()` 會用到的東西一律寫成具名函式**（會被提升），
> 不要用 `const foo = () => …`。已經在 `home.js`（M5）、`schedule.js`、
> `division.js`、`match.js`、`register/home.js`、`register/manage.js`、
> `admin/standings.js` 上各中一次。
> E2E 抓得到——每一頁都要有一條「頁面畫得出來」的案例。
>
> ⚠️ **一行小小的 `const keyOf = (s, g) => …` 也算。** 2026-09-05 在
> `admin/standings.js` 上又中一次：那是一支兩行的 key 產生器，看起來完全
> 不像會出事的東西，但它被 `tieCard()` 用到，而 `tieCard()` 在第一筆快照
> 同步送達時就跑了。症狀一樣是整頁空白 ＋ `Cannot access 'keyOf' before
> initialization`——單元測試 30 條全綠，E2E 第一條就紅。

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
>
> 2026-09-04 又中了兩次，這次錯的是**替身的行為**不是資料：
> `setDoc(merge:true)` 寫成淺層合併（真 Firestore 是深層），以及
> `orderBy` 對 Timestamp 完全沒有作用、`null` 排最大（真 Firestore 最小）。
> 後者一修好，檢錄台就露出「沒有背號的隊職員排在名單最前面」——
> 檢錄員拿著證件要找小孩，第一眼看到的卻是三位大人。
> 變異 #E5／#E10／#E11 現在盯著替身的這三個語意。
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
├── awards.js        射手榜 / 門將榜 / 行為分排行
└── schedule.js      抽籤 / 分組 / 通用範本 / 對戰表 / 排時段場地 / 衝突檢查
```

相依方向是單向的：`tally ← ranking ← standing ← advancement`。
`timeline.js` 不相依任何人（純粹是事件流 → 比分），所以誰都可以用它。
`ranking` 不可 import `standing`（會形成循環），需要積分計算時用 `tally`。
`schedule.js` 只相依 `berger` 與 `formats`（都是純資料／純函式）。

全部是純函式：不碰 Firestore、不呼叫 `Date.now()`、不用隨機。
Function 負責讀寫與填 `serverTimestamp`，引擎只負責算。

> ⚠️ `schedule.js` 的抽籤是**唯一一處**用到亂數的地方，而它**不自己產生亂數**：
> `drawOrder(items, seed)` 的 seed 由呼叫端給並記錄下來（R-ENG-004）。
> 規章第十四條要的是大會抽籤，而抽籤的價值在於事後重放得出來。

### 測試

```bash
npm run test:unit                  # 756 個案例（引擎 T01–T45 ＋ 賽務端核心 ＋ 主題／圖示／撤回）
npm run test:mutation              # 172 條變異，證明測試有鑑別力
npm run test:rules                 # 174 個案例，自動起 Emulator
npm run test:mutation:rules        # 29 條權限規則變異
npm run test:fn                    # 40 個 Function 整合測試（F01–F14 結果管線、FR01–FR13 報名與登入）
npm run test:mutation:fn           # 16 條 Function 變異
npm run test:e2e                   # 726 個 Playwright 案例（× mobile / desktop / 320px）
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
