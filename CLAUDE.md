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

## 目前進度

- [x] M0 規格定案（`docs/00`–`08`）＋互動原型
- [x] 雲端環境開通（GitHub / Firebase ×2 / Cloudflare Pages ×2 / 自訂網域 / CI）
- [x] M1-a 賽制設定檔 `js/engine/formats.js`（4 個 Format、3 組 RankingRule、6 組別）
- [x] M1-b 種子資料 `scripts/seed.js`：38 隊、75 場、1176 筆文件，含排程自檢
- [x] M1-c rules 測試 `tests/firestore-rules/`：R01–R23 共 27 個案例（**尚未實跑**，見下）
- [ ] M1-d 部署 rules 與索引到 demo，跑 `npm run test:rules` 確認全綠
- [ ] M2 賽制引擎：`js/engine/{standing,ranking,advancement}.js`
- [ ] M3 賽務端　[ ] M4 公開端　[ ] M5 檢錄＋Challenge　[ ] M6 彩排　[ ] M7 上線

### ⚠️ 待確認：rules 測試尚未實際執行

`tests/firestore-rules/` 的 27 個案例是照 `docs/07 §2.4` 寫的，但撰寫環境無法下載
Firestore Emulator，所以**還沒有跑過一次綠燈**。第一件該做的事是：

```bash
npm install
npm run test:rules      # 會自動下載並啟動 Emulator
```

有紅燈就修 `firestore.rules`，不要改測試去遷就規則。
