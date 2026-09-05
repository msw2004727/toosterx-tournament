# 07｜權限、安全規則與 Cloud Functions

> 本站採「讀直連、寫由 rules 守衛」的純 Firebase 路線。
> 因為寫入放在客戶端（為了拿到離線佇列），**rules 就是唯一防線，必須寫得很緊**。

---

## 1. 角色與權限矩陣

### 1.1 角色

| 角色 | code | 取得方式 |
|---|---|---|
| 訪客 | `guest` | 未登入 |
| 挑戰玩家 | `player` | 建立 Game Pass（不需 Firebase Auth，以 `playerId` 識別） |
| 攤位人員 | `booth` | Admin 指派 |
| 記錄員 | `scorer` | Admin 指派 |
| 裁判 | `referee` | Admin 指派 |
| 管理員 | `admin` | 超管指派 |
| 超級管理員 | `super_admin` | 手動設定 |

### 1.2 權限矩陣

| 動作 | guest | booth | scorer | referee | admin |
|---|:--:|:--:|:--:|:--:|:--:|
| 讀公開賽程／比分／積分榜 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 讀球員敏感欄位（生日、身分證後四碼） | ❌ | ❌ | ✅※ | ✅※ | ✅ |
| 寫檢錄紀錄 | ❌ | ❌ | ✅※ | ✅※ | ✅ |
| 確認出場名單 | ❌ | ❌ | ✅※ | ✅※ | ✅ |
| 開賽／計時／記錄事件 | ❌ | ❌ | ✅※ | ✅※ | ✅ |
| 完賽送出 | ❌ | ❌ | ✅※ | ✅※ | ✅ |
| 改已鎖定比分 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 覆核完賽（finished→confirmed） | ❌ | ❌ | ❌ | ❌ | ✅ |
| 退回完賽（finished→live） | ❌ | ❌ | ❌ | ❌ | ✅ |
| **三分鐘內自行撤回完賽** | ❌ | ❌ | ✅◎ | ✅◎ | ✅ |

◎ 只有送出完賽的**本人**，且送出後未滿三分鐘、場次尚未被覆核。
　 時間基準是伺服器寫入的 `scoreSubmittedAt` 與 rules 的 `request.time`，
　 客戶端改手機時間或離線囤著再送都無效（見 §2.3 分支 D）。

> **2026-08-29：拿掉場地主任（`venue_lead`）。**
> 現場一天只有三個場地，多一層「可以覆核但不能退回」的角色沒有帶來實質好處，
> 卻讓每條規則都要多列一個字串、每次權限爭議都要先問「他是主任還是 admin」。
> 覆核改由 Admin 做；主任原本真正需要的「送錯了想馬上改」由三分鐘自撤回解決，
> 而且更快——不必找人。
| 建立／修改球隊名單 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 產生／調整賽程 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 手動裁定名次 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 寫 Challenge 成績 | ❌ | ✅※ | ❌ | ❌ | ✅ | ✅ |
| 建立 Game Pass | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 匯出資料 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| 讀稽核日誌 | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |

※ 限於 `staff.assignment` 指派範圍內（場地／組別／關卡）。

### 1.3 動態權限（沿用 FC 機制）

不把權限烤進 Custom Claims，而是讀 Firestore：

```
rolePermissions/{role} = { perms: { 'match.score.write': true, ... } }
userPermissionGrants/{uid} = { grants: { 'match.score.override': { enabled:true } } }
```

好處：Admin 在後台調整權限，**下一次操作立即生效**，不必等 token 刷新（1 小時）。這對現場臨時調度極重要。

#### ⚠️ 實作修正：動態權限只用在 UI 層，不進 rules

原本規劃把 `rolePermissions` / `userPermissionGrants` 也放進 `firestore.rules` 判斷。
實際跑 Emulator 測試後放棄這個做法，原因是 **Firestore rules 每個請求最多評估 1000 個運算式**，
而 rules 裡每多一層 `get()` 與函式巢狀，運算式就成倍成長。

實測結果：早期版本的角色判斷寫成巢狀鏈
（`isScorer() → isAdmin() → hasRole() → isStaff()`，每層都展開一次 staff 文件），
現場最常見的「完賽送出」（一次更新 10 個欄位）就會撞到上限，
錯誤訊息是 `Unable to evaluate the expression as the maximum of 1000 expressions has been reached`——
**合法操作被誤判為 PERMISSION_DENIED**。

