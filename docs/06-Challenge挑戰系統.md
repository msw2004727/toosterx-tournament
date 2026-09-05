# 06｜Challenge 足球遊戲挑戰系統

> 對應企劃書第十四～二十六章。
> 設計原則：**Challenge 系統不管理遊戲本身，只管理「誰、玩了哪一關、成績多少、排第幾、拿幾張抽獎券」。**
> 任何一關的規則都不得寫死在程式碼裡。

---

## 1. 系統定位

```
玩家辨識  →  參加紀錄  →  成績  →  排名  →  抽獎資格
```

五個現場攤位共用同一套引擎，差別只在 `challenges/{id}` 的設定。未來新增第六關只需在後台新增一筆設定，不需要改程式。

---

## 2. 成績型態抽象（核心設計）

| Score Type | 說明 | 單位範例 | 排序 | 本次使用 |
|---|---|---|---|---|
| `points` | 得分加總 | 分 | higher | Game 01、05 |
| `count` | 次數 | 次 | higher | Game 03 |
| `height` | 高度 | cm | higher | Game 02 |
| `speed` | 速度 | km/h | higher | Game 04 |
| `time` | 時間 | 秒 | **lower** | （未來：盤球障礙賽） |
| `distance` | 距離 | m | higher | （未來） |
| `boolean` | 成功／失敗 | — | higher | （未來） |

```js
{
  scoreType: 'speed',
  unit: 'km/h',
  rankingRule: 'higher',      // higher | lower
  decimals: 0,                // 顯示小數位
  minValue: 20, maxValue: 150 // 輸入防呆
}
```

`displayValue` 由 `rawValue + unit + decimals` 組出，排行榜與個人頁一律用同一個格式化函式。

---

## 3. 五個關卡設定

### 3.1 Game 01｜九宮格射門挑戰

```js
{
  challengeId: 'g01-nine-grid', order: 1, icon: '🎯',
  name: '九宮格射門挑戰', shortName: '九宮格',
  description: '球門設置九宮格目標，於指定距離射門，不同位置不同分數。',
  rulesText: '每人 5 球。一般區 1 分、中難度 2 分、高難度角落 3 分。加總為總分。',
  scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 15,
  inputMode: 'shots',                 // 見 §4.2
  shotCount: 5, shotOptions: [0,1,2,3],
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  boothLocation: '攤位 1'
}
```

### 3.2 Game 02｜C 羅高空頭球挑戰

```js
{
  challengeId: 'g02-header-king', order: 2, icon: '🦘',
  name: 'C羅高空頭球挑戰', shortName: 'C羅頭球',
  rulesText: '依序挑戰各高度，完成後可挑戰下一級。紀錄成功完成的最高高度。',
  scoreType: 'height', unit: 'cm', rankingRule: 'higher', decimals: 0,
  minValue: 150, maxValue: 260,
  inputMode: 'ladder',                // 階梯式
  ladderSteps: [180,190,200,205,210,215,220],
  attemptPolicy: { maxAttemptsPerPlayer: 2, allowRepeat: true, rankBy: 'best' },
  boothLocation: '攤位 2'
}
```

### 3.3 Game 03｜Ronaldinho 橫樑挑戰

```js
{
  challengeId: 'g03-crossbar', order: 3, icon: '🎪',
  name: 'Ronaldinho 橫樑挑戰', shortName: '橫樑',
  rulesText: '固定 5 球，紀錄擊中橫樑次數。',
  scoreType: 'count', unit: '次', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 5,
  inputMode: 'stepper', stepperMax: 5,
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  boothLocation: '攤位 3'
}
```

### 3.4 Game 04｜足球球速王

```js
{
  challengeId: 'g04-speed-king', order: 4, icon: '⚡',
  name: '足球球速王', shortName: '球速王',
  rulesText: '使用球速雷達測量射門球速，取最高一次成績。',
  scoreType: 'speed', unit: 'km/h', rankingRule: 'higher', decimals: 0,
  minValue: 20, maxValue: 150,
  inputMode: 'numpad',
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  boothLocation: '攤位 4'
}
```

### 3.5 Game 05｜停球王挑戰

```js
{
  challengeId: 'g05-first-touch', order: 5, icon: '🎯',
  name: '停球王挑戰', shortName: '停球王',
  rulesText: '5 次停球。完美區 3 分、控制區 2 分、外圍 1 分、失敗 0 分。',
  scoreType: 'points', unit: '分', rankingRule: 'higher', decimals: 0,
  minValue: 0, maxValue: 15,
  inputMode: 'shots', shotCount: 5, shotOptions: [0,1,2,3],
  attemptPolicy: { maxAttemptsPerPlayer: 3, allowRepeat: true, rankBy: 'best' },
  boothLocation: '攤位 5'
}
```

