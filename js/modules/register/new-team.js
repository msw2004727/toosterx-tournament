/**
 * 建立球隊 `#/register/new`
 * ------------------------------------------------------------------
 * 規格：docs/10 §2.1、§3
 *
 * 只收最少的東西：隊名、參賽組別、聯絡方式。
 * 縮寫、隊色、隊徽都不在這裡——報名當下問越多，放棄率越高，
 * 而那些欄位隊長之後隨時能補（名單凍結前都可編輯，§4）。
 */

import { el, mount, toast, skeleton } from '../../core/ui.js';
import { navigate } from '../../core/router.js';
import { user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import * as data from './data.js';
import { pageHead, field, textInput, selectInput, errorBox, iconText } from './bits.js';
import { needLogin } from '../account/login.js';

export async function newTeamPage({ scope, view }) {
  const root = el('div', { class: 'reg' });
  mount(view, root);
  mount(root, skeleton(3));

  const form = { name: '', shortName: '', divisionId: '', phone: '', email: '' };
  const state = { divisions: [], reg: null, loaded: false, busy: false, error: null };

  hold(scope, onAuth(() => state.loaded && render()), 'auth:newteam');

  const [cfg, divisions] = await Promise.all([
    data.getRegistration(),
    data.getDivisions().catch(() => [])
  ]);
  state.reg = data.registrationState(cfg);
  state.divisions = divisions;
  form.divisionId = divisions[0]?.divisionId || '';
  state.loaded = true;
  render();

  function render() {
    if (!user()) { mount(root, needLogin('/register/new')); return; }
    if (!state.reg.open) {
      mount(root,
        pageHead('建立球隊', { onBack: () => navigate('/register') }),
        el('div', { class: 'reg__box reg__box--warn' }, [
          el('strong', { text: state.reg.reason }),
          el('p', { class: 'reg__note', text: '現在沒辦法建立新的球隊。' })
        ]));
      return;
    }
    mount(root, pageHead('建立球隊', { onBack: () => navigate('/register') }), formCard());
  }

  function formCard() {
    const nameOk = form.name.trim().length >= 2;
    const divOk = !!form.divisionId;

    return el('section', { class: 'reg__card' }, [
      errorBox(state.error),

      field('team-name', '隊名', textInput('team-name', {
        value: form.name, placeholder: '例：大甲金剛足球隊', maxlength: 30,
        onInput: v => { form.name = v; refreshSubmit(); }
      }), { required: true, hint: '賽程表與比分板上會顯示這個名字。' }),

      field('team-short', '顯示短名（選填）', textInput('team-short', {
        value: form.shortName, placeholder: '例：大甲金剛', maxlength: 8,
        onInput: v => { form.shortName = v; }
      }), { hint: '窄螢幕的比分板會用短名。留空就自動從隊名取前四個字。' }),

      field('team-div', '參賽組別', selectInput('team-div',
        state.divisions.map(d => ({ value: d.divisionId, label: d.name || d.divisionId })),
        { value: form.divisionId, onChange: v => { form.divisionId = v; refreshSubmit(); } }
      ), { required: true, hint: '選錯的話報名送出前都可以改。' }),

      field('team-phone', '聯絡電話（選填）', textInput('team-phone', {
        value: form.phone, placeholder: '09xx-xxx-xxx', inputmode: 'tel', maxlength: 20,
        onInput: v => { form.phone = v; }
      }), { hint: '只有主辦看得到，公開頁面不會顯示。' }),

      el('button', {
        class: 'btn btn--xl btn--primary', type: 'button', id: 'reg-submit',
        disabled: !nameOk || !divOk || state.busy,
        onClick: () => submit()
      }, state.busy ? '建立中…' : iconText('check', '建立球隊')),

      el('p', { class: 'reg__fine', text: '建立之後你就是這支球隊的隊長，會拿到一組邀請碼給隊友加入。' })
    ].filter(Boolean));
  }

  /** 只切換按鈕的可用狀態，不重畫整張表——重畫會把游標與輸入法狀態打斷 */
  function refreshSubmit() {
    const btn = document.getElementById('reg-submit');
    if (btn) btn.disabled = !(form.name.trim().length >= 2 && form.divisionId) || state.busy;
  }

  async function submit() {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    refreshSubmit();

    try {
      const teamId = await data.createTeam({
        name: form.name.trim(),
        shortName: form.shortName.trim(),
        divisionId: form.divisionId,
        contact: { phone: form.phone.trim() || null, email: form.email.trim() || null }
      });
      toast('球隊建立好了', 'success');
      navigate(`/team/${encodeURIComponent(teamId)}/manage`);
    } catch (err) {
      console.error('[register] createTeam', err);
      state.busy = false;
      state.error = data.explain(err, '建立球隊沒有成功。');
      render();
    }
  }
}
