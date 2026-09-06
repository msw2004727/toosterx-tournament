/**
 * 報名圖文教學的內容（純資料，沒有 DOM）
 * ------------------------------------------------------------------
 * 畫面在 tutorial.js。拆開放是為了讓單元測試不用起瀏覽器就能檢查：
 * 每一步都有圖、圖真的在 img/tutorial/ 底下、標記框沒有超出圖的範圍。
 *
 * 圖都是 390×560 的手機截圖（在 demo 站用 Playwright 截的，見 docs/13）。
 * `marks` 是要圈起來的地方，座標就是那張圖的 CSS 像素——畫面用 SVG viewBox
 * 疊上去，所以圖縮放成任何寬度都對得準。
 *
 * 兩條流程是兩條路（主辦 2026-09-03 指定）：
 *   ・成人三組：邀請碼 ＋ 隊長逐筆同意
 *   ・學童三組：教練直接填名單（小球員沒有 LINE，也不必家長操作）
 */

export const SHOT_W = 390;
export const SHOT_H = 560;

/** @typedef {{x:number,y:number,w:number,h:number}} Mark */
/** @typedef {{stage:number, img:string, title:string, desc:string, marks:Mark[], who?:string}} Step */

const M = (x, y, w, h) => ({ x, y, w, h });

/** 兩條流程共用的第一步（改一份就好） */
const START = {
  stage: 0, img: 'home',
  title: '先用 LINE 登入，再按「我要建立球隊」',
  desc: '報名頁上就是這顆按鈕。還沒登入的話會先帶你去登入頁，登入完自動回來。',
  marks: [M(29, 248, 332, 64)]
};

export const FLOWS = {
  adult: {
    key: 'adult',
    label: '成人組',
    sub: '女子公開／男子興趣／男子公開',
    stages: ['建立球隊', '邀請隊友', '同意加入', '送出報名', '主辦審核'],
    steps: [
      START,
      {
        stage: 0, img: 'login',
        title: '用 LINE 登入',
        desc: '一個 LINE 帳號可以當隊長，也可以替家人報名。之後在「我的」就找得回自己的球隊。',
        marks: [M(29, 248, 332, 64)]
      },
      {
        stage: 0, img: 'new-team',
        title: '填隊名、選組別，按「建立球隊」',
        desc: '只要隊名與參賽組別。短名、聯絡電話可以之後再補；組別在送出前都能改。',
        marks: [M(29, 292, 332, 64)]
      },
      {
        stage: 1, img: 'invite',
        title: '把邀請碼或連結給隊友',
        desc: '建好球隊就會拿到一組 6 碼邀請碼。按「複製邀請連結」貼到球隊的 LINE 群組最快。',
        marks: [M(85, 264, 95, 32), M(29, 320, 196, 56)]
      },
      {
        stage: 1, img: 'join-form', who: '隊友的畫面',
        title: '隊友用邀請碼填自己的資料',
        desc: '隊友打開連結、用 LINE 登入，填姓名、生日、背號後按「送出加入申請」。這時還沒進名單。',
        marks: [M(29, 312, 332, 64)]
      },
      {
        stage: 2, img: 'approve',
        title: '每一筆申請都要你按「同意」',
        desc: '申請會出現在「待你同意」。同意才進名單；填錯的可以婉拒，請對方重填一次。',
        marks: [M(82, 262, 76, 36)]
      },
      {
        stage: 3, img: 'submit',
        title: '名單齊了就「送出報名」',
        desc: '送出之後名單會凍結，等主辦審核。還要改就先「撤回報名」，改完再送。',
        marks: [M(29, 248, 332, 64)]
      },
      {
        stage: 4, img: 'submitted',
        title: '狀態變成「待主辦審核」',
        desc: '這段期間隊友沒辦法再申請加入。要調整名單請先撤回，主辦看到的會是你最後送出的版本。',
        marks: [M(285, 167, 76, 23)]
      },
      {
        stage: 4, img: 'approved',
        title: '審核通過就完成報名',
        desc: '狀態「已通過」之後名單鎖定。被退回的話會看到原因，改完再按一次「送出報名」就好。',
        marks: [M(309, 167, 52, 23)]
      }
    ]
  },

  youth: {
    key: 'youth',
    label: '學童組',
    sub: '幼稚園／低年級／中年級',
    stages: ['建立球隊', '選組別', '填名單', '送出報名', '主辦審核'],
    steps: [
      {
        ...START,
        desc: '由教練或球隊負責人操作。小朋友與家長都不需要登入，也不用邀請碼。'
      },
      {
        stage: 1, img: 'youth-division',
        title: '參賽組別選學童組',
        desc: '幼稚園／低年級／中年級依出生年月日分組。門檻會寫在填球員資料的表單上。',
        marks: [M(29, 258, 332, 44)]
      },
      {
        stage: 2, img: 'youth-add',
        title: '按「新增一位球員」自己建名單',
        desc: '學童組不發邀請碼，由你直接建立名單。小球員沒有 LINE，也不必請家長操作。',
        marks: [M(29, 252, 332, 56)]
      },
      {
        stage: 2, img: 'youth-fields',
        title: '填暱稱、民國年生日、身分證後四碼',
        desc: '只收暱稱，不收全名。生日與後四碼是比賽當天檢錄核對證件的依據，一定要填；背號可以先留空。',
        marks: [M(29, 27, 332, 44), M(29, 175, 332, 44), M(29, 324, 332, 44)]
      },
      {
        stage: 2, img: 'youth-too-old',
        title: '超齡會當場擋下',
        desc: '生日早於這一組的門檻就送不出去，畫面會寫出門檻是哪一天。請再對一次證件上的民國年。',
        marks: [M(29, 261, 332, 38)]
      },
      {
        stage: 2, img: 'youth-roster',
        title: '球員最多 15 位、隊職員 3 位',
        desc: '領隊、教練、管理各 1 位，不必填生日與後四碼。你填的每一筆都可以修改或移除。',
        marks: [M(29, 62, 332, 34)]
      },
      {
        stage: 3, img: 'youth-submitted',
        title: '填完就「送出報名」',
        desc: '送出後名單凍結，等主辦審核。要改就先「撤回報名」，改完再送一次。',
        marks: [M(285, 167, 76, 23)]
      },
      {
        stage: 4, img: 'youth-rejected',
        title: '被退回的話會看到原因',
        desc: '照原因修改名單，再按一次「送出報名」就會重新送審，不必重新建隊。',
        marks: [M(29, 202, 332, 122)]
      },
      {
        stage: 4, img: 'youth-approved',
        title: '通過後，比賽當天帶證件來檢錄',
        desc: '賽前 30 分鐘由教練帶健保卡或戶口名簿到檢錄處。檢錄員核對後四碼與生日之後，在名單上勾選出賽。',
        marks: [M(309, 167, 52, 23)]
      }
    ]
  }
};

export const FLOW_KEYS = Object.keys(FLOWS);

/** 全部用到的圖檔名（不含副檔名），單元測試拿去對 img/tutorial/ */
export function guideImages() {
  return [...new Set(FLOW_KEYS.flatMap(k => FLOWS[k].steps.map(s => s.img)))];
}
