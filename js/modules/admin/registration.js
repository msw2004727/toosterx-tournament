/**
 * 報名開關 `#/admin/registration`
 * ------------------------------------------------------------------
 * 規格：docs/10 §2.3、R-REG-002、R-PERM-002
 *
 * 總管在這裡開關報名、設定起訖時間。
 *
 * 四件不可協商：
 *   1. **最上面顯示「現在到底開不開放」**，而不是只顯示那個開關。
 *      開放條件是 AND（手動開關 ＋ 起訖區間），只看開關會誤判——
 *      主辦以為開著、家長卻看到「報名尚未開放」。
 *      判斷用 `js/engine/registration.js` 本尊，跟報名端與 rules 同一份。
 *   2. **日期用民國年三格輸入**（R-REG-002）。主辦手上的公告是民國年。
 *   3. **人數上限與費用不在這裡。** 那些照規章第十二條，權威在
 *      `js/engine/formats.js`。讓主辦在這裡改，等於讓系統跟規章不一致。
 *   4. **關掉之前先講後果**：家長會立刻送不出報名。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth } from '../../core/firebase.js';
import { now as serverNow } from '../../core/clock.js';
import { hold } from '../../core/store.js';
import { REGISTRATION_LIMITS } from '../../engine/formats.js';
import {
  registrationState, checkRegistrationDates, buildRegistrationPatch, toMs
} from '../../engine/registration.js';
import { rocDateInput } from '../register/bits.js';
import { dateLabel, hhmm } from '../../lib/format.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

/** 台北時區的 `YYYY-MM-DD` + `HH:MM` → 毫秒 */
const localToMs = (isoDate, hhmmStr) =>
  (!isoDate ? null : Date.parse(`${isoDate}T${hhmmStr || '00:00'}:00+08:00`));