因此定案為兩層：

| 層 | 用途 | 資料來源 |
|---|---|---|
| `firestore.rules` | 粗粒度、不可繞過的安全邊界（角色 × 指派範圍 × 欄位白名單） | `staff/{uid}.roles` 一次讀取 |
| 前端 UI | 細粒度的按鈕顯示與功能開關 | `rolePermissions` / `userPermissionGrants` |

安全性不打折：UI 藏起來的按鈕就算被繞過，rules 仍會擋下。
而「Admin 調權限立即生效」的好處在 UI 層完整保留。

**rules 效能鐵則**：角色判斷一律經過單一的 `myRoles()`，
禁止再寫 `isA()` 呼叫 `isB()` 的巢狀鏈。這條寫在 `firestore.rules` 檔頭與 `CLAUDE.md`。

---

## 2. firestore.rules 設計

### 2.1 Helper 函式

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    // ── 基礎 ──
    function isAuth()    { return request.auth != null; }
    function uid()       { return request.auth.uid; }
    function staffPath() { return /databases/$(db)/documents/staff/$(uid()); }

    // ⚠️ 效能鐵則（見 §1.3）：角色一律經過 myRoles()，禁止巢狀呼叫
    function myRoles() {
      return isAuth() && exists(staffPath()) && get(staffPath()).data.active == true
        ? get(staffPath()).data.roles
        : [];
    }
    function isStaff()      { return myRoles().size() > 0; }
    function isSuperAdmin() { return myRoles().hasAny(['super_admin']); }
    function isAdmin()      { return myRoles().hasAny(['admin', 'super_admin']); }
    function isScorer()     { return myRoles().hasAny(['admin', 'super_admin',
                                                        'scorer', 'referee']); }
    function isBooth()      { return myRoles().hasAny(['admin', 'super_admin', 'booth']); }

    // ── 動態權限 ──
    function rolePerms(r) {
      return get(/databases/$(db)/documents/rolePermissions/$(r)).data.perms;
    }
    function hasPerm(p) {
      return isStaff() && staffDoc().roles.hasAny(['super_admin'])
          || (isStaff() && rolePerms(staffDoc().roles[0]).get(p, false) == true)
          || hasUserGrant(p);
    }
    function hasUserGrant(p) {
      return isAuth()
        && exists(/databases/$(db)/documents/userPermissionGrants/$(uid()))
        && get(/databases/$(db)/documents/userPermissionGrants/$(uid()))
             .data.grants.get(p, {'enabled': false}).enabled == true;
    }

    // ── 指派範圍 ──
    function assignedVenue(venueId) {
      return isAdmin()
        || staffDoc().assignment.venueIds.size() == 0
        || venueId in staffDoc().assignment.venueIds;
    }
    function assignedChallenge(cid) {
      return isAdmin() || cid in staffDoc().assignment.challengeIds;
    }

    // ── 欄位控制 ──
    function changedKeys() {
      return request.resource.data.diff(resource.data).affectedKeys();
    }
    function onlyChanged(allowed) {
      return changedKeys().hasOnly(allowed);
    }
    function unchanged(field) {
      return request.resource.data[field] == resource.data[field];
    }
