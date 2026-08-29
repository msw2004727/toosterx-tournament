# toosterx-tournament

ToosterX 賽事營運系統｜**Tournament**（競賽）＋ **Challenge**（現場互動）
首個實戰場域：**FEDA CUP 2026｜飛達盃**（2026/10/9–11・太原足球場・六組別 38 隊）

> 這個 repo 不是「飛達盃網站」，而是一套**以設定檔驅動的賽事系統**，飛達盃只是它的第一個 Event。
> 程式碼中不得出現 `if (divisionId === 'women')` 這類寫死的判斷。

---

## 環境

一份程式碼、兩套雲端資源、兩個分支。

| | 正式版 | Demo 版 |
|---|---|---|
| Git 分支 | `main` | `demo` |
| Firebase 專案 | `feda-cup-2026` | `feda-cup-demo` |
| Firestore 位置 | asia-east1（彰化） | asia-east1（彰化） |
| Cloudflare Pages | `feda-cup` | `feda-cup-demo` |
| 網域 | cup.toosterx.com | cup-demo.toosterx.com |
| 資料 | 真實賽事 | 假資料，可一鍵重置 |
| 登入 | LINE LIFF 真角色 | 免登入角色切換器 |

環境判斷只有一個地方：**`js/firebase-config.js`**，依 `location.hostname` 決定。
新增網域時只改 `PROD_HOSTS`，不要在其他檔案判斷環境。

### Demo 專屬功能

Demo 版有三樣正式版**不會載入**的東西（不是用 flag 關掉，是整段模組不 import）：

1. 頂部常駐 `DEMO` 橫幅，不可關閉
2. 免 LINE 登入的角色切換器
3. 一鍵重置種子資料

---

## 技術棧

| 面向 | 選型 |
|---|---|
| 前端 | Vanilla ES6 + HTML + CSS，無打包工具 |
| 資料庫 | Firebase Firestore（讀取前端直連、即時監聽） |
| 寫入守衛 | `firestore.rules` |
| 後端運算 | Cloud Functions v2（Node.js 22, asia-east1） |
| 認證 | 公開頁免登入；工作人員 LINE LIFF → Firebase Custom Token |
| 靜態託管 | Cloudflare Pages |
| 離線 | Service Worker（HTML 不 cache-first） |
| 測試 | Jest（單元／rules）＋ Playwright（E2E） |

---

## 目錄

```
index.html  app.js          主入口與核心啟動
js/config.js                版本與常數
js/firebase-config.js       ⭐ 環境切換（唯一判斷點）
js/core/                    路由、監聽管理、離線同步、時鐘、UI 基礎
js/engine/                  ⭐ 賽制引擎（與 functions/ 共用同一份純函式）
js/lib/                     QR 掃描與產生、格式化
js/modules/                 功能模組（home / schedule / match / staff / booth / admin …）
pages/                      動態 HTML fragment
css/                        tokens / base / components
functions/                  Cloud Functions v2
scripts/                    bump-version、種子資料
tests/                      unit / firestore-rules / e2e
docs/                       規格書（00–08）
```

### `js/engine/` 為什麼要跟 `functions/` 共用

積分計算與同分排序**只能有一份實作**。`js/engine/*.js` 寫成無依賴的純函式，
`functions/` 以相對路徑 `require('../js/engine/ranking.js')` 引用，單元測試也只需要測一次。

---

## 開發

```bash
npm install
npm run emu            # Firestore Emulator
npm run serve          # 靜態伺服器（http://localhost:5173）
npm run seed:demo      # 對 demo 專案灌 38 隊假資料
```

## 測試

```bash
npm run test:unit      # Jest 單元測試（賽制引擎、格式化、QR 簽章）
npm run test:rules     # firestore.rules（Emulator）
npm run test:e2e       # Playwright
```

CI 紅燈必須先修復；targeted test 不能替代完整 suite。

## 部署

| 動作 | 結果 |
|---|---|
| push `demo` | Cloudflare Pages 自動部署到 cup-demo.toosterx.com |
| push `main` | 自動部署到 cup.toosterx.com |
| `npm run deploy:rules:demo` / `:prod` | 部署 firestore.rules 與索引 |
| `npm run deploy:fn:demo` / `:prod` | 部署 Cloud Functions |

Functions 與 Rules 走**獨立 lane**，不隨靜態站自動部署。

## 版本

格式 `0.YYYYMMDD{suffix}`（台北當日第一次無 suffix，同日遞增 a…z）。
只用 `node scripts/bump-version.js` 遞增，會同步四處：
`js/config.js#CACHE_VERSION`、`sw.js#CACHE_NAME`、`index.html` inline 版號、asset query 版號。

主站 JS/HTML/CSS 變更必須 bump；純文件／註解不 bump。

---

## 規格書

完整規格在 `docs/`：

| 檔案 | 內容 |
|---|---|
| `00-總覽與里程碑.md` | 專案定位、範圍、技術決策、里程碑、驗收 |
| `01-架構與資料模型.md` | 系統架構、集合結構、索引、命名慣例 |
| `01b-Firestore資料欄位定義.md` | 每個集合的完整欄位 |
| `02-賽制引擎與排名規則.md` | ⭐ 系統心臟：Format、積分、同分排序、晉級 |
| `03-功能規格-公開端.md` | 首頁、賽程、記分板、LIVE、直播 |
| `04-功能規格-賽務裁判端.md` | LIVE 操作台、事件記錄、QR 檢錄 |
| `05-功能規格-管理後台與報名.md` | Admin 後台、人工修正、報名 |
| `06-Challenge挑戰系統.md` | 五關遊戲、Game Pass、排行榜、抽獎 |
| `07-權限安全與CloudFunctions.md` | 角色權限、rules、Functions 契約 |
| `08-UI規範與前端架構.md` | 設計系統、元件、測試 |

---

## 授權

Source-available, all rights reserved.