---

## 4. 攤位工作流程

### 4.1 攤位主畫面 `#/booth`

工作人員登入後，依 `staff.assignment.challengeIds` **直接鎖定在自己的關卡**，整天不需再選。

```
┌────────────────────────────────┐
│ 🎪 Ronaldinho 橫樑挑戰          │
│ 攤位 3 · 王攤位     🟢 已連線    │
├────────────────────────────────┤
│                                │
│    ┌──────────────────┐        │
│    │   掃描玩家 QR      │        │
│    │                  │        │
│    └──────────────────┘        │
│                                │
│      [ 手動輸入 ID ]            │
├────────────────────────────────┤
│  今日 87 人次 · 62 位玩家        │
│  [ 排行榜 ]  [ 最近紀錄 ]        │
└────────────────────────────────┘
```

### 4.2 掃碼後的成績輸入（依 inputMode 切換）

**掃到玩家後統一顯示**：

```
┌────────────────────────────────┐
│  FEDA-0182   阿哲               │
│  本關已挑戰 1 次 · 最佳 3 次     │
├────────────────────────────────┤
│  （成績輸入區，依 inputMode）      │
├────────────────────────────────┤
│  [ 取消 ]        [ 送出成績 ]    │
└────────────────────────────────┘
```

| inputMode | 介面 | 適用 |
|---|---|---|
| `stepper` | 大型 `−` `數字` `+` 按鈕 | 橫樑（0–5 次） |
| `shots` | 5 排按鈕列，每排 `0 1 2 3`，即時加總顯示 | 九宮格、停球王 |
| `ladder` | 高度階梯清單，點選達成的最高一級 | 頭球 |
| `numpad` | 大數字鍵盤 | 球速 |

**shots 介面示意**

```
第1球  [0] [1] [2] [3]      ← 選中的按鈕填色
第2球  [0] [1] [2] [3]
第3球  [0] [1] [2] [3]
第4球  [0] [1] [2] [3]
第5球  [0] [1] [2] [3]
        總分  9 分
```

每球的細項存進 `attempt.detail = [3,0,2,1,3]`，方便事後分析「哪一格最難」。

### 4.3 送出後回饋

```
┌────────────────────────────────┐
│         ✅ 成績已送出            │
│                                │
│        阿哲   3 / 5 次           │
│        🎉 個人最佳！              │
│        目前排名 第 2 名           │
│        抽獎資格 +1（共 4 張）      │
│                                │
│  [ 下一位 ]（3 秒後自動返回）      │
└────────────────────────────────┘
```

- 若非個人最佳，顯示「本次 2 次｜最佳 3 次」
- 若首次完成該關，顯示「+1 抽獎資格」
- 震動回饋、音效（可關）

---

## 5. 玩家流程

### 5.1 建立 Game Pass（免註冊）

```
掃活動 QR（現場立牌／攤位／看板）
      ↓
#/challenge/join?t=FEDA26
      ↓
┌────────────────────────────────┐
│  🎮 FEDA CUP 挑戰區              │
│  取一個暱稱就可以開始             │
│                                │
│  暱稱  [ 阿哲              ]    │
│  年齡層 ○兒童 ○青少年 ●成人      │
│                                │
│  [ 開始挑戰 ]                   │
│  已經有 ID？[ 用 ID 找回 ]       │
└────────────────────────────────┘
      ↓
建立 players/{FEDA-XXXX}，寫入 localStorage
      ↓
顯示玩家 QR
```

**不要求**：手機、Email、註冊、LINE 登入。中獎聯絡方式在「查詢抽獎資格」時才選填。

**ID 找回**：輸入 `FEDA-0182` 即可在新裝置找回（本次為現場活動，安全性要求低；若擔心被冒用，可加「暱稱 + ID」雙欄比對）。

#### 實作與規格的四處差異（2026-09-05，M6-c）

1. **不做「ID 找回」的雙欄比對。** §5.1 提到「若擔心被冒用，可加暱稱＋ID」——
   沒加。現場活動、安全性要求低，多一道驗證只會讓換手機的家長卡在那裡。
2. **年齡層問了但不擋。** 總榜不分齡（主辦決定），所以它現在沒有消費者；
   但獎品日後想分兒童組時**補問不回來**，所以還是問，不填也送得出去。
3. **配號是隨機四位數 ＋ 伺服器擋碰撞後重試**，不是計數器。
   計數器要讓任何人都寫得動（玩家沒有登入），等於開一個誰都能把號碼
   燒光的入口。唯一性靠 `firestore.rules` 的「只放行 create」。
4. **QR 編的是代號本身**（`FEDA-0182`），不是網址。攤位是唯一的消費者，
   短內容 = 小張 QR = 好掃。旁邊一律同時印大字代號當備援。

