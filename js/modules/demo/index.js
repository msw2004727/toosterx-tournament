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

import { EVENT_ID } from '../../config.js';
// ⚠️ 這個模組自己有一個 export function mount(App)，
//    直接匯入 ui 的 mount 會被蓋掉（而且是無聲的遞迴），所以改名。
import { toast, el, sheet, mount as setChildren } from '../../core/ui.js';

const ROLES = [
  { value: 'scorer',     label: '記錄員／賽務', sub: 'scorer',     note: 'A 場．可記分與完賽送出' },
  { value: 'referee',    label: '裁判',        sub: 'referee',    note: 'A 場．同賽務，另可簽核' },
  { value: 'booth',      label: '挑戰攤位',     sub: 'booth',      note: '挑戰區成績登錄（M5）' }
];

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
  const role = await sheet({
    title: '以哪個身分試用？（僅 Demo）',
    columns: 1,
    options: ROLES
  });
  if (!role) return;

  const close = toast('登入中…', 'success');
  try {
    await signInAs(role);
    close();
    toast(`已切換為「${ROLES.find(r => r.value === role).label}」`, 'success');
    App.navigate?.('/staff');
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