```

### 2.2 各集合規則

```js
    // ── 活動：公開讀，Admin 寫 ──
    match /events/{eventId} {
      allow read: if true;
      allow write: if isAdmin();

      // ── 組別／階段／小組：公開讀 ──
      match /divisions/{divisionId} {
        allow read: if true;
        allow write: if isAdmin();
        match /{sub=**} { allow read: if true; allow write: if isAdmin(); }
      }

      // ── 球隊：公開讀（含 contact，故拆子集合）──
      match /teams/{teamId} {
        allow read: if true;                       // ⚠️ contact 需移到子集合
        allow create, delete: if isAdmin();
        allow update: if isAdmin();

        // 敏感：僅賽務以上
        match /private/{docId} { allow read, write: if isScorer(); }

        // 完整名單：賽務以上可讀（含生日、身分證後四碼）
        match /members/{memberId} {
          allow read:  if isScorer();
          allow write: if isAdmin();
        }
        // 公開投影：任何人可讀，只有 Function 可寫
        match /roster/{memberId} {
          allow read: if true;
          allow write: if false;                   // 僅 Admin SDK
        }
      }

      // ── 場次 ──
      match /matches/{matchId} {
        allow read: if true;

        allow create, delete: if isAdmin();

        allow update: if
          // (A) Admin 全權
          isAdmin()
          // (B) 賽務：限指派場地、限未鎖定、限白名單欄位
          || ( isScorer()
               && assignedVenue(resource.data.venueId)
               && resource.data.lock.locked == false
               && onlyChanged([
                    'score','htScore','penaltyScore','status','period','clock',
                    'result','checkin','lock','scoreSubmittedAt','scoreSubmittedBy',
                    'updatedAt','updatedBy','scoreMismatch'
                  ])
               && request.resource.data.updatedBy == uid()
               // 不可跳過狀態機：只能往前
               && validStatusTransition(resource.data.status,
                                        request.resource.data.status)
               // 比分不得為負、不得超過 99
               && request.resource.data.score.home is int
               && request.resource.data.score.home >= 0
               && request.resource.data.score.home <= 99
               && request.resource.data.score.away is int
               && request.resource.data.score.away >= 0
               && request.resource.data.score.away <= 99
               // 不可竄改對戰隊伍、時間、場地
               && unchanged('home') && unchanged('away')
               && unchanged('divisionId') && unchanged('stageId')
             )
          // (C) 覆核：已鎖定的 finished 也能改成 confirmed，但只准動 status
          || ( isAdmin()
               && assignedVenue(resource.data.venueId)
               && resource.data.status == 'finished'
               && request.resource.data.status == 'confirmed'
               && onlyChanged(['status','updatedAt','updatedBy'])
               && request.resource.data.updatedBy == uid()
             );

        // ── 比賽事件 ──
        match /timeline/{timelineId} {
          allow read: if true;
          allow create: if (isScorer() || isAdmin())
                        && request.resource.data.createdBy == uid()
                        && request.resource.data.matchId == matchId;
          allow update: if isAdmin()
                        || (isScorer() && onlyChanged(['voided','voidedBy','voidedAt','voidReason']));
          allow delete: if false;                  // 永不刪除，只作廢
        }
      }

      // ── 積分榜：公開讀，只有 Function 與 Admin 可寫 ──
      match /standings/{standingId} {
        allow read: if true;
        allow write: if isAdmin();                 // Function 走 Admin SDK 繞過 rules
      }

      // ── 出場名單 ──
      match /matchSheets/{sheetId} {
        allow read: if true;                       // 公開陣容
        allow write: if isScorer() || isAdmin();
      }

      // ── 檢錄 ──
      match /checkins/{checkinId} {
        allow read: if isScorer() || isAdmin();
        allow create: if isScorer()
                      && request.resource.data.scannedBy == uid()
                      && checkinId == request.resource.data.matchId + '__'
                                      + request.resource.data.memberId;
        allow update: if isAdmin();                // 修正只能 Admin
        allow delete: if false;
      }

      // ── 場地 ──
      match /venues/{venueId} {
        allow read: if true;
        allow write: if isAdmin();
      }

      // ── 看板（Function 產出）──
      match /boards/{boardId} {
        allow read: if true;
        allow write: if false;
      }

      // ── Challenge ──
      match /challenges/{challengeId} {
        allow read: if true;
        allow write: if isAdmin();
      }

      match /players/{playerId} {
        allow read: if true;                       // 暱稱與進度為公開資訊
        // 任何人可建立自己的 Game Pass，但欄位受限
        allow create: if request.resource.data.keys().hasOnly([
                          'playerId','eventId','nickname','avatarSeed','ageBand',
                          'qrCode','createdAt','createdVia','completedChallengeIds',
                          'luckyDrawEntries','linkedTeamId','lastActiveAt'
                        ])
                      && request.resource.data.nickname.size() >= 1
                      && request.resource.data.nickname.size() <= 12
                      && request.resource.data.completedChallengeIds.size() == 0
                      && request.resource.data.luckyDrawEntries == 0;
        // 進度與抽獎張數只有 Function／Admin 可改
        allow update: if isAdmin()
                      || (request.auth == null
                          && onlyChanged(['nickname','lastActiveAt','contact']));
        allow delete: if isAdmin();
      }

      match /attempts/{attemptId} {
        allow read: if true;
        allow create: if isBooth()
                      && assignedChallenge(request.resource.data.challengeId)
                      && request.resource.data.staffUid == uid()
                      && request.resource.data.rawValue is number
                      && validScoreRange(eventId, request.resource.data.challengeId,
                                         request.resource.data.rawValue);
        allow update: if isAdmin()
                      || (isBooth() && resource.data.staffUid == uid()
                          && onlyChanged(['voided','voidReason'])
                          && request.time < resource.data.createdAt
                                            + duration.value(10,'m'));
        allow delete: if false;
      }

      match /leaderboards/{lbId} {
        allow read: if true;
        allow write: if false;                     // 僅 Function
      }

      // ── 報名 ──
      match /registrations/{regId} {
        allow read: if isAdmin();
        allow create: if true                      // 公開表單
                      && request.resource.data.status == 'pending';
        allow update: if isAdmin();
        allow delete: if false;
      }

      // ── 稽核：只能新增，不可改不可刪 ──
      match /audits/{auditId} {
        allow read:   if isAdmin();
        allow create: if isStaff() && request.resource.data.actor.uid == uid();
        allow update, delete: if false;
      }

      match /awards/{awardId} {
        allow read: if resource.data.published == true || isAdmin();
        allow write: if isAdmin();
      }
    }

    // ── 根層級 ──
    match /config/{key}            { allow read: if true;  allow write: if isAdmin(); }
    match /rolePermissions/{role}  { allow read: if true;  allow write: if hasRole('super_admin'); }
    match /userPermissionGrants/{u}{ allow read: if isAuth() && (u == uid() || isAdmin());
                                     allow write: if isAdmin(); }
    match /staff/{u} {
      allow read:  if isAuth() && (u == uid() || isAdmin());
      allow write: if isAdmin();
    }

    // 預設拒絕
    match /{document=**} { allow read, write: if false; }
  }
}
```

### 2.3 需要在 rules 中定義的驗證函式

```js
// 非 Admin 分支專用。postponed / cancelled / walkover 一律不在清單中，
// 因此只有 Admin 分支（不經此函式）才設得了這三種狀態。
function validStatusTransition(from, to) {
  return (from == 'scheduled' && to in ['checkin','ready','live'])
      || (from == 'checkin'   && to in ['ready','scheduled'])
      || (from == 'ready'     && to in ['live','checkin'])
      || (from == 'live'      && to in ['halftime','finished'])
      || (from == 'halftime'  && to in ['live','finished'])
      || from == to;
}

