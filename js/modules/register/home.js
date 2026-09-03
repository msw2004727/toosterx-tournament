/**
 * 報名首頁 `#/register`
 * ------------------------------------------------------------------
 * 規格：docs/10 §3
 *
 * **免登入可看**，要送出才需要登入。報名資訊本來就該讓人先看清楚
 * 再決定要不要授權 LINE——先擋登入等於逼人在不知道要做什麼的情況下交出身分。
 */

import { el, mount, skeleton } from '../../core/ui.js';
import { iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { EVENT } from '../../config.js';
import * as data from './data.js';
import { ymdLabel, deadlineLabel } from './bits.js';

export async function registerHome({ scope, view }) {
  const root = el('div', { class: 'reg' });
  mount(view, root);
  mount(root, skeleton(3));

  const state = { cfg: null, reg: null, divisions: [], loaded: false };

  hold(scope, onAuth(() => state.loaded && render()), 'auth:register');

  const [cfg, divisions] = await Promise.all([
    data.getRegistration(),
    data.getDivisions().catch(() => [])
  ]);
  state.cfg = cfg;
  state.reg = data.registrationState(cfg);
  state.divisions = divisions;
  state.loaded = true;
  render();

  function render() {
    // 「我有邀請碼」放在建立球隊**之前**：一支球隊只有一個隊長，
    // 但會有十幾個隊友掃碼進來——多數人來這一頁是要加入，不是建隊。
    mount(root, hero(), joinCard(), statusCard(), stepsCard(), divisionsCard());
  }

  function hero() {
    return el('div', { class: 'reg__hero' }, [
      el('h1', { class: 'reg__title', text: '球隊報名' }),
      el('p', { class: 'reg__sub', text: `${EVENT.name}　·　${EVENT.venueName}` })
    ]);
  }

  // ── 現在能不能報 ────────────────────────────────────────
  function statusCard() {
    const { open, reason, closesAt } = state.reg;

    if (!open) {
      // 關著的時候不要留一顆按下去會失敗的按鈕（不可協商的產品行為 #1 的同一條精神）
      return el('div', { class: 'reg__box reg__box--warn' }, [
        el('strong', { text: reason }),
        closesAt
          ? el('p', { class: 'reg__note', text: `報名截止時間：${deadlineLabel(closesAt)}` })
          : null,
        el('p', { class: 'reg__note', text: '如果你已經報名過，登入後在「我的」看得到自己的球隊。' }),
        el('button', {
          class: 'btn btn--lg', type: 'button', onClick: () => navigate('/my')
        }, iconText('person', '我的'))
      ].filter(Boolean));
    }

    return el('div', { class: 'reg__box' }, [
      el('p', { class: 'reg__open' }, iconText('check', '報名開放中')),
      closesAt ? el('p', { class: 'reg__note', text: `截止時間：${deadlineLabel(closesAt)}` }) : null,
      el('button', {
        class: 'btn btn--xl btn--primary', type: 'button',
        onClick: () => navigate(user() ? '/register/new' : '/login?next=' + encodeURIComponent('/register/new'))
      }, iconText('team', '我要建立球隊')),
      user()
        ? null
        : el('p', { class: 'reg__fine', text: '建立球隊需要先用 LINE 登入，這樣之後才找得回你的球隊。' })
    ].filter(Boolean));
  }

  // ── 流程說明 ────────────────────────────────────────────
  //
  // 兩種組別是兩條路，講成一條會有一半的人照著做卻做不到：
  //   ・學童三組：教練自己建名單（小球員沒有 LINE 帳號）
  //   ・成人三組：邀請碼 ＋ 隊長逐筆同意
  function stepsCard() {
    const adult = [
      ['建立球隊', '填隊名與參賽組別，系統會給你一組邀請碼。'],
      ['把邀請碼給隊友', '隊友用邀請碼加入，填自己的資料。'],
      ['你逐筆同意', '每一筆申請都要你按同意才算數。'],
      ['送出報名', '送出之後名單會凍結，等主辦審核。要改就先撤回。']
    ];
    const youth = [
      ['建立球隊', '填隊名，選學童幼稚園／低年級／中年級。'],
      ['自己新增小球員', '填暱稱、身分證後四碼、出生年月日（民國年）。不需要小朋友或家長登入。'],
      ['送出報名', '送出之後名單會凍結，等主辦審核。要改就先撤回。'],
      ['當天檢錄', '賽前 30 分鐘，由你帶證件（健保卡或戶口名簿）與大會名單核對。']
    ];

    const list = (title, steps) => el('div', { class: 'reg__flow' }, [
      el('h3', { class: 'reg__flowHead', text: title }),
      el('ol', { class: 'reg__steps' }, steps.map(([t, d], i) => el('li', { class: 'reg__step' }, [
        el('span', { class: 'reg__stepNo num', text: String(i + 1) }),
        el('div', { class: 'reg__stepText' }, [
          el('strong', { text: t }),
          el('span', { text: d })
        ])
      ])))
    ]);

    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('list', '報名怎麼進行')),
      list('學童三組（幼稚園／低年級／中年級）', youth),
      list('成人三組（女子公開／男子興趣／男子公開）', adult)
    ]);
  }

  function divisionsCard() {
    if (!state.divisions.length) return null;
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('table', '參賽組別')),
      el('ul', { class: 'reg__divs' }, state.divisions.map(d => el('li', { class: 'reg__div' }, [
        el('strong', { text: d.name || d.divisionId }),
        // ⚠️ 規章上的正式名稱一定要一起顯示。報名表印的是「學童中年級」，
        //    畫面只寫「U10兒童組」的話，家長會問「我到底要報哪一組」——
        //    那是報名期間最常見的詢問。名字不同時才顯示，避免重複。
        d.officialName && d.officialName !== d.name
          ? el('span', { class: 'reg__divOfficial', text: `規章：${d.officialName}` })
          : null,
        el('span', { class: 'reg__divMeta', text: metaOf(d) })
      ])))
    ]);
  }

  // ⚠️ 具名函式不是隨手寫的：render() 在這一行**之前**就會被呼叫，
  //    寫成 const 會撞到 TDZ（Cannot access before initialization），整頁空白。
  //    這一頁的第一次 render() 在資料載入之後、宣告之前。
  function metaOf(d) {
    return [
      d.date ? ymdLabel(d.date) : null,
      d.playersOnField ? `${d.playersOnField} 人制` : null,
      d.matchDurationMin ? `${d.matchDurationMin} 分鐘` : null
    ].filter(Boolean).join('　·　');
  }

  // ── 我是隊友，我有邀請碼 ────────────────────────────────
  function joinCard() {
    let code = '';
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('forward', '我有邀請碼')),
      el('p', { class: 'reg__note', text: '隊長給你的 6 碼英數。輸入之後就能填寫球員資料。' }),
      el('div', { class: 'reg__codeRow' }, [
        el('input', {
          class: 'reg__codeInput', type: 'text', inputmode: 'latin',
          autocapitalize: 'characters', maxlength: '6', placeholder: 'ABC123',
          'aria-label': '邀請碼',
          onInput: e => { code = e.target.value.trim().toUpperCase(); e.target.value = code; }
        }),
        el('button', {
          class: 'btn btn--lg btn--primary', type: 'button',
          onClick: () => code.length === 6 && navigate(`/join/${encodeURIComponent(code)}`)
        }, '前往')
      ])
    ]);
  }
}
