/**
 * 場次統計原語｜Tally
 * ------------------------------------------------------------------
 * 規格：docs/02-賽制引擎與排名規則.md §5
 *
 * 為什麼獨立成一個檔案：
 *   standing.js 要用它算全組積分榜，ranking.js 要用它算同分群的「迷你對戰表」。
 *   若讓 ranking.js 直接 import standing.js 會形成循環相依，因此把
 *   「一批場次 → 每隊統計」這個純運算抽出來，兩邊共用。
 *
 * 這裡的函式全部是純函式：同樣的輸入永遠得到同樣的輸出（冪等性，測試 T13）。
 */

/** 納入統計的場次狀態。其餘狀態（含 postponed / cancelled）一律略過。 */
export const COMPLETED_STATUSES = ['finished', 'confirmed', 'walkover'];

export const DEFAULT_POINTS = { win: 3, draw: 1, loss: 0 };

/**
 * 棄賽判定（§5.2）。scoreFor/scoreAgainst 只在 countInGoalStats 為真時計入得失球。
 *
 * ⚠️ **0:2 是競賽規章第十八條第 6 款寫死的數字**，不是我們挑的：
 *    「球隊逾時 5 分鐘不出場以棄權論 0:2」。
 *    原本是足球界常見的 3:0，跟規章不符——同分時比正負球數會差一球，
 *    足以換掉一個名次。
 *    規章同一款還說「即停止本賽事出賽資格，已賽成績不予計算」，
 *    那一段是退賽（withdrawnTeamIds / withdrawalPolicy），不在這裡處理。
 */
export const DEFAULT_WALKOVER = {
  scoreFor: 2,
  scoreAgainst: 0,
  awardPoints: 3,
  penaltyPoints: 0,
  countInGoalStats: true
};

/**
 * 嚴格數值檢查。
 * ⚠️ 不要用 Number(v)：Number(null)、Number('')、Number([]) 全都是 0，
 *    會把「比分沒填」的場次悄悄判成 0:0 平手。寧可整場不計，也不要造出假比分。
 */