// ⚠️ 兩個函式都必須寫在 `match /events/{eventId} { ... }` 區塊內，
//     才拿得到 eventId 這個路徑變數。
function validScoreRange(eventId, cid, v) {
  let c = get(/databases/$(db)/documents/events/$(eventId)/challenges/$(cid)).data;
  return v >= c.minValue && v <= c.maxValue;
}
```

> ⚠️ `validScoreRange` 每次寫入多一次 `get()`。若成本敏感，可改由 Function 事後校驗並標記異常。

### 2.4 rules 測試（`npm run test:rules`）

| # | 測試 | 期望 |
|---|---|---|
| R01 | 訪客讀賽程 | 允許 |
| R02 | 訪客讀 `members` | 拒絕 |
| R03 | 訪客讀 `roster` | 允許 |
| R04 | 訪客寫比分 | 拒絕 |
| R05 | scorer 寫非指派場地的比分 | 拒絕 |
| R06 | scorer 寫已鎖定場次 | 拒絕 |
| R07 | scorer 改 `home.teamId` | 拒絕 |
| R08 | scorer 寫比分 −1 或 100 | 拒絕 |
| R09 | scorer 從 `finished` 改回 `live` | 拒絕 |
| R10 | admin 從 `finished` 改回 `live` | 允許 |
| R11 | 任何人刪 `audits` | 拒絕 |
| R12 | 任何人改 `audits` | 拒絕 |
| R13 | booth 寫非指派關卡成績 | 拒絕 |
| R14 | booth 寫超出 min/max 的成績 | 拒絕 |
| R15 | booth 作廢 11 分鐘前的紀錄 | 拒絕 |
| R16 | 訪客建立 Game Pass 且自帶 `luckyDrawEntries: 99` | 拒絕 |
| R17 | 訪客改別人的 `completedChallengeIds` | 拒絕 |
| R18 | 停權（`active:false`）的 scorer 寫比分 | 拒絕 |
| R19 | 訪客寫 `leaderboards` | 拒絕 |
| R20 | 訪客建立 `registrations` 且 `status:'approved'` | 拒絕 |
| R21 | scorer 把 `scheduled` 改成 `postponed` | 拒絕（僅 Admin） |
| R22 | Admin 把 `finished` 改成 `confirmed` | 允許（只動 status） |
| R23 | 一般賽務改已鎖定的場次 | 拒絕 |
| R24 | 送出者在三分鐘內把 `finished` 退回 `live` | 允許 |
| R25 | 超過三分鐘後再撤回 | 拒絕 |
| R26 | 別人送出的完賽，同場地的另一位賽務要撤回 | 拒絕 |
| R27 | 撤回時順便改比分 | 拒絕 |
| R28 | 已 `confirmed` 的場次要自撤回 | 拒絕 |
| R29 | 撤回時不清掉 `scoreSubmittedAt`（想讓視窗續命） | 拒絕 |
| R30 | 賽務自己塞一個未來的 `scoreSubmittedAt` | 拒絕 |
| R31 | 賽務「完賽但不上鎖」（`status:'finished'` 而 `lock.locked:false`） | 拒絕 |
| R31b | 完賽時同時上鎖 | 允許（正常路徑） |
| R31c | 已 `finished` 但未鎖定的場次，賽務再改比分 | 拒絕 |
| R32 | 完賽送出一次更新 10 個欄位 | 允許，且不得撞到 1000 運算式上限 |
| R33 | 訪客用 collectionGroup 查某球員的出賽紀錄 | 允許（球員頁「出賽紀錄」） |

### M4 報名與球隊管理（docs/10 §5）

| # | 情境 | 期望 |
|---|---|---|
| R34 | Admin 把自己升成 `super_admin` | 拒絕（驗收 A05） |
| R35 | Admin 改別人的 `roles` 或停權 | 拒絕 |
| R36 | 大總管指派 admin | 允許（驗收 A06） |
| R37 | 大總管由介面造出第二個大總管 | 拒絕（白名單不含 `super_admin`） |
| R38 | 大總管改自己的指派場地（roles 不變） | 允許 |
| R39 | Admin 刪 staff 文件 | 拒絕；大總管允許 |
| R40 | 登入者建立自己的 `users/{uid}` | 允許 |
| R41 | 自己的 `users/{uid}` 帶 `roles` | 拒絕（快取欄位，權威在 staff） |
| R42 | 寫別人的 `users/{uid}`／刪自己的 | 拒絕 |
| R43 | 報名關閉時建隊 | 拒絕（驗收 A10） |
| R44 | 已過 `closesAt` ／未到 `opensAt` 建隊 | 拒絕 |
| R45 | `config/registration` 不存在時建隊 | 拒絕（**fail-closed**） |
| R46 | 開放中建隊 | 允許；訪客拒絕 |
| R47 | `captainUid` 不是自己 | 拒絕 |
| R48 | 建隊時自帶 `approved` ／ `rosterLocked` ／ `memberCount` | 拒絕 |
| R49 | 隊長 `draft → submitted` | 允許 |
| R50 | 送出後改隊伍資料 | 拒絕（驗收 A03） |
| R51 | 隊長 `submitted → draft`（撤回）後再改 | 允許 |
| R52 | 隊長自己改成 `approved` | 拒絕 |
| R53 | 隊長關掉 `rosterLocked`／在 draft 時設定它 | 拒絕 |
| R54 | Admin 審核通過並鎖定名單 | 允許；別人的球隊拒絕 |
| R55 | 家長送出加入申請 | 允許（驗收 A01） |
| R56 | 申請時自帶 `approved`／冒用他人 `guardianUid` | 拒絕 |
| R57 | 隊長同意／婉拒／移除隊員 | 允許（驗收 A02） |
| R58 | 名單凍結後隊長再決定申請 | 拒絕（驗收 A04） |
| R59 | 凍結後改備註 | 允許（不影響參賽資格） |
| R60 | 刪除名單文件（含 Admin） | 拒絕（移除是改 status） |
| R61 | 家長在被決定前修正自己填的資料 | 允許；改 status／`guardianUid` 拒絕 |
| R62 | 決定之後家長再改 | 拒絕 |
| R63 | 名單讀取邊界（隊長／本人／賽務可讀，其他拒絕） | 依角色 |
| R64 | 報名截止後或名單凍結後再送申請 | 拒絕 |

> 📌 **這張表停在 R64。** 之後幾批（R65–R125）是實作時才長出來的，
> 逐條列在 `tests/firestore-rules/` 各檔案裡，總覽在 `CLAUDE.md` 的狀態表：
> R65–R72 學童組名單、R73–R92 檢錄與角色階層、R93–R98 報名審核、
> R99–R117 身分授權／權限開關／報名開關、**R118–R125 賽程管理**。
> 看到這裡沒有某個編號不代表沒做，以 `npm run test:rules` 的實際結果為準。

> **⚠️ rules 表達不了的兩件事**，寫在這裡免得日後以為漏做：
> 1. `maxTeamsPerAccount`（每帳號最多 3 隊）——rules 沒辦法 count 文件。
>    由 Function 維護 `users/{uid}.teamCount` 並在超額時退件。屬於防洗版，不是權限邊界。
> 2. 「同一帳號對同一隊只能有一筆申請」（docs/10 §3.3）——rules 查不到
>    「有沒有另一筆 `guardianUid` 相同且 `pending` 的文件」。由 Function 與介面把關。
>    真正的閘門是隊長同意，這兩條只是減少雜訊。

---

## 3. Cloud Functions 契約

Region 一律 `asia-east1`。Runtime `nodejs22`。**ESM**（`functions/package.json`
是 `"type": "module"`）。

> **實作狀態（M3.9）**：結果管線那一段已完成並有 18 個模擬器整合測試
> （F01–F13，`tests/functions/`）＋ 7 條變異（`npm run test:mutation:fn`）：
> `onMatchWritten`、`onTimelineWritten`、`recalcStanding`、`resolveAdvancement`、
> `computeFinalRanking`、`publishFinalRanking`、`rebuildBoards`。
> 其餘 callable 一律丟 `unimplemented` 錯誤，**不回 `ok({})`**——
> 回一個空的成功就是假成功，呼叫端會以為事情做完了。
>
> 計算邏輯全部在 `functions/engine/`，那是 `js/engine/` 的複本，
> 由 `scripts/sync-engine.js` 同步（R-ENG-001；Firebase 只上傳 `functions/`）。

### 3.1 觸發器（Trigger）

#### `onMatchWritten`

```
觸發：onDocumentWritten('events/{eventId}/matches/{matchId}')
條件：status 或 score 或 result 有變動
動作：
  1. 若進入 finished/confirmed/walkover → 呼叫 recalcStanding()
  2. 更新 boards/live（debounce 2 秒）
  3. 若該 stage 全部完賽 → 呼叫 resolveAdvancement()
  4. 寫 audit（source: 'function'）
