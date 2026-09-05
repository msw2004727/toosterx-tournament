/**
 * 用邀請碼加入球隊 `#/join/:inviteCode`
 * ------------------------------------------------------------------
 * 規格：docs/10 §1.3、§3.3
 *
 * **一個 LINE 帳號可以對應多個球員**：家長用自己的帳號替兩個小孩報名，
 * 兩個小孩可能在不同球隊。所以這一頁問的是「這位球員是誰」，
 * 不是「你是誰」——送出的人是監護人，被登記的是球員。
 *
 * 成人組本人報名時 `isSelf = true`，介面上就不出現「監護人」字樣。
 */

import { el, mount, toast, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import * as data from './data.js';
import { pageHead, field, textInput, selectInput, errorBox, iconText, TEAM_STATUS } from './bits.js';
import { needLogin } from '../account/login.js';

/** 兒童組：預設是「家長替小孩報名」。判斷依據是組別設定，不是把 id 寫死。 */
const isYouthDivision = div => div?.display?.scorerBoard === false;

export async function joinPage({ params, scope, view }) {
  const code = String(params.inviteCode || '').toUpperCase();
  const root = el('div', { class: 'reg' });
  mount(view, root);
  mount(root, skeleton(3));

  const form = { name: '', birthDate: '', idLast4: '', jerseyNo: '', position: '', kind: 'player', glasses: false, glassesConsent: false };
  const state = { team: null, division: null, reg: null, loaded: false, busy: false, error: null, done: false };

  hold(scope, onAuth(() => state.loaded && render()), 'auth:join');

  const [cfg, team] = await Promise.all([
    data.getRegistration(),
    data.findTeamByInviteCode(code).catch(() => null)
  ]);
  state.reg = data.registrationState(cfg);
  state.team = team;
  if (team) {
    state.division = (await data.getDivisions().catch(() => []))
      .find(d => d.divisionId === team.divisionId) || null;
    // 成人組預設本人報名
    form.isSelf = !isYouthDivision(state.division);
  }
  state.loaded = true;
  render();

  function render() {
    if (!state.team) {
      mount(root,
        pageHead('加入球隊', { onBack: () => navigate('/register') }),
        el('div', { class: 'reg__box reg__box--warn' }, [
          el('strong', { text: '找不到這組邀請碼' }),
          el('p', { class: 'reg__note', text: `你輸入的是「${code}」。請跟隊長確認一次，注意大小寫不分但別漏字。` }),
          el('button', { class: 'btn btn--lg', type: 'button', onClick: () => navigate('/register') }, '回報名頁')
        ]));
      return;
    }

    if (state.done) { mount(root, doneCard()); return; }
    if (!user()) { mount(root, teamCard(), needLogin(`/join/${encodeURIComponent(code)}`)); return; }

    const blocked = blockReason();
    mount(root,
      pageHead('加入球隊', { onBack: () => navigate('/register') }),
      teamCard(),
      blocked
        ? el('div', { class: 'reg__box reg__box--warn' }, [
            el('strong', { text: blocked }),
            el('p', { class: 'reg__note', text: '如果你已經送出過申請，請直接問隊長進度。' })
          ])
        : formCard()
    );
  }

  /** 送不出去的原因。畫面上要先說，不要讓人填完才被擋。 */
  function blockReason() {
    if (!state.reg.open) return state.reg.reason;
    const s = state.team.status || 'draft';
    if (state.team.rosterLocked === true) return '這支球隊的名單已經審核通過並鎖定了。';
    if (!['draft', 'rejected'].includes(s)) {
      return `這支球隊已經送出報名（${TEAM_STATUS[s] || s}），名單暫時凍結。`;
    }
    return null;
  }

  function teamCard() {
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead', text: state.team.name || state.team.teamId }),
      el('p', { class: 'reg__note', text: state.division?.name || state.team.divisionId }),
      el('p', { class: 'reg__fine', text: `邀請碼 ${code}` })
    ]);
  }

  function formCard() {
    const youth = isYouthDivision(state.division);
    const nameOk = form.name.trim().length >= 2;

    return el('section', { class: 'reg__card' }, [
      errorBox(state.error),

      youth
        ? el('p', { class: 'reg__note', text: '請填「小孩」的資料。送出的人是你（監護人），系統會把你和這位球員綁在一起。' })
        : el('p', { class: 'reg__note', text: '請填你自己的資料。' }),

      field('m-name', youth ? '球員姓名（小孩）' : '姓名', textInput('m-name', {
        value: form.name, placeholder: '王小明', maxlength: 20,
        onInput: v => { form.name = v; refreshSubmit(); }
      }), { required: true, hint: youth ? '未滿 13 歲的球員在公開頁面只會顯示「王小＊」。' : null }),

      field('m-birth', '出生年月日', textInput('m-birth', {
        value: form.birthDate, type: 'date', onInput: v => { form.birthDate = v; }
      }), { hint: '用來確認組別資格，也用來判斷公開頁面要不要遮蔽姓名。' }),

      field('m-id4', '身分證後四碼（選填）', textInput('m-id4', {
        value: form.idLast4, placeholder: '1234', maxlength: 4, inputmode: 'numeric',
        onInput: v => { form.idLast4 = v.replace(/\D/g, '').slice(0, 4); }
      }), { hint: '只有主辦與隊長看得到，用來核對身分。公開頁面永遠不會出現。' }),

      field('m-no', '背號（選填）', textInput('m-no', {
        value: form.jerseyNo, placeholder: '7', maxlength: 2, inputmode: 'numeric',
        onInput: v => { form.jerseyNo = v.replace(/\D/g, '').slice(0, 2); }
      }), { hint: '重複的話隊長之後可以調整。' }),

      field('m-kind', '身分', selectInput('m-kind', [
        { value: 'player', label: '球員' },
        { value: 'coach', label: '教練' },
        { value: 'staff', label: '隊職員' }
      ], { value: form.kind, onChange: v => { form.kind = v; } })),

      // ── 配戴眼鏡上場（規章附件二）：勾了就要同意切結書才送得出去 ──
      el('label', { class: 'reg__checkRow' }, [
        el('input', {
          type: 'checkbox', id: 'm-glasses', checked: form.glasses,
          onChange: e => { form.glasses = e.target.checked; if (!form.glasses) form.glassesConsent = false; render(); }
        }),
        el('span', { text: youth ? '這位球員會配戴眼鏡上場' : '我會配戴眼鏡上場' })
      ]),
      form.glasses
        ? el('div', { class: 'reg__box', id: 'm-glasses-box' }, [
            el('strong', { text: '球員配戴眼鏡上場安全切結書（規章附件二）' }),
            el('p', { class: 'reg__note', text:
              '眼鏡必須是運動專用安全防護眼鏡（防護框、安全鏡片、無銳利邊角、附固定帶），' +
              '不可以是日常的膠框、金屬框或玻璃鏡片。裁判賽前可以檢查，不合格要更換或不下場。' +
              '眼鏡毀損與因配戴眼鏡造成的自身或他人傷害，由球員、法定代理人與所屬球隊自行負責。' }),
            el('a', { class: 'reg__fine', href: '#/register/waiver', target: '_blank', rel: 'noopener', text: '看完整切結書（可列印）' }),
            el('label', { class: 'reg__checkRow' }, [
              el('input', {
                type: 'checkbox', id: 'm-glasses-consent', checked: form.glassesConsent,
                onChange: e => { form.glassesConsent = e.target.checked; refreshSubmit(); }
              }),
              el('span', { text: youth ? '本人（家長／法定代理人）已閱讀並同意上述切結條款' : '本人已閱讀並同意上述切結條款' })
            ])
          ])
        : null,

      el('button', {
        class: 'btn btn--xl btn--primary', type: 'button', id: 'join-submit',
        disabled: !nameOk || state.busy || (form.glasses && !form.glassesConsent),
        onClick: () => submit()
      }, state.busy ? '送出中…' : iconText('check', '送出加入申請')),

      el('p', { class: 'reg__fine', text: '送出之後要等隊長同意才算加入。你可以隨時回來看狀態。' })
    ].filter(Boolean));
  }

  function doneCard() {
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('check', '申請已送出')),
      el('p', { class: 'reg__note', text: `已經送到「${state.team.name}」，等隊長同意就完成加入。` }),
      el('p', { class: 'reg__fine', text: '隊長同意後，這位球員會出現在球隊名單上。' }),
      el('button', {
        class: 'btn btn--lg btn--primary', type: 'button', onClick: () => navigate('/my')
      }, iconText('person', '回到我的'))
    ]);
  }

  function refreshSubmit() {
    const btn = document.getElementById('join-submit');
    if (btn) btn.disabled = form.name.trim().length < 2 || state.busy || (form.glasses && !form.glassesConsent);
  }

  async function submit() {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    refreshSubmit();

    try {
      await data.applyMember(state.team.teamId, {
        name: form.name.trim(),
        birthDate: form.birthDate || null,
        idLast4: form.idLast4 || null,
        jerseyNo: form.jerseyNo ? Number(form.jerseyNo) : null,
        position: form.position || null,
        kind: form.kind,
        isSelf: form.isSelf === true,
        glasses: form.glasses === true,
        glassesConsent: form.glassesConsent === true
      });
      state.done = true;
      toast('申請已送出', 'success');
      render();
    } catch (err) {
      console.error('[join] applyMember', err);
      state.busy = false;
      state.error = data.explain(err, '申請沒有送出去。');
      render();
    }
  }
}
