/**
 * 關注（免登入個人化）
 * ------------------------------------------------------------------
 * 規格：docs/03-功能規格-公開端.md §12.1
 *
 * localStorage: feda.follows = { teams:[], matches:[], players:[] }
 *
 * 免登入是刻意的：現場家長不會為了看孩子那場比分去註冊帳號。
 * 代價是換手機就沒了，這個取捨在規格裡已經接受。
 *
 * ⚠️ 所有 storage 存取都要 try/catch：無痕模式、企業裝置的政策、
 *    iOS 的儲存空間不足，都會讓 localStorage 直接 throw。
 *    關注壞掉不可以讓整頁看不了比分。
 */

export const FOLLOW_KEY = 'feda.follows';
const KINDS = ['teams', 'matches', 'players'];

/** 任何輸入 → 合法形狀。壞掉的資料一律當作空，不要讓它傳染到畫面。 */
export function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of KINDS) {
    const list = Array.isArray(src[k]) ? src[k] : [];
    // 去重、去空值、限制長度（有人會把它當書籤存幾百筆）
    out[k] = [...new Set(list.filter(v => typeof v === 'string' && v))].slice(0, 200);
  }
  return out;
}

export function toggle(state, kind, id) {
  const s = normalize(state);
  if (!KINDS.includes(kind) || !id) return s;
  const set = new Set(s[kind]);
  if (set.has(id)) set.delete(id); else set.add(id);
  return { ...s, [kind]: [...set] };
}

export function has(state, kind, id) {
  return normalize(state)[kind]?.includes(id) === true;
}

/* ── 與 localStorage 互動 ───────────────────────────────── */

export function read() {
  try {
    return normalize(JSON.parse(localStorage.getItem(FOLLOW_KEY) || '{}'));
  } catch {
    return normalize(null);
  }
}

export function write(state) {
  const s = normalize(state);
  try { localStorage.setItem(FOLLOW_KEY, JSON.stringify(s)); } catch { /* 存不進去就算了 */ }
  return s;
}

const listeners = new Set();

/** 切換並寫回，回傳新狀態 */
export function toggleAndSave(kind, id) {
  const next = write(toggle(read(), kind, id));
  for (const fn of listeners) { try { fn(next); } catch (e) { console.error('[follows]', e); } }
  return next;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const followedTeamIds = () => read().teams;