冪等：以 standing.version 樂觀鎖，亂序寫入不覆寫新版本
```

#### `onTimelineWritten`

```
觸發：onDocumentWritten('events/{e}/matches/{m}/timeline/{t}')
動作：
  1. 重算該場的事件加總，比對 match.score → 不符則設 match.scoreMismatch = true
  2. 更新球員 stats（goals/assists/cards）
  3. 重算 boards/scorers（debounce 5 秒）
```

#### `onMemberWritten`

```
觸發：onDocumentWritten('events/{e}/teams/{tid}/members/{mid}')
動作：同步公開投影到 teams/{tid}/roster/{mid}（僅公開欄位）
```

#### `onAttemptCreated`

```
觸發：onDocumentCreated('events/{e}/attempts/{a}')
動作：
  1. 重算該玩家該關 best（依 rankingRule）
  2. 更新 isBest 標記
  3. 首次完成 → player.completedChallengeIds += cid，luckyDrawEntries += n
  4. 重算 leaderboards/{cid}（debounce 3 秒）
  5. challenges/{cid}.stats 累加
```

#### `onCheckinCreated`

```
觸發：onDocumentCreated('events/{e}/checkins/{c}')
動作：更新 matchSheets 的 checkedInCount 與 issues
```

### 3.2 Callable

| 名稱 | 輸入 | 輸出 | 權限 | 說明 |
|---|---|---|---|---|
| `lineLogin` | `{ idToken }` | `{ customToken, profile }` | 公開 | 驗證 LIFF idToken，查 staff，發 Custom Token |
| `issuePlayerQr` | `{ teamId, memberIds[] }` | `{ issued: [{memberId, qrCode}] }` | admin | 產生 HMAC 簽章的球員證 |
| `revokePlayerQr` | `{ memberId, reason }` | `{ ok }` | admin | 作廢並可重發 |
| `verifyCheckin` | `{ matchId, qrPayload }` | `{ valid, member, reason }` | scorer | 線上驗證路徑（離線走本機比對） |
| `generateSchedule` | `{ divisionId, options }` | `{ created: n, matches[] }` | admin | 依 Format 產生賽程 |
| `scheduleMatches` | `{ divisionId, timing }` | `{ conflicts[] }` | admin | 排定時間與場地 |
| `recalcStanding` | `{ divisionId, stageId, groupId? }` | `{ version, hasUnresolvedTie }` | admin | 強制重算 |
| `resolveAdvancement` | `{ divisionId, stageId }` | `{ resolved[] }` | admin | 解算晉級 |
| `setManualRanking` | `{ divisionId, stageId, groupId, pins[], reason, drawSeed?, clear? }` | `{ standingId, version, hasUnresolvedTie, downstream[] }` | admin | 人工裁定名次；`clear: true` 為解除 |
| `computeFinalRanking` | `{ divisionId }` | `{ ranking[] }` | admin | 解算最終排名 |
| `publishFinalRanking` | `{ divisionId }` | `{ ok }` | admin | 對公開端發布 |
| `mergePlayers` | `{ keepId, mergeId }` | `{ ok }` | admin | 合併重複 Game Pass |
| `exportCsv` | `{ type, filters }` | `{ url, expiresAt }` | admin | 匯出 |
| `exportPdf` | `{ type, filters }` | `{ url, expiresAt }` | admin | 球員證／賽程表／記分表 |
| `sendAnnouncement` | `{ text, from, to }` | `{ ok }` | admin | 公告跑馬燈 |

### 3.3 排程（Scheduler）

| 名稱 | 排程 | 動作 |
|---|---|---|
| `refreshBoards` | 每分鐘（活動三日） | 保底重建 `boards/live`、`boards/today`，避免 trigger 漏掉 |
| `detectAnomalies` | 每 5 分鐘 | 掃描 `00` §異常規則，寫入 `boards/alerts` |
| `nightlyBackup` | 每日 03:00 | Firestore export 到 GCS |

### 3.4 Callable 共通約定

```js
// 統一回傳格式
{ ok: true,  data: {...} }
{ ok: false, error: { code: 'PERMISSION_DENIED', message: '...' } }
```

錯誤碼：`UNAUTHENTICATED` `PERMISSION_DENIED` `INVALID_ARGUMENT` `NOT_FOUND` `FAILED_PRECONDITION` `ALREADY_EXISTS` `INTERNAL`

所有 callable 皆：

1. 驗證 `context.auth`
2. 讀 `staff/{uid}` 檢查角色與 `active`
3. 驗證輸入（用 zod 或手寫 schema）
4. 執行（交易性操作用 `runTransaction`）
5. 寫 `audits`
6. 回傳

---

## 4. QR 簽章機制

### 4.1 產生（`issuePlayerQr`）

```js
const crypto = require('crypto');
const SECRET = process.env.QR_SECRET;                // Secret Manager