### 5.2 我的頁面 `#/challenge/me`

```
┌────────────────────────────────┐
│      ┌─────────────┐           │
│      │             │           │
│      │  玩家 QR     │           │  ← 亮度自動調到最亮
│      │             │           │
│      └─────────────┘           │
│        FEDA-0182  阿哲          │
├────────────────────────────────┤
│  我的進度  4 / 5                │
│  ✅ 九宮格        9 分  第 5 名  │
│  ✅ C羅頭球     205 cm  第 2 名  │
│  ✅ 橫樑          3 次  第 2 名  │
│  ✅ 球速王      82 km/h 第 8 名  │
│  ○ 停球王        未挑戰          │
├────────────────────────────────┤
│  🎟 抽獎資格  4 張               │
├────────────────────────────────┤
│  [ 各關排行榜 ]  [ 賽事賽程 ]     │
└────────────────────────────────┘
```

### 5.3 排行榜 `#/challenge/board/:challengeId`

```
🎪 Ronaldinho 橫樑王
────────────────────
🥇 1  Kevin      5 次
🥈 2  阿哲       4 次
🥉 3  小明       3 次
   4  Amy        3 次
   …
────────────────────
我的最佳：4 次    我的排名：第 2 名
```

- 前 50 名顯示；自己不在前 50 時，底部固定顯示自己那一列
- 同成績依「較早達成」排前（`attemptAt` 升冪）
- 可切換分齡榜（兒童／青少年／成人）— 由 `player.ageBand` 分流
- 每 15 秒自動刷新（監聽 `leaderboards/{id}`）

---

#### 實作補充：前 50 名之外的名次（2026-09-05）

`leaderboards/{id}.rows` 只有前 50 列，所以第 51 名之後的玩家在客戶端
算不出自己的名次。管線因此在同一份文件多寫一個 `ladder`：

```js
ladder: { values: [...], times: [...] }   // 全部玩家，只有數字
```

**只有數字，沒有 playerId 也沒有暱稱**——代號空間只有一萬組、掃得完，
放 ID 等於公布一份完整的代號名冊。玩家端用自己的最佳成績去比對
（`rankInLadder`），用的是跟榜單同一支比較函式，算出來的名次一致。

**分齡榜不做**（主辦 2026-09-05 決定只做總榜）。`leaderboards/{id}` 也
只有一份總榜，畫一個切不動的分頁比沒有更糟。

## 6. Attempt 與 Best Score

### 6.1 資料流

```
攤位送出成績
   ↓
attempts/{auto}  ← 每次挑戰都留一筆（企劃書第二十四章要求）
   ↓ Function: onAttemptCreated
① 查該玩家該關的所有 attempt，依 rankingRule 決定 best
② 更新舊 best 的 isBest = false，新 best 的 isBest = true
③ 若首次完成該關 → player.completedChallengeIds += id
                  → player.luckyDrawEntries += 1
④ 重算 leaderboards/{challengeId}（debounce 3 秒）
⑤ challenges/{id}.stats 累加
```

### 6.2 次數限制

```js
attemptPolicy: {
  maxAttemptsPerPlayer: 3,   // null = 不限
  allowRepeat: true,
  rankBy: 'best'             // best | first | last | sum
}
```

- 超過次數時，攤位端顯示「此玩家已達本關次數上限（3/3）」，但**允許工作人員以「加場」覆寫**（`source:'staff'`，記錄稽核）——現場彈性比嚴格限制重要
- `source` 欄位為園遊券預留：`free`（活動贈送）／`ticket`（購買園遊券）／`staff`（工作人員加場）／`other`

### 6.3 修正與作廢

攤位端「最近紀錄」可對**最近 10 分鐘內、自己送出的**紀錄執行：

- **作廢**（`voided = true` + 原因）：掃錯人、成績輸錯
- 作廢後自動重算該玩家 best 與排行榜

超過 10 分鐘或他人送出的，需 Admin 處理。

---

## 7. 抽獎資格

### 7.1 規則（可設定）

```js
// config/challengeRewards
{
  rule: 'perChallengeCompleted',   // 完成一關 = 1 張
  entriesPerCompletion: 1,
  bonusAllComplete: 2,             // 五關全破額外 +2（可設 0）
  maxEntriesPerPlayer: 10
}
```

### 7.2 玩家查詢

```
🎟 我的抽獎資格

完成關卡  4 / 5     → 4 張
五關全破獎勵         → 0 張
────────────────────
合計                 4 張

抽獎時間：10/11（六）17:00 主舞台
中獎通知方式：[ 填寫聯絡方式 ]   ← 選填，僅中獎聯絡用
```

### 7.3 Admin 抽獎作業