/** 毫秒 → 台北時區的 `YYYY-MM-DD` 與 `HH:MM` */
function msToParts(ms) {
  if (ms == null) return { date: '', time: '' };
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = Object.fromEntries(f.formatToParts(ms).map(x => [x.type, x.value]));
  const h = p.hour === '24' ? '00' : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${h}:${p.minute}` };
}

export async function adminRegistrationPage({ scope, view }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    cfg: undefined,          // undefined = 還沒載入；null = 文件不存在
    draft: null,
    firstMatchDate: null,
    busy: false, error: null
  };

  if (!can('registration.manage')) { mount(root, denied('報名開關', '總管')); return; }

  data.watchRegistration(scope, cfg => {
    state.cfg = cfg;
    // 只在第一次（或自己沒有在編輯時）用伺服器的值重建草稿，
    // 不然總管打到一半會被別人的儲存蓋掉
    if (!state.draft) state.draft = draftFrom(cfg);
    render();
  }, err => { state.error = err; state.cfg = null; state.draft = state.draft ?? draftFrom(null); render(); });

  data.getScheduleBounds().then(b => { state.firstMatchDate = b.firstMatchDate; render(); }).catch(() => {});

  hold(scope, onAuth(() => render()), 'auth:admin-registration');

  // ── 具名函式（會被提升）───────────────────────────────────

  function draftFrom(cfg) {
    const o = msToParts(toMs(cfg?.opensAt));
    const c = msToParts(toMs(cfg?.closesAt));
    return {
      open: cfg?.open === true,
      opensDate: o.date, opensTime: o.time || '00:00',
      closesDate: c.date, closesTime: c.time || '00:00',
      maxTeams: cfg?.maxTeamsPerAccount ?? null
    };
  }

  function draftMs() {
    return {
      opensAt: localToMs(state.draft.opensDate, state.draft.opensTime),
      closesAt: localToMs(state.draft.closesDate, state.draft.closesTime)
    };
  }

  /** 草稿套用之後會是什麼狀態——按下儲存之前就看得到 */
  function previewState() {
    const { opensAt, closesAt } = draftMs();
    return registrationState({ open: state.draft.open, opensAt, closesAt }, serverNow());
  }

  function warnings() {
    const { opensAt, closesAt } = draftMs();
    return checkRegistrationDates({
      opensAt, closesAt, nowMs: serverNow(),
      firstMatchDate: state.firstMatchDate,
      rehearsalDate: null            // 彩排日還沒有進資料庫，暫時不提醒
    });
  }

  function dirty() {
    const a = JSON.stringify(state.draft);
    const b = JSON.stringify(draftFrom(state.cfg));
    return a !== b;
  }

  async function save() {
    const { opensAt, closesAt } = draftMs();

    // 從「開放」關掉是收窄，會立刻影響正在報名的家長——先講後果
    if (state.cfg?.open === true && state.draft.open === false) {
      const ok = await confirmDialog({
        title: '關閉報名？',
        body: '家長會立刻送不出報名，已經送出的不受影響。隨時可以再打開。',
        confirmText: '關閉報名', tone: 'danger'
      });
      if (!ok) return;
    }

    let patch;
    try {
      patch = buildRegistrationPatch({
        open: state.draft.open, opensAt, closesAt,
        maxTeamsPerAccount: state.draft.maxTeams
      });
    } catch (err) { toast(err.message, 'warn'); return; }

    const before = {
      open: state.cfg?.open === true,
      opensAt: toMs(state.cfg?.opensAt), closesAt: toMs(state.cfg?.closesAt)
    };

    state.busy = true; render();
    try {
      await data.saveRegistration(patch);
      await data.writeAudit({
        action: 'registration.update',
        targetType: 'config', targetId: 'registration',
        before, after: { open: patch.open, opensAt, closesAt },
        reason: null
      });
      state.draft = null;              // 下一筆快照會重建，畫面回到「已儲存」
      toast('已儲存');
    } catch (err) {
      toast(data.explain(err, '沒有儲存成功。'), 'error');
    } finally {
      state.busy = false; render();
    }
  }

  // ── 畫面 ─────────────────────────────────────────────────

  function statusBox() {
    const now = registrationState(state.cfg, serverNow());
    const next = previewState();
    const changed = dirty() && next.open !== now.open;
    return el('div', { class: `adm__box ${now.open ? 'adm__box--ok' : 'adm__box--warn'}` }, [
      el('strong', {}, iconText(now.open ? 'check' : 'warn', now.open ? '報名開放中' : '報名關閉中')),
      el('p', { class: 'adm__note', text: now.open ? '家長現在送得出報名。' : now.reason }),
      // 存檔之後會翻面時先講——按下去才發現的話已經影響到家長了
      changed
        ? el('p', { class: 'adm__note', text: `儲存之後會變成「${next.open ? '開放中' : '關閉中'}」。` })
        : null
    ].filter(Boolean));
  }

  function dateField(label, key, hint) {
    const dateKey = `${key}Date`, timeKey = `${key}Time`;
    return el('div', { class: 'adm__field' }, [
      el('span', { class: 'adm__fieldLabel', text: label }),
      rocDateInput(`reg-${key}`, {
        value: state.draft[dateKey],
        onChange: iso => { state.draft[dateKey] = iso || ''; render(); }
      }),
      el('div', { class: 'adm__timeRow' }, [
        el('label', { class: 'adm__fieldLabel', for: `reg-${key}-time`, text: '時間' }),
        el('input', {
          class: 'adm__search adm__time', id: `reg-${key}-time`, type: 'time',
          value: state.draft[timeKey],
          onInput: e => { state.draft[timeKey] = e.target.value; render(); }
        })
      ]),
      // 民國年只存在畫面上，資料庫是西元（R-REG-002）。把西元也印出來對帳。
      state.draft[dateKey]
        ? el('span', { class: 'adm__permNote', text: `＝ 西元 ${state.draft[dateKey]} ${state.draft[timeKey]}` })
        : el('span', { class: 'adm__permNote', text: hint })
    ].filter(Boolean));
  }

  function limitsBox() {
    const L = REGISTRATION_LIMITS;
    return el('div', { class: 'adm__box' }, [
      el('strong', { text: '照競賽規章，不能在這裡改' }),
      el('p', { class: 'adm__note', text: `球員最多 ${L.maxPlayers} 人、隊職員 ${L.maxStaff} 人（領隊／教練／管理各 1）、每人限報乙隊。規章第十二條。` })
    ]);
  }

  function render() {
    if (state.cfg === undefined) { mount(root, adminHead('報名開關'), skeleton(4)); return; }
    // 存檔之後草稿會被清掉，等下一筆快照重建。這裡就地補回來——
    // 只等快照的話，離線時那筆快照可能永遠不會到，畫面就卡在骨架上
    // （R-UI-002 的同一個道理：不要把畫面的狀態綁在 Firestore 的回應上）。
    if (!state.draft) state.draft = draftFrom(state.cfg);

    const warns = warnings();
    const changed = dirty();

    mount(root,
      adminHead('報名開關', { sub: changed ? '有未儲存的變更' : '已儲存' }),

      state.error
        ? el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
            el('strong', { text: '讀不到報名設定' }),
            el('p', { class: 'adm__note', text: data.explain(state.error) })
          ])
        : null,

      statusBox(),

      el('div', { class: 'adm__perm' }, [
        el('div', { class: 'adm__permMain' }, [
          el('span', { class: 'adm__permLabel', text: '開放報名' }),
          el('span', { class: 'adm__permMeta', text: '關掉之後家長立刻送不出報名，已送出的不受影響' })
        ]),
        el('button', {
          class: `adm__switch${state.draft.open ? ' is-on' : ''}`, type: 'button',
          role: 'switch', 'aria-checked': state.draft.open ? 'true' : 'false',
          'aria-label': '開放報名',
          disabled: state.busy,
          onClick: () => { state.draft.open = !state.draft.open; render(); }
        }, el('span', { class: 'adm__switchKnob' }))
      ]),

      el('h3', { class: 'adm__sectionHead', text: '開放期間' }),
      dateField('開始日期（民國年）', 'opens', '不填＝沒有開始限制'),
      dateField('截止日期（民國年）', 'closes', '不填＝沒有截止限制'),

      warns.length
        ? el('ul', { class: 'adm__checks' }, warns.map(w =>
            el('li', { class: 'adm__check adm__check--warn' }, [
              icon('warn'),
              el('span', { class: 'adm__checkText' }, [
                el('span', { text: w.text }),
                el('span', { class: 'adm__checkSrc', text: '提醒，仍然可以儲存' })
              ])
            ])))
        : null,

      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--primary btn--lg', type: 'button',
          disabled: state.busy || !changed,
          onClick: () => save()
        }, iconText('check', '儲存')),
        changed
          ? el('button', {
              class: 'btn btn--lg', type: 'button', disabled: state.busy,
              onClick: () => { state.draft = draftFrom(state.cfg); render(); }
            }, iconText('undo', '放棄變更'))
          : null
      ].filter(Boolean)),

      limitsBox(),

      state.cfg?.updatedAt
        ? el('p', { class: 'adm__permNote', text: `最後更新：${dateLabel(state.cfg.updatedAt)} ${hhmm(state.cfg.updatedAt)}` })
        : null
    );
  }
}