function sign(payloadWithoutSig) {
  return crypto.createHmac('sha256', SECRET)
               .update(payloadWithoutSig)
               .digest('hex')
               .slice(0, 8);
}

const base = `FEDA1.${eventShort}.${teamId}.${memberId}.${issuedAt}`;
const qrCode = `${base}.${sign(base)}`;
```

### 4.2 驗證

| 路徑 | 方式 |
|---|---|
| **離線（主要）** | 賽務端比對「掃到的 sig」與「名單快取的 sig」是否相同 |
| **線上（備援）** | `verifyCheckin` 重新計算 HMAC 比對 |

因為 sig 是 HMAC，攻擊者無法在不知道 SECRET 的情況下為任意 memberId 產生有效 sig。離線比對雖然只是「字串相等」，但由於快取名單來自伺服器，效果等同驗簽。

### 4.3 密鑰輪替

- SECRET 存 Secret Manager，版本化
- 輪替時：新證用新版本簽，舊證的 sig 仍存在 `member.qrCode`，離線比對照樣成立
- 若懷疑外洩：改 SECRET → `issuePlayerQr` 全體重發 → 舊證因 sig 不符自動失效

---

## 5. 個資保護

### 5.1 蒐集最小化

| 欄位 | 是否蒐集 | 理由 |
|---|---|---|
| 姓名 | ✅ | 檢錄必要 |
| 生日 | ✅（兒童組必填） | 驗齡必要 |
| 身分證**全碼** | ❌ | 不蒐集 |
| 身分證後四碼 | ✅ | 現場身分核對輔助；僅賽務可讀 |
| 手機 | ✅（僅隊職員聯絡人） | 緊急聯絡 |
| 照片 | ✅（需同意） | 檢錄目視比對 |
| 監護人資訊 | ✅（未成年） | 法定必要 |

### 5.2 存取控制

- 敏感欄位透過 `members` 集合（限賽務以上），公開端只讀 `roster` 投影
- 匯出含個資的檔案需二次確認並寫稽核
- Storage 的球員照片走 `storage.rules` 限制：僅 `isScorer()` 或該球員的球隊管理員可讀原圖；公開端讀縮圖版本

### 5.3 保存期限

- 活動結束 **6 個月** 後，自動刪除 `members` 的 `idLast4`、`birthDate`、`guardianName`、`contact`（保留姓名、背號、統計，供成果查詢）
- 以排程 Function `purgePersonalData` 執行，並寫稽核

### 5.4 未成年保護

- 未滿 18 歲：必填監護人姓名與同意項目
- 未滿 13 歲：公開端預設顯示「姓氏＋名字首字」（王小＊），照片預設不公開
- 兒童組的個人射手榜預設關閉

---

## 6. 安全檢查清單

| # | 項目 | 做法 |
|---|---|---|
| S1 | XSS | 隊名、球員名、暱稱、備註一律 `escapeHTML()` 或 `textContent`（FC R-CODE-002） |
| S2 | 暱稱過濾 | Game Pass 暱稱過濾髒話與空白攻擊，長度 1–12 |
| S3 | Firestore 規則 | 預設拒絕；每個集合明確授權；20 條 rules 測試全綠 |
| S4 | Callable 授權 | 每個 callable 首行檢查 auth 與角色 |
| S5 | 密鑰 | QR SECRET、LINE Channel Secret 存 Secret Manager，絕不進前端 |
| S6 | CSP | `default-src 'self'`；允許 `*.googleapis.com`、`*.gstatic.com`、`www.youtube-nocookie.com`、`*.line-scdn.net` |
| S7 | 防重放 | 檢錄與成績以 doc id 或時間窗去重 |
| S8 | 速率限制 | Game Pass 建立以 App Check + 每 IP 每分鐘 5 次（Function 層） |
| S9 | App Check | 啟用 reCAPTCHA v3（Web），阻擋腳本濫用 |
| S10 | 備份 | 每日 Firestore export；活動三日改為每 6 小時 |
| S11 | 稽核不可竄改 | rules 禁止 update/delete |
| S12 | 依賴 | 前端不引入第三方追蹤腳本；jsQR 等函式庫自行託管 |

---

## 7. 監控與告警

| 監控項 | 工具 | 告警條件 |
|---|---|---|
| Function 錯誤率 | Cloud Logging + Error Reporting | 5 分鐘內 > 5 次 |
| Firestore 讀取量 | Cloud Monitoring | 單日 > 200 萬次 |
| 寫入延遲 | 前端埋點 | P95 > 3 秒 |
| 前端 JS 錯誤 | 自建 `window.onerror` → Function 收集 | 5 分鐘 > 20 次 |
| 賽務端離線比例 | 前端心跳 | > 30% 裝置離線 |
| 異常偵測 | `detectAnomalies` 排程 | 寫入 `boards/alerts`，後台紅點 |

**活動當日值機**：ToosterX 需有一人在後台儀表板前，處理 `boards/alerts` 的紅點。