- 匯出抽獎名單 CSV：`playerId, nickname, entries, contact, completedCount`
- 系統提供簡易抽獎工具（P2）：輸入獎項與名額 → 依張數加權隨機 → 顯示中獎名單 → 記錄亂數種子供公證
- 本次 MVP 只需**匯出名單**即可（企劃書第二十六章明示）

---

## 8. Challenge 首頁 `#/challenge`

```
┌────────────────────────────────┐
│  🎮 FEDA CUP 挑戰區              │
│  完成一關就有一次抽獎機會          │
├────────────────────────────────┤
│  我的進度 2/5      [ 我的 QR ]   │
├────────────────────────────────┤
│  🎯 九宮格射門     攤位1  ✅ 9分  │
│  🦘 C羅高空頭球    攤位2  ✅205cm│
│  🎪 Ronaldinho橫樑 攤位3  ○      │
│  ⚡ 足球球速王     攤位4  ○      │
│  🎯 停球王         攤位5  ○      │
├────────────────────────────────┤
│  🏆 各關排行榜                   │
│  🎟 我的抽獎資格                 │
│  🗺 攤位位置圖                   │
└────────────────────────────────┘
```

點任一關卡進入關卡頁：規則說明、排行榜、我的成績、攤位位置。

---

## 9. 與 Tournament 的連結

| 連結點 | 說明 |
|---|---|
| 活動首頁 | Tournament 與 Challenge 並列兩個入口（企劃書第二十七章） |
| 球員身分 | 若玩家是參賽球員，可輸入球員證 QR 綁定 `player.linkedTeamId`，排行榜顯示所屬球隊 |
| 統一活動 QR | 現場立牌一個 QR 進到 `#/`，首頁再分流 |
| 統一工作人員系統 | 攤位人員與賽務人員同一套 `staff` 名冊與登入 |

---

## 10. 現場異常處理

| 情況 | 處理 |
|---|---|
| 掃錯玩家 | 送出前可取消；送出後 10 分鐘內攤位可作廢 |
| 成績輸錯 | 同上；超時由 Admin 修正 |
| 重複送出 | 送出後按鈕鎖 3 秒 + 本機去重（同玩家同關 5 秒內視為重複） |
| 玩家重複建立 ID | Admin 可合併兩個 playerId（成績合併、抽獎張數重算） |
| QR 無法讀取 | 手動輸入 `FEDA-XXXX` |
| 玩家手機沒電 | 攤位可用「現場建立」代為建立 Game Pass（`createdVia:'staff'`），發紙本 ID |
| 網路中斷 | 成績寫入佇列，UI 顯示「已記錄，待同步」；排行榜顯示最後同步時間 |
| 攤位裝置遺失 | Admin 停權該 uid，該裝置立即失效 |

---

## 11. 資料與指標

活動後匯出（企劃書第三十四章）：

| 指標 | 來源 |
|---|---|
| Game Pass 建立數 | `players` count |
| Unique Player | 有至少 1 次 attempt 的玩家數 |
| 各關參加人數 | `challenges.stats.players` |
| Attempts 總數 | `attempts` count |
| Repeat Attempt 率 | attempts / unique player per challenge |
| QR Scan 次數 | 攤位掃碼事件（含失敗） |
| Leaderboard Views | 前端埋點 |
| 平均每人完成關卡數 | `avg(player.completedChallengeIds.length)` |
| Reward Entries | `sum(player.luckyDrawEntries)` |
| 尖峰時段分布 | attempts 依小時分組 |
| 分齡參與分布 | 依 `player.ageBand` |

**要回答的產品問題**：

1. 哪一關最多人玩？（攤位配置參考）
2. 哪一關重複挑戰率最高？（黏著度）
3. 排行榜有沒有促使玩家再次挑戰？（比較「看過排行榜」與「沒看過」的重複率）

---

## 12. 驗收清單

| # | 情境 | 通過標準 |
|---|---|---|
| C01 | 路人從掃活動 QR 到拿到玩家 QR | ≤ 20 秒，不需註冊 |
| C02 | 攤位從掃碼到送出成績 | ≤ 10 秒，≤ 3 次點擊 |
| C03 | 成績送出後排行榜更新 | ≤ 5 秒 |
| C04 | 同一玩家挑戰 3 次 | 3 筆 attempt 皆保留，排行榜只取最佳 |
| C05 | 完成第 1 關 | 抽獎資格 +1，玩家頁即時反映 |
| C06 | 攤位離線送出 3 筆 | 恢復連線後全部同步且不重複 |
| C07 | 作廢一筆最佳成績 | 排行榜與 best 自動回退到次佳 |
| C08 | 新增第 6 關 | 純後台設定完成，不改任何程式碼 |
| C09 | 新增 `time` 型態關卡（lower is better） | 排行榜排序正確 |
| C10 | 匯出抽獎名單 | 張數與系統顯示一致 |
