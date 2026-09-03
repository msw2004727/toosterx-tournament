/**
 * Demo 專屬模組｜正式版永遠不會 import 這個檔案
 * ------------------------------------------------------------------
 * app.js 只在 IS_DEMO 為真時動態 import，所以正式站的 bundle 裡
 * 連這段程式碼都不存在——不是用旗標關掉，是根本沒載入。
 *
 * 1. 頂部常駐 DEMO 橫幅（不可關閉）
 * 2. 免 LINE 登入的角色切換器
 * 3. 一鍵重置種子資料（M5 接上 Function 後開放）
 */

import { EVENT_ID, roleLabel, ROLE_INFO } from '../../config.js';
// ⚠️ 這個模組自己有一個 export function mount(App)，
//    直接匯入 ui 的 mount 會被蓋掉（而且是無聲的遞迴），所以改名。
import { toast, el, sheet, mount as setChildren } from '../../core/ui.js';

/**
 * 可以自助切換的身分。
 *
 * ⚠️ **沒有大總管（super_admin），而且不會加。**
 *    大總管是唯一能指派身分的人（R-RULES-003），自助拿得到就等於
 *    「任何人登入一次就能發身分給任何人」。firestore.rules 的
 *    validSelfServe() 白名單也把它排除在外——兩邊一致。
 *    要測大總管的功能，請用真的 LINE 帳號登入（staff 文件由種子或 Console 建立）。
 */
// 由高到低排，切換清單一眼看得出階層（向上包含，R-ROLE-002）。
// 說明文字直接寫出「多了什麼」，才看得出來層級之間的差別。
export const ROLES = [
  { value: 'admin',   note: '記錄員 ＋ 覆核完賽、改判、賽程、審核報名' },
  { value: 'scorer',  note: '裁判 ＋ 記分、時鐘、完賽送出（A 場）' },
  { value: 'referee', note: '檢錄員 ＋ 出場名單' },
  { value: 'checkin', note: '挑戰攤位 ＋ 檢錄勾選、看球員個資' },
  { value: 'booth',   note: '挑戰區成績登錄（M6）' }
// 標籤一律從 js/config.js 的角色字典取，不要在這裡再寫一份——
// 那一份與 FC-Football 對齊，兩邊分岔會讓同一個角色在兩個系統裡叫不同名字。
].map(r => ({ ...r, label: roleLabel(r.value), sub: `${r.value}　level ${ROLE_INFO[r.value].level}` }));

export function mount(App) {
  banner(App);
}

/**
 * Demo 橫幅 ＋ 切換身分。
 *
 * 「切換身分」原本是右下角的浮動鈕，但 fixed 元素一定會蓋到某一列——
 * 在賽務首頁它壓住「出場名單」，在賽務台它壓住事件時間軸。
 * 改成掛在橫幅裡：橫幅本來就是 sticky 且永遠在最上面，
 * 不會擋到任何操作，而且「這是 demo」與「換個身分看看」本來就是同一件事。
 */
function banner(App) {
  const host = document.getElementById('demo-banner');
  if (!host) return;
  host.hidden = false;
  host.className = 'demo-banner';
  setChildren(host,
    el('span', { class: 'demo-banner__text', text: 'DEMO 展示環境・比分與名次皆為測試資料' }),
    el('button', {
      class: 'demo-switch', type: 'button',
      title: '免登入切換身分（僅 Demo 環境）',
      onClick: () => pick(App)
    }, '切換身分')
  );
}

async function pick(App) {
  // 切換身分會用匿名帳號登入，等於**把目前的 LINE 帳號登出**。
  // 大總管是綁在 LINE uid 上的，切過去就看不到自己的球隊與總管權限了——
  // 這件事要講在按下去之前，不是之後。
  const { user } = await import('../../core/firebase.js');
  const wasLine = !!user() && user().isAnonymous !== true;

  const role = await sheet({
    title: wasLine
      ? '以哪個身分試用？（會登出你的 LINE 帳號）'
      : '以哪個身分試用？（僅 Demo）',
    columns: 1,
    options: wasLine
      ? [...ROLES, { value: '__back', label: '留在我的 LINE 身分', sub: 'line', note: '不切換．回到「我的」' }]
      : ROLES
  });
  if (!role) return;

  if (role === '__back') { App.navigate?.('/my'); return; }

  const close = toast('登入中…', 'success');
  try {
    await signInAs(role);
    close();
    // 導到專屬首頁而不是賽務首頁：那裡才看得到「這個身分能做什麼」，
    // 也才驗得出「層級越高功能越多」。
    toast(`已切換為「${ROLES.find(r => r.value === role).label}」`, 'success');
    if (wasLine) toast('已登出 LINE 帳號。要換回來請到「我的」重新用 LINE 登入。', 'warn');
    App.navigate?.('/my');
  } catch (err) {
    close();
    console.error('[demo] 切換身分失敗', err);
    toast(explain(err), 'error');
  }
}

/**
 * 匿名登入 ＋ 建立一份自助工作人員身分。
 *
 * 之所以做得到，是因為 demo 專案的 config/env.allowSelfServeStaff 為 true，
 * firestore.rules 才會放行「使用者建立自己的 staff 文件」，
 * 而且角色白名單裡沒有 admin。正式專案沒有那份設定文件，這條路整個是關的。
 */
async function signInAs(role) {
  const { auth, db, sdk } = await import('../../core/firebase.js');
  const { signInAnonymously, doc, setDoc, serverTimestamp } = sdk();

  const cred = await signInAnonymously(auth());
  const uid = cred.user.uid;

  await setDoc(doc(db(), 'staff', uid), {
    uid,
    name: `Demo ${ROLES.find(r => r.value === role).label}`,
    lineUserId: null,
    roles: [role],
    assignment: {
      eventId: EVENT_ID,
      date: null,                                  // 不綁日期，看得到全部三天
      venueIds: role === 'booth' ? [] : ['venue-a'],
      divisionIds: [],
      challengeIds: role === 'booth' ? ['g03-crossbar'] : []
    },
    deviceLabel: 'DEMO',
    active: true,
    selfServe: true,                               // rules 靠這個欄位辨識自助身分
    createdAt: serverTimestamp()
  });
}

function explain(err) {
  if (err?.code === 'auth/operation-not-allowed') {
    return '這個 Firebase 專案還沒啟用「匿名登入」。請到 Authentication → Sign-in method 開啟「匿名」。';
  }
  if (err?.code === 'permission-denied') {
    return '資料庫還沒灌 demo 設定（config/env）。請先執行 npm run seed:demo。';
  }
  return `切換身分失敗：${err?.message ?? err}`;
}