function strictNum(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 整隊退賽處理（§5.2）。voidAll 為 FIFA 通用做法，也是本賽事預設。 */
export const WITHDRAWAL_POLICY = { VOID_ALL: 'voidAll', KEEP_AS_WALKOVER: 'keepAsWalkover' };

export function emptyStat(teamId) {
  return {
    teamId,
    played: 0, win: 0, draw: 0, loss: 0,
    goalsFor: 0, goalsAgainst: 0, goalDiff: 0,
    points: 0,
    form: []            // 依開賽時間排序的 W/D/L
  };
}

/**
 * 這場是否已完賽、且該納入統計。
 * @param {object} m match 文件
 */
export function isCompleted(m) {
  return COMPLETED_STATUSES.includes(m?.status);
}

/**
 * 取得一場比賽「計入積分榜的比分」。
 *
 * 與 `match.score`（裁判維護的顯示值）的差別：
 *   - 棄賽場次改用判定比分（預設 3:0）
 *   - 仁慈規則會把分差壓到 cap 以內（兒童組，避免用大比分刷得失球差）
 *   - PK 決勝的場次，正規時間比分視為平手（§10）
 *
 * @param {object} m match 文件
 * @param {object} [opts]
 * @param {object} [opts.walkover]  棄賽判定設定
 * @param {{enabled:boolean, cap:number}} [opts.mercyRule]
 * @returns {{home:number, away:number, diff:number, countGoals:boolean,
 *            isWalkover:boolean, points:{home:number,away:number}|null}|null}
 *          diff 是「計入得失球差的分差」，仁慈規則生效時會小於 home-away
 */
export function effectiveScore(m, opts = {}) {
  if (!isCompleted(m)) return null;

  const wo = { ...DEFAULT_WALKOVER, ...(opts.walkover || {}) };

  if (m.status === 'walkover') {
    // walkoverSide 記錄的是「棄賽的那一方」，對手獲判勝
    const forfeit = m.walkoverSide;
    if (forfeit !== 'home' && forfeit !== 'away') return null;   // 資料不完整，寧可不計
    return walkoverScore(forfeit, wo);
  }

  const raw = m.score || {};
  const home = strictNum(raw.home);
  const away = strictNum(raw.away);
  if (home === null || away === null) return null;

  // 仁慈規則（§6.2）：規格只說「**得失球差**最多計 7」，
  // 所以 goalsFor / goalsAgainst 照實記，只壓 goalDiff 的每場貢獻。
  // 公開端另有「顯示為 7+」的規則，那是 UI 層的事。
  let diff = home - away;
  const mercy = opts.mercyRule;
  if (mercy?.enabled) {
    const cap = Math.max(1, Math.trunc(mercy.cap ?? 7));   // cap 來自後台設定，必須有下限
    diff = Math.max(-cap, Math.min(cap, diff));
  }

  return {
    home, away, diff,
    countGoals: true,
    isWalkover: false,
    winSide: null,         // null = 依比分推勝負與積分
    points: null           //        （含 PK：正規時間平手，各得 1 分，§10）
  };
}

/** 棄賽的判定比分與積分。awardPoints / penaltyPoints 可由設定覆寫（§5.2） */
function walkoverScore(forfeitSide, wo) {
  const winFor = forfeitSide === 'home' ? 'away' : 'home';
  const home = winFor === 'home' ? wo.scoreFor : wo.scoreAgainst;
  const away = winFor === 'away' ? wo.scoreFor : wo.scoreAgainst;
  return {
    home, away,
    diff: home - away,
    countGoals: wo.countInGoalStats,
    isWalkover: true,
    winSide: winFor,
    // 棄賽的積分由設定決定，不從比分推——否則 scoreFor=0 會變成「平手各得 1 分」
    points: {
      home: winFor === 'home' ? wo.awardPoints : wo.penaltyPoints,
      away: winFor === 'away' ? wo.awardPoints : wo.penaltyPoints
    }
  };
}

/**
 * 把一批場次統計成每隊的基礎數據。
 *
 * @param {string[]} teamIds        要統計的球隊（不在此清單中的隊伍會被忽略）
 * @param {object[]} matches        場次文件；只有 isCompleted() 為真的才會被計入
 * @param {object} [opts]
 * @param {object} [opts.points]    積分規則，預設 3/1/0
 * @param {object} [opts.walkover]
 * @param {object} [opts.mercyRule]
 * @param {string[]} [opts.withdrawnTeamIds]  整隊退賽的球隊
 * @param {string} [opts.withdrawalPolicy]    voidAll（預設）| keepAsWalkover
 * @param {boolean} [opts.onlyBetweenTeams]   只計「雙方都在 teamIds 內」的場次（迷你對戰表用）
 * @returns {{stats: Map<string, object>, countedMatchIds: Set<string>}}
 *          countedMatchIds 是「真的被計入」的場次；行為分要用它過濾，
 *          否則作廢或資料不全的場次上的紅黃牌會影響排名。
 */
export function tallyMatches(teamIds, matches, opts = {}) {
  const pts = { ...DEFAULT_POINTS, ...(opts.points || {}) };
  const withdrawn = new Set(opts.withdrawnTeamIds || []);
  const policy = opts.withdrawalPolicy || WITHDRAWAL_POLICY.VOID_ALL;
  const voidWithdrawn = policy === WITHDRAWAL_POLICY.VOID_ALL;

  const pool = new Set(teamIds);
  const stats = new Map();
  for (const id of teamIds) {
    // 整隊退賽且採 voidAll：該隊不出現在積分榜
    if (voidWithdrawn && withdrawn.has(id)) continue;
    stats.set(id, emptyStat(id));
  }

  // 先依開賽時間排序，form（近期戰績）才有意義；缺 kickoffAt 時退回 matchId
  const ordered = [...matches].sort(compareByKickoff);
  const counted = new Set();

  for (const m of ordered) {
    const h = m.home?.teamId;
    const a = m.away?.teamId;
    if (!h || !a) continue;

    // voidAll：牽涉退賽隊伍的場次整場作廢，其他隊之間的成績不受影響（T10）
    if (voidWithdrawn && (withdrawn.has(h) || withdrawn.has(a))) continue;

    const homeIn = pool.has(h) && stats.has(h);
    const awayIn = pool.has(a) && stats.has(a);
    if (!homeIn && !awayIn) continue;
    if (opts.onlyBetweenTeams && !(homeIn && awayIn)) continue;

    let sc = effectiveScore(m, opts);

    // keepAsWalkover：退賽隊「已賽場次保留，未賽場次判 3:0」（§5.2）
    if (!sc && !voidWithdrawn && !isCompleted(m)) {
      const forfeit = withdrawn.has(h) ? 'home' : withdrawn.has(a) ? 'away' : null;
      if (forfeit) sc = walkoverScore(forfeit, { ...DEFAULT_WALKOVER, ...(opts.walkover || {}) });
    }
    if (!sc) continue;

    if (m.matchId) counted.add(m.matchId);
    if (homeIn) applyOne(stats.get(h), 'home', sc, pts);
    if (awayIn) applyOne(stats.get(a), 'away', sc, pts);
  }

  return { stats, countedMatchIds: counted };
}

function applyOne(st, side, sc, pts) {
  const other = side === 'home' ? 'away' : 'home';
  const gf = sc[side];
  const ga = sc[other];

  st.played += 1;
  if (sc.countGoals) {
    st.goalsFor += gf;
    st.goalsAgainst += ga;
    // ⚠️ 仁慈規則生效時 goalDiff 會 ≠ goalsFor − goalsAgainst，這是規格要的（§6.2）
    st.goalDiff += side === 'home' ? sc.diff : -sc.diff;
  }

  // 棄賽的勝負由 winSide 決定，不從比分推——
  // 否則設定成 0:0 判定比分時會變成「平手，棄賽方還拿 1 分」
  const outcome = sc.winSide
    ? (sc.winSide === side ? 'W' : 'L')
    : gf > ga ? 'W' : gf < ga ? 'L' : 'D';

  if (outcome === 'W') st.win += 1;
  else if (outcome === 'L') st.loss += 1;
  else st.draw += 1;
  st.form.push(outcome);

  const forced = sc.points?.[side];
  st.points += typeof forced === 'number'
    ? forced
    : outcome === 'W' ? pts.win : outcome === 'L' ? pts.loss : pts.draw;
}

/** 開賽時間排序；同時間或缺欄位時用 matchId 保證結果穩定（冪等性） */
export function compareByKickoff(x, y) {
  const tx = toMillis(x.kickoffAt);
  const ty = toMillis(y.kickoffAt);
  if (tx !== ty) return tx - ty;
  return String(x.matchId || '').localeCompare(String(y.matchId || ''));
}

function toMillis(v) {
  if (v == null) return Number.MAX_SAFE_INTEGER;
  if (typeof v.toMillis === 'function') return v.toMillis();      // Firestore Timestamp
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
}
