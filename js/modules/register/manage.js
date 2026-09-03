/**
 * 隊長端 `#/team/:teamId/manage`
 * ------------------------------------------------------------------
 * 規格：docs/10 §3、§4
 *
 * 隊長在這裡做四件事：把邀請碼給隊友、逐筆同意申請、送出報名、發公告。
 *
 * ⚠️ **「名單凍結」與「不能調度」是兩件事**（docs/10 §3.2）：
 *    這一頁凍結的是「誰在這支隊」。比賽當天誰先發誰替補是賽務台的事，
 *    每一場都能改，不需要動這裡，也不需要找主辦。
 */

import { el, mount, toast, confirmDialog, skeleton } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { navigate } from '../../core/router.js';
import { user, onAuth } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import * as data from './data.js';
import {
  pageHead, statusBadge, errorBox, field, textInput, selectInput, rocDateInput,
  TEAM_STATUS, MEMBER_STATUS, KIND_LABEL
} from './bits.js';
import { isYouthDivision, validateMember, canAddMember } from '../../engine/eligibility.js';
import { REGISTRATION_LIMITS } from '../../engine/formats.js';
import { rocShort, rocLabel } from '../../lib/roc.js';
import { needLogin } from '../account/login.js';

export async function managePage({ params, scope, view }) {
  const { teamId } = params;
  const root = el('div', { class: 'reg' });
  mount(view, root);
  mount(root, skeleton(4));

  const state = {
    team: null, members: [], reg: null, division: null,
    loaded: false, busy: false, error: null,
    // 教練直接新增／編輯用的暫存表單。null = 沒有在編輯
    form: null, formErrors: {}
  };

  data.getRegistration().then(cfg => { state.reg = data.registrationState(cfg); render(); });

  data.watchTeam(scope, teamId, t => {
    state.team = t;
    state.loaded = true;
    // 組別設定只讀一次：資格門檻與「走不走邀請碼」都靠它
    if (t?.divisionId && state.division?.divisionId !== t.divisionId) {
      data.getDivision(t.divisionId).then(d => { state.division = d; render(); });
    }
    render();
  }, err => fail('讀不到這支球隊', err));
  data.watchMembers(scope, teamId, rows => { state.members = rows; render(); },
    err => console.warn('[manage] members', err));

  hold(scope, onAuth(() => render()), 'auth:manage');

  function fail(title, err) {
    console.error('[manage]', err);
    state.loaded = true;
    mount(root, el('div', { class: 'reg__box reg__box--warn' }, [
      el('strong', { text: title }),
      el('p', { class: 'reg__note', text: data.explain(err) })
    ]));
  }

  // ── 目前的權限狀態 ──────────────────────────────────────
  // ⚠️ 一律用具名函式（會被提升）。上面的 watchTeam/watchMembers 在第一筆
  //    快照到達時就會同步呼叫 render()，而 render() 用得到這兩個——
  //    寫成 const 會撞到 TDZ（Cannot access before initialization），整頁空白。
  //    這個坑在這個 codebase 已經出現四次了，見 CLAUDE.md 的「頁面模組的順序陷阱」。
  function isCaptain() {
    return !!user() && state.team?.captainUid === user().uid;
  }
  function frozen() {
    return state.team?.rosterLocked === true
      || !['draft', 'rejected'].includes(state.team?.status || 'draft');
  }
  /**
   * 這一組走不走「教練直接管理名單」。
   * 判斷依據是組別**有沒有年齡門檻**，不是 divisionId——寫死代碼的話
   * 辦第二場就會錯（專案本質是設定檔驅動）。
   * 組別還沒讀到時回 false：先畫邀請碼比先畫一個填不了的表單好，
   * 而且 render() 會在讀到之後再跑一次。
   */
  function youth() { return isYouthDivision(state.division); }

  function render() {
    if (!state.loaded) return;
    if (!user()) { mount(root, needLogin(`/team/${encodeURIComponent(teamId)}/manage`)); return; }
    if (!state.team) {
      mount(root, el('div', { class: 'reg__box reg__box--warn' }, [
        el('strong', { text: '找不到這支球隊' })
      ]));
      return;
    }
    if (!isCaptain()) {
      mount(root,
        pageHead(state.team.name || teamId, { onBack: () => navigate('/my') }),
        el('div', { class: 'reg__box reg__box--warn' }, [
          el('strong', { text: '你不是這支球隊的隊長' }),
          el('p', { class: 'reg__note', text: '只有隊長能管理名單。想看公開資訊請到球隊頁。' }),
          el('button', {
            class: 'btn btn--lg', type: 'button',
            onClick: () => navigate(`/team/${encodeURIComponent(teamId)}`)
          }, '看球隊頁')
        ]));
      return;
    }

    mount(root,
      pageHead(state.team.name || teamId, {
        sub: TEAM_STATUS[state.team.status] || state.team.status,
        onBack: () => navigate('/my')
      }),
      errorBox(state.error),
      statusCard(),
      // 學童組：教練自己新增，不發邀請碼（家長沒有帳號也填不了）
      // 成人組：邀請碼 ＋ 逐筆同意
      ...(youth() ? [addMemberCard()] : [inviteCard(), pendingCard()]),
      rosterCard(),
      announcementCard()
    );
  }

  // ── 報名狀態與送出／撤回 ────────────────────────────────
  function statusCard() {
    const s = state.team.status || 'draft';
    const approvedCount = state.members.filter(m => m.status === 'approved').length;

    const body = [];
    body.push(el('div', { class: 'reg__statusRow' }, [
      el('span', { class: 'reg__note', text: '報名狀態' }),
      statusBadge(s)
    ]));

    if (s === 'approved') {
      body.push(el('p', { class: 'reg__note', text: '主辦已經審核通過，名單鎖定。要更動請聯絡主辦。' }));
    } else if (s === 'submitted') {
      body.push(el('p', { class: 'reg__note', text: '已送出，等主辦審核。這段期間名單凍結——要改請先撤回。' }));
      body.push(el('button', {
        class: 'btn btn--lg', type: 'button', disabled: state.busy,
        onClick: () => setStatus('draft', '撤回報名', '撤回後名單會解凍，你可以繼續調整。記得改完再送出一次。')
      }, iconText('undo', '撤回報名')));
    } else {
      if (s === 'rejected') {
        body.push(el('div', { class: 'reg__box reg__box--warn' }, [
          el('strong', { text: '主辦退回了這份報名' }),
          el('p', { class: 'reg__note', text: state.team.rejectReason || '沒有填寫原因，請直接聯絡主辦。' })
        ]));
      }
      body.push(el('p', { class: 'reg__note', text: `目前已核准 ${approvedCount} 人。送出之後名單會凍結。` }));
      body.push(el('button', {
        class: 'btn btn--xl btn--primary', type: 'button',
        disabled: state.busy || approvedCount === 0 || !state.reg?.open,
        onClick: () => setStatus('submitted', '送出報名',
          `送出後名單會凍結，等主辦審核。目前有 ${approvedCount} 位已核准的成員。要再調整就得先撤回。`)
      }, iconText('check', '送出報名')));

      if (approvedCount === 0) {
        body.push(el('p', { class: 'reg__fine', text: '至少要有一位已核准的成員才能送出。' }));
      }
      if (state.reg && !state.reg.open) {
        body.push(el('p', { class: 'reg__fine', text: state.reg.reason }));
      }
    }

    return el('section', { class: 'reg__card' }, body);
  }

  // ── 邀請碼 ──────────────────────────────────────────────
  function inviteCard() {
    const code = state.team.inviteCode || '—';
    const link = `${location.origin}/#/join/${encodeURIComponent(code)}`;
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('qr', '邀請隊友')),
      el('p', { class: 'reg__note', text: '把下面的連結或代碼給隊友（兒童組給家長）。他們用 LINE 登入後填資料，再由你同意。' }),
      el('div', { class: 'reg__code' }, [
        el('span', { class: 'reg__codeLabel', text: '邀請碼' }),
        el('code', { class: 'reg__codeValue', text: code })
      ]),
      el('div', { class: 'reg__btnRow' }, [
        el('button', { class: 'btn btn--lg btn--primary', type: 'button', onClick: () => copy(link, '邀請連結') },
          iconText('forward', '複製邀請連結', { trailing: true })),
        el('button', { class: 'btn btn--lg', type: 'button', onClick: () => copy(code, '邀請碼') }, '複製代碼')
      ]),
      el('p', { class: 'reg__fine', text: '知道代碼只能「申請」加入，一定要你同意才會進名單。' })
    ]);
  }

  // ── 教練直接新增小球員（學童組）──────────────────────────
  //
  // 主辦 2026-09-03 指定的流程：
  //   創立球隊 → 選未成年組別 → 教練自己新增小球員（暱稱／後四碼／民國年生日）
  //   → 送出報名 → 當天教練帶證件與大會名單核對 → 檢錄員勾選確認出賽
  //
  // 這裡**不收真實姓名**。檢錄當天核對的是「身分證後四碼＋出生年月日」，
  // 暱稱只是給教練自己認人用的。
  function addMemberCard() {
    if (frozen()) {
      return el('section', { class: 'reg__card' }, [
        el('h2', { class: 'reg__cardHead' }, iconText('person', '新增球員')),
        el('p', { class: 'reg__note', text: '名單已經送審凍結，現在不能增減。要修改請先撤回報名。' })
      ]);
    }

    const editing = !!state.form?.memberId;
    const f = state.form;

    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('person', editing ? '修改球員' : '新增球員')),
      el('p', { class: 'reg__note', text: '這一組由你（球隊負責人）直接建立名單，不需要小朋友或家長登入。' }),
      el('p', { class: 'reg__fine', text: '比賽當天請攜帶證件（健保卡或戶口名簿）與大會名單核對，檢錄員會在名單上勾選確認出賽。' }),
      f ? memberForm(f, editing) : el('button', {
        class: 'btn btn--lg btn--primary', type: 'button',
        onClick: () => { state.form = blankForm(); state.formErrors = {}; render(); }
      }, iconText('person', '新增一位球員'))
    ]);
  }

  function blankForm(m) {
    return {
      memberId: m?.memberId ?? null,
      name: m?.name ?? '',
      birthDate: m?.birthDate ?? '',
      idLast4: m?.idLast4 ?? '',
      jerseyNo: m?.jerseyNo != null ? String(m.jerseyNo) : '',
      kind: m?.kind ?? 'player'
    };
  }

  function memberForm(f, editing) {
    const e = state.formErrors;
    const err = k => e[k] ? el('p', { class: 'reg__hint reg__hint--err', text: e[k] }) : null;

    return el('div', { class: 'reg__form' }, [
      field('m-name', f.kind === 'player' ? '暱稱' : '姓名',
        textInput('m-name', {
          value: f.name, maxlength: 20, placeholder: f.kind === 'player' ? '小豆子' : '林教練',
          onInput: v => { f.name = v; }
        }),
        {
          required: true,
          hint: f.kind === 'player'
            ? '會顯示在公開名單與賽程上，請用小朋友的暱稱或小名，不要填全名。'
            : '隊職員的姓名不會公開顯示。'
        }),
      err('name'),

      f.kind === 'player' ? field('m-birth', '出生年月日（民國年）',
        rocDateInput('m-birth', { value: f.birthDate, onChange: iso => { f.birthDate = iso || ''; } }),
        { required: true, hint: birthHint() }) : null,
      f.kind === 'player' ? err('birthDate') : null,

      f.kind === 'player' ? field('m-id4', '身分證後四碼',
        textInput('m-id4', {
          value: f.idLast4, maxlength: 4, inputmode: 'numeric', placeholder: '1234',
          onInput: v => { f.idLast4 = v.replace(/\D/g, '').slice(0, 4); }
        }),
        { required: true, hint: '只存後四碼，不會存完整號碼。檢錄當天用它跟證件核對。' }) : null,
      f.kind === 'player' ? err('idLast4') : null,

      field('m-no', '背號', textInput('m-no', {
        value: f.jerseyNo, maxlength: 2, inputmode: 'numeric', placeholder: '9',
        onInput: v => { f.jerseyNo = v.replace(/\D/g, '').slice(0, 2); }
      }), { hint: '之後還能改，現在可以先留空。' }),
      err('jerseyNo'),

      field('m-kind', '身分', selectInput('m-kind', [
        { value: 'player', label: '球員' },
        { value: 'leader', label: '領隊' },
        { value: 'coach', label: '教練' },
        { value: 'manager', label: '管理' }
      ], { value: f.kind, onChange: v => { f.kind = v; render(); } }),
        { hint: '隊職員（領隊、教練、管理）各 1 位，不上場，不必填生日與後四碼。' }),

      el('div', { class: 'reg__btnRow' }, [
        el('button', {
          class: 'btn btn--lg btn--primary', type: 'button', disabled: state.busy,
          onClick: () => saveMember(f, editing)
        }, iconText('check', editing ? '儲存修改' : '加入名單')),
        el('button', {
          class: 'btn btn--lg', type: 'button', disabled: state.busy,
          onClick: () => { state.form = null; state.formErrors = {}; render(); }
        }, '取消')
      ])
    ].filter(Boolean));
  }

  /** 把規章的門檻用民國年講出來，家長照證件抄就不會錯組 */
  function birthHint() {
    const limit = state.division?.eligibility?.bornOnOrAfter;
    const name = state.division?.name || '這一組';
    if (!limit) return '照證件上的民國年填，例如 105 年 9 月 1 日就填 105 / 9 / 1。';
    return `${name}限「${rocLabel(limit)}」以後出生（含當天）。照證件上的民國年填。`;
  }

  async function saveMember(f, editing) {
    const payload = {
      name: String(f.name || '').trim(),
      birthDate: f.birthDate || null,
      idLast4: f.idLast4 || null,
      jerseyNo: f.jerseyNo === '' ? null : Number(f.jerseyNo),
      kind: f.kind
    };

    // 前端擋一次是為了給好的訊息，權威仍在 rules 與規章設定
    const v = validateMember(payload, state.division);
    if (!v.ok) { state.formErrors = v.errors; render(); return; }

    if (!editing) {
      const active = state.members.filter(m => m.status === 'approved' || m.status === 'pending');
      const room = canAddMember(active, payload.kind === 'player' ? 'player' : 'staff', REGISTRATION_LIMITS);
      if (!room.ok) { state.error = room.message; render(); return; }
    }

    state.formErrors = {};
    await run(
      () => editing
        ? data.editMemberByCoach(teamId, f.memberId, payload)
        : data.addMemberByCoach(teamId, payload),
      editing ? '已更新' : `已加入「${payload.name}」`
    );
    if (!state.error) { state.form = null; render(); }
  }

  // ── 待審申請 ────────────────────────────────────────────
  function pendingCard() {
    const rows = state.members.filter(m => m.status === 'pending');
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('person', `待你同意（${rows.length}）`)),
      !rows.length
        ? el('p', { class: 'reg__note', text: '目前沒有待處理的申請。' })
        : el('ul', { class: 'reg__list' }, rows.map(m => el('li', { class: 'reg__member' }, [
            memberInfo(m),
            frozen()
              ? el('span', { class: 'reg__fine', text: '名單已凍結，撤回報名後才能處理。' })
              : el('div', { class: 'reg__btnRow' }, [
                  el('button', {
                    class: 'btn btn--sm btn--primary', type: 'button', disabled: state.busy,
                    onClick: () => decide(m, 'approved', '同意加入')
                  }, iconText('check', '同意')),
                  el('button', {
                    class: 'btn btn--sm', type: 'button', disabled: state.busy,
                    onClick: () => decide(m, 'rejected', '婉拒這筆申請')
                  }, '婉拒')
                ])
          ])))
    ]);
  }

  // ── 已核准名單 ──────────────────────────────────────────
  function rosterCard() {
    const rows = state.members.filter(m => m.status === 'approved');
    const players = rows.filter(m => (m.kind || 'player') === 'player').length;
    const staff = rows.length - players;

    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('team', `球隊名單（${rows.length}）`)),
      // 規章第十二條的上限直接寫在標題下面，教練才不會填到第 16 個才被擋
      el('p', {
        class: 'reg__fine',
        text: `球員 ${players} / ${REGISTRATION_LIMITS.maxPlayers}　·　隊職員 ${staff} / ${REGISTRATION_LIMITS.maxStaff}（競賽規章第十二條）`
      }),
      !rows.length
        ? el('p', {
            class: 'reg__note',
            text: youth() ? '還沒有球員。用上面的「新增一位球員」建立名單。' : '還沒有成員。把邀請碼給隊友吧。'
          })
        : el('ul', { class: 'reg__list' }, rows.map(m => el('li', { class: 'reg__member' }, [
            memberInfo(m),
            frozen()
              ? null
              : el('div', { class: 'reg__btnRow' }, [
                  // 只有教練自己填的那幾筆才改得動；家長送來的只能移除
                  // （firestore.rules 的 coachMemberEditOk 也是這樣守的，R69b）
                  m.source === 'coach'
                    ? el('button', {
                        class: 'btn btn--sm', type: 'button', disabled: state.busy,
                        onClick: () => { state.form = blankForm(m); state.formErrors = {}; render(); }
                      }, '修改')
                    : null,
                  el('button', {
                    class: 'btn btn--sm', type: 'button', disabled: state.busy,
                    onClick: () => decide(m, 'removed', '把這位成員移出名單')
                  }, '移除')
                ].filter(Boolean))
          ].filter(Boolean))))
    ]);
  }

  function memberInfo(m) {
    return el('div', { class: 'reg__memberInfo' }, [
      el('strong', { class: 'reg__memberName', text: m.name || '（未填姓名）' }),
      el('span', {
        class: 'reg__memberMeta',
        text: [
          KIND_LABEL[m.kind || m.role] || '球員',
          m.jerseyNo != null ? `#${m.jerseyNo}` : null,
          // 生日用民國年顯示：檢錄當天教練是拿證件對，證件上是民國年
          m.birthDate ? rocShort(m.birthDate) : null,
          m.idLast4 ? `末四碼 ${m.idLast4}` : null
        ].filter(Boolean).join('　·　')
      }),
      m.status !== 'approved' && m.status !== 'pending'
        ? el('span', { class: 'reg__memberMeta', text: MEMBER_STATUS[m.status] || m.status })
        : null
    ].filter(Boolean));
  }

  // ── 公告 ────────────────────────────────────────────────
  function announcementCard() {
    let draft = state.team.announcement?.text || '';
    return el('section', { class: 'reg__card' }, [
      el('h2', { class: 'reg__cardHead' }, iconText('note', '球隊公告')),
      el('p', { class: 'reg__note', text: '只有隊員與主辦看得到。單則，最新的會蓋掉舊的。' }),
      el('textarea', {
        class: 'reg__textarea', id: 'ann', rows: '3', maxlength: '300',
        placeholder: '例：週六 8:30 太原球場集合，記得帶健保卡。',
        onInput: e => { draft = e.target.value; }
      }, draft),
      el('button', {
        class: 'btn btn--lg', type: 'button', disabled: state.busy,
        onClick: () => saveAnnouncement(draft)
      }, iconText('check', '儲存公告')),
      el('p', { class: 'reg__fine', text: '不會發 LINE 通知——隊員進球隊頁就看得到。' })
    ]);
  }

  // ── 動作 ────────────────────────────────────────────────

  async function setStatus(status, title, body) {
    if (!await confirmDialog({ title, body, confirmText: title })) return;
    await run(() => data.patchTeam(teamId, {
      status,
      ...(status === 'submitted' ? { submittedAt: new Date() } : {})
    }), `${title}完成`);
  }

  async function decide(m, status, title) {
    if (status !== 'approved') {
      const ok = await confirmDialog({
        title, body: `${m.name || '這位成員'}　${title}？`, confirmText: '確定', tone: 'danger'
      });
      if (!ok) return;
    }
    await run(() => data.decideMember(teamId, m.memberId, status),
      status === 'approved' ? '已加入名單' : '已處理');
  }

  async function saveAnnouncement(text) {
    await run(() => data.patchTeam(teamId, {
      announcement: { text: String(text ?? '').slice(0, 300) || null, updatedAt: new Date(), updatedBy: user().uid }
    }), '公告已更新');
  }

  /** 共用的送出包裝：忙碌鎖、錯誤留在畫面上、成功給輕提示 */
  async function run(fn, okMsg) {
    if (state.busy) return;
    state.busy = true;
    state.error = null;
    render();
    try {
      await fn();
      toast(okMsg, 'success');
    } catch (err) {
      console.error('[manage]', err);
      state.error = data.explain(err);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`已複製${what}`, 'success');
    } catch {
      toast(`這個瀏覽器不允許自動複製，請長按上面的${what}手動選取。`, 'warn');
    }
  }
}
