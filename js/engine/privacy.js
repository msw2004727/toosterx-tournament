/**
 * 隱私與公開投影
 * ------------------------------------------------------------------
 * 規格：R-PRIV-001、docs/03 §7.3、docs/01b §1.6.1、docs/10 §2.2
 *
 * 這個檔案回答一個問題：**哪些欄位可以離開 `members` 出現在公開端，
 * 以及名字要不要遮**。
 *
 * 為什麼放在 engine：`members` → `roster` 的投影由 Cloud Function 產生，
 * 種子腳本也要產一份一模一樣的，公開端偶爾還要拿遮蔽函式當最後保險。
 * 三個地方各寫一份的話，遲早會分岔——而分岔的那一天，
 * 分岔的方向一定是「某個地方沒遮到」（R-ENG-001）。
 *
 * 純函式：不碰 Firestore、不呼叫 Date.now()（R-ENG-004）。
 * 「現在幾歲」的基準日由呼叫端傳進來。
 */

/** 未滿這個歲數就遮蔽姓名（R-PRIV-001） */
export const MASK_AGE = 13;

/**
 * 公開投影的**唯一權威欄位清單**（docs/01b §1.6.1）。
 * 除了這些，一律不得出現在 `teams/{t}/roster/{m}` 裡。
 */
export const ROSTER_FIELDS = [
  'memberId', 'teamId', 'divisionId', 'displayName', 'jerseyNo', 'position',
  'role', 'isCaptain', 'isGoalkeeper', 'photoUrl', 'stats', 'order'
];

/**
 * 遮蔽姓名：**姓氏＋名字首字＋＊**（王小明 → 王小＊，docs/03 §7.3）。
 *
 * 兩個字以下沒得遮，維持原樣——「王＊」等於只剩姓，反而看不出是誰的小孩，
 * 家長在名單上找不到自己的孩子會直接打電話問主辦。
 */
export function maskName(name) {
  const s = String(name ?? '');
  if (s.length <= 2) return s;
  return s.slice(0, 2) + '＊';
}

/**
 * 基準日當天是否未滿 threshold 歲。
 *
 * 刻意用字串比較而不是 Date：兩邊都是 'YYYY-MM-DD'，
 * 用 Date 反而要處理時區，而 UTC 與 Asia/Taipei 差 8 小時，
 * 剛好會讓生日在月初的小孩算成大一歲。
 *
 * ⚠️ **生日缺漏或格式不對時一律回 true（當成未成年）**。
 *    這是 fail-closed：判斷不了年齡就遮起來。反過來寫的話，
 *    一筆沒填生日的兒童資料會直接以真名出現在公開端。
 *
 * @param {string} birthDate 'YYYY-MM-DD'
 * @param {string} asOf      基準日 'YYYY-MM-DD'（通常是賽事第一天）
 */
export function isMinor(birthDate, asOf, threshold = MASK_AGE) {
  const b = parseYmd(birthDate);
  const a = parseYmd(asOf);
  if (!b || !a) return true;

  let age = a.y - b.y;
  if (a.m < b.m || (a.m === b.m && a.d < b.d)) age -= 1;
  return age < threshold;
}

function parseYmd(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * 公開端要顯示的名字。未滿 13 歲就遮。
 *
 * ⚠️ 判斷依據是**年齡**，不是組別。把 divisionId 寫死（`if (id === 'u10')`）
 *    在兩件事上會錯：兒童組偶爾有超齡的隨隊職員，而成人組也可能有
 *    未滿 13 歲的球員（規程沒有禁止）。年齡才是規格說的那條線。
 */
export function publicDisplayName(member, asOf, threshold = MASK_AGE) {
  const name = member?.displayName ?? member?.name ?? '';
  return isMinor(member?.birthDate, asOf, threshold) ? maskName(name) : String(name);
}

/**
 * `members/{id}` → `roster/{id}` 的公開投影（docs/01b §1.6.1）。
 *
 * 只組出白名單上的欄位。**用「挑出來」而不是「刪掉不要的」**：
 * 前者在 members 新增欄位時預設不外洩，後者預設外洩。
 *
 * @param {object} member  members 文件
 * @param {object} o
 * @param {string} o.teamId / o.divisionId
 * @param {string} o.asOf      年齡基準日（賽事第一天）
 * @param {boolean} [o.photoConsent] 未取得公開同意時 photoUrl 一律 null
 */
export function rosterProjection(member, { teamId, divisionId, asOf, photoConsent = false } = {}) {
  const role = member?.role ?? member?.kind ?? 'player';
  const jerseyNo = typeof member?.jerseyNo === 'number' ? member.jerseyNo : null;
  const s = member?.stats ?? {};

  return {
    memberId: member?.memberId ?? null,
    teamId: teamId ?? member?.teamId ?? null,
    divisionId: divisionId ?? member?.divisionId ?? null,
    displayName: publicDisplayName(member, asOf),
    jerseyNo,
    position: member?.position ?? null,
    role,
    isCaptain: member?.isCaptain === true,
    isGoalkeeper: member?.isGoalkeeper === true,
    // 照片預設不公開（R-PRIV-001）。同意是一個明確的 true，不是「沒說不要」。
    photoUrl: photoConsent === true ? (member?.photoUrl ?? null) : null,
    stats: {
      apps: num(s.apps), goals: num(s.goals), assists: num(s.assists),
      yellow: num(s.yellow), red: num(s.red)
    },
    // 球員依背號排，職員排在後面（docs/01b §1.6.1）
    order: role === 'player' ? (jerseyNo ?? 900) : 900 + ROLE_ORDER.indexOf(role) + 1
  };
}

const ROLE_ORDER = ['coach', 'manager', 'medic', 'staff'];

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** 測試用：這份投影有沒有夾帶白名單以外的欄位 */
export function extraRosterFields(doc) {
  return Object.keys(doc || {}).filter(k => !ROSTER_FIELDS.includes(k));
}
