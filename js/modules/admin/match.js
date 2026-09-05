/**
 * 場次改判 `#/admin/match/:matchId`
 * ------------------------------------------------------------------
 * 規格：docs/04 §6（管理員 LIVE 介面）；競賽規章第十八條第 6 款
 *
 * ⭐ 這一頁是**比賽當天記錯分時唯一的補救工具**。在此之前，賽務台送出
 *    完賽超過三分鐘就再也改不動了（rules 分支 D 的視窗過了），
 *    現場只能請主辦直接開 Firestore Console 改資料。
 *
 * 四件不可協商：
 *   1. **每一個動作都必填原因。** 改的是已經公開出去的結果，
 *      「一切可修正、一切留痕」在這裡最需要被遵守。
 *   2. **按下去之前先講後果。** 重開會讓積分榜收回分數、改判會讓名次
 *      當場改變、公開端立刻跟著變——這些都要在確認框裡寫出來。
 *   3. **權限逐項判斷。** 覆核／重開／改判是三條不同的權限碼，
 *      總管可以只關掉其中一條（R-PERM-001）。
 *   4. **棄賽比分不給填。** 規章第十八條第 6 款判 0:2，由引擎算。
 *
 * ⚠️ 頁面模組的順序陷阱（CLAUDE.md）：render() 會用到的東西一律具名函式。
 */

import { el, mount, toast, skeleton, confirmDialog } from '../../core/ui.js';
import { icon, iconText } from '../../core/icons.js';
import { can, onAuth, user } from '../../core/firebase.js';
import { hold } from '../../core/store.js';
import { hhmm, dateLabelFromYmd, STATUS_LABEL } from '../../lib/format.js';
import { normalizeAudit, describeAudit } from '../../engine/audit.js';
import {
  canConfirm, canReopen, canOverride, canWalkover,
  buildConfirmPatch, buildReopenPatch, buildOverridePatch,
  buildWalkoverPatch, buildStatusPatch, consequencesOf, scoreOf, resultOf
} from './match-actions.js';
import * as data from './data.js';
import { adminHead, denied } from './bits.js';

export async function adminMatchPage({ scope, view, params }) {
  const root = el('div', { class: 'adm' });
  mount(view, root);
  mount(root, adminHead('場次改判'), skeleton(4));

  const matchId = params?.matchId;

  const state = {
    match: undefined,          // undefined = 還沒載入；null = 不存在
    audits: [],
    // 改判比分的草稿
    draft: null,
    busy: '', error: null
  };

  hold(scope, onAuth(() => render()), 'auth:admin-match');

  if (!can('match.score.override') && !can('match.confirm') && !can('match.reopen')) {
    mount(root, adminHead('場次改判'), denied('場次改判', '管理員'));
    return;
  }

  data.watchMatch(scope, matchId, m => {
    state.match = m;
    // 伺服器的比分變了就重建草稿——但只在自己沒有在編輯時
    if (!state.draft) state.draft = draftFrom(m);
    render();
  }, err => { state.error = err; state.match = null; render(); });

  data.getMatchAudits(matchId).then(rows => { state.audits = rows; render(); }).catch(() => {});

  // ── 具名函式（會被提升）───────────────────────────────────

  function draftFrom(m) {
    return {
      home: scoreOf(m?.score?.home) ?? 0,
      away: scoreOf(m?.score?.away) ?? 0,
      pkHome: scoreOf(m?.penaltyScore?.home),
      pkAway: scoreOf(m?.penaltyScore?.away)
    };
  }

  function dirty() {
    const d = state.draft;
    const base = draftFrom(state.match);
    return d && JSON.stringify(d) !== JSON.stringify(base);
  }

  /** 每一個動作都走這一支：問原因 → 講後果 → 寫入 → 留痕 */
  async function act({ action, label, patch, before, after, tone = 'danger', needReason = true }) {
    const lines = consequencesOf(state.match, action);
    const ok = await confirmDialog({
      title: label,
      body: [...lines, needReason ? '' : null].filter(Boolean).join('\n'),
      confirmText: label, tone
    });
    if (!ok) return;

    let reason = null;
    if (needReason) {
      // 用瀏覽器的 prompt 而不是自己做一個對話框：這一頁一天用不到幾次，
      // 而少一個自製元件就少一處要在 320px 上驗的版面。
      reason = window.prompt(`${label}的原因（必填，會寫進稽核紀錄）：`);
      if (reason == null) return;                       // 按了取消
      reason = String(reason).trim();
      if (!reason) { toast('必須填原因', 'warn'); return; }
    }

    state.busy = action; render();
    try {
      await data.patchMatch(matchId, patch);
      await data.writeAudit({
        action: `match.${action}`,
        targetType: 'match', targetId: matchId,
        before, after, reason
      });
      state.draft = null;
      toast('已改判，積分榜會自動重算');
      data.getMatchAudits(matchId).then(rows => { state.audits = rows; render(); }).catch(() => {});
    } catch (err) {
      toast(data.explain(err, '沒有改判成功。'), 'error');
    } finally {
      state.busy = ''; render();
    }
  }

  function doConfirm() {
    return act({
      action: 'confirm', label: '覆核完賽', tone: 'default', needReason: false,
      patch: buildConfirmPatch(user()?.uid),
      before: { status: state.match.status },
      after: { status: 'confirmed' }
    });
  }

  function doReopen() {
    return act({
      action: 'reopen', label: '重開場次',
      patch: buildReopenPatch(user()?.uid),
      before: { status: state.match.status, result: state.match.result ?? null },
      after: { status: 'live' }
    });
  }

  function doOverride() {
    const d = state.draft;
    let patch;
    try {
      patch = buildOverridePatch({
        score: { home: d.home, away: d.away },
        penaltyScore: { home: d.pkHome, away: d.pkAway },
        match: state.match, uid: user()?.uid
      });
    } catch (err) { toast(err.message, 'warn'); return; }

    return act({
      action: 'override', label: '改判比分',
      patch,
      before: { score: state.match.score ?? null, result: state.match.result ?? null },
      after: { score: patch.score, result: patch.result }
    });
  }

  function doWalkover(side) {
    let patch;
    try { patch = buildWalkoverPatch({ side, uid: user()?.uid }); }
    catch (err) { toast(err.message, 'warn'); return; }
    return act({
      action: 'walkover', label: `判 ${sideName(side)} 棄賽`,
      patch,
      before: { status: state.match.status, score: state.match.score ?? null },
      after: { status: 'walkover', walkoverSide: side, score: patch.score }
    });
  }

  function doStatus(status) {
    const label = status === 'postponed' ? '延期' : '取消';
    return act({
      action: status, label: `${label}這一場`,
      patch: buildStatusPatch(status, user()?.uid),
      before: { status: state.match.status },
      after: { status }
    });
  }

  const sideName = side => (side === 'home' ? state.match?.home?.name : state.match?.away?.name) ?? side;

  // ── 畫面 ─────────────────────────────────────────────────

  function headBox() {
    const m = state.match;
    const preview = resultOf(
      { home: state.draft?.home, away: state.draft?.away },
      { home: state.draft?.pkHome, away: state.draft?.pkAway }
    );
    return el('div', { class: 'adm__box' }, [
      el('strong', { text: `${m.home?.name ?? '待定'} vs ${m.away?.name ?? '待定'}` }),
      el('p', { class: 'adm__note', text:
        [m.matchNo ? `第${m.matchNo}場` : null, m.label, m.venueName,
         m.date ? dateLabelFromYmd(m.date) : null, m.kickoffAt ? hhmm(m.kickoffAt) : null]
          .filter(Boolean).join('　·　') }),
      el('p', { class: 'adm__note' }, iconText(
        m.lock?.locked ? 'check' : 'info',
        `目前狀態：${STATUS_LABEL[m.status] ?? m.status}` +
        (m.lock?.locked ? '（已鎖定）' : '') +
        (m.revisionCount ? `・已改判 ${m.revisionCount} 次` : '')
      )),
      preview && dirty()
        ? el('p', { class: 'adm__permNote', text:
            `改判後的判定：${preview.winner === 'draw' ? '和局' : `${sideName(preview.winner)} 勝`}` +
            `（${preview.homePoints}:${preview.awayPoints} 分${preview.method === 'penalty' ? '，PK 決勝' : ''}）` })
        : null
    ].filter(Boolean));
  }

  function scoreEditor() {
    const g = canOverride(state.match);
    if (!can('match.score.override')) return lockedNote('改判比分', '管理員');
    if (!g.ok) return el('p', { class: 'adm__permNote', text: g.reason });

    const num = (key, label) => el('div', { class: 'adm__field' }, [
      el('label', { class: 'adm__fieldLabel', for: `sc-${key}`, text: label }),
      el('input', {
        class: 'adm__search adm__time', id: `sc-${key}`, type: 'number', min: '0', step: '1',
        value: state.draft[key] == null ? '' : String(state.draft[key]),
        onInput: e => {
          const v = e.target.value === '' ? null : Math.trunc(Number(e.target.value));
          state.draft[key] = Number.isFinite(v) ? v : null;
          render();
        }
      })
    ]);

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '改判比分' }),
      el('div', { class: 'adm__schedRow' }, [
        num('home', state.match.home?.name ?? '主隊'),
        num('away', state.match.away?.name ?? '客隊')
      ]),
      el('p', { class: 'adm__permNote', text: 'PK 只在正規時間平手時才決定勝負，沒有就留空。' }),
      el('div', { class: 'adm__schedRow' }, [
        num('pkHome', 'PK 主'),
        num('pkAway', 'PK 客')
      ]),
      el('div', { class: 'adm__actions' }, [
        el('button', {
          class: 'btn btn--primary btn--lg', type: 'button',
          disabled: !dirty() || state.busy === 'override',
          onClick: () => doOverride()
        }, iconText('check', '改判比分')),
        dirty()
          ? el('button', {
              class: 'btn btn--lg', type: 'button',
              onClick: () => { state.draft = draftFrom(state.match); render(); }
            }, iconText('undo', '放棄變更'))
          : null
      ].filter(Boolean))
    ]);
  }

  function lockedNote(what, need) {
    return el('p', { class: 'adm__permNote', text: `「${what}」被總管關掉了，或你的身分不足（需要${need}）。` });
  }

  function actionsBox() {
    const m = state.match;
    const confirmG = canConfirm(m);
    const reopenG = canReopen(m);
    const woG = canWalkover(m);

    const row = (label, iconName, guard, permCode, onClick, tone) => {
      if (!can(permCode)) return lockedNote(label, '管理員');
      return el('div', { class: 'adm__perm' }, [
        el('div', { class: 'adm__permMain' }, [
          el('span', { class: 'adm__permLabel', text: label }),
          el('span', { class: 'adm__permMeta', text: guard.ok ? '' : guard.reason })
        ]),
        el('button', {
          class: `btn btn--lg${tone === 'primary' ? ' btn--primary' : ''}`, type: 'button',
          disabled: !guard.ok || !!state.busy,
          onClick
        }, iconText(iconName, label))
      ]);
    };

    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: '狀態' }),
      row('覆核完賽', 'check', confirmG, 'match.confirm', () => doConfirm(), 'primary'),
      row('重開場次', 'undo', reopenG, 'match.reopen', () => doReopen()),

      can('match.score.override') ? el('h3', { class: 'adm__sectionHead', text: '棄賽與延期' }) : null,
      can('match.score.override')
        ? el('div', { class: 'adm__box' }, [
            el('p', { class: 'adm__note', text:
              '競賽規章第十八條第 6 款：逾時 5 分鐘不出場以棄權論 0:2。比分由系統依規章判定，不能手填。' }),
            el('div', { class: 'adm__choices' }, [
              el('button', {
                class: 'adm__choice', type: 'button', disabled: !woG.ok || !!state.busy,
                onClick: () => doWalkover('home')
              }, [
                el('span', { class: 'adm__choiceName', text: `${m.home?.name ?? '主隊'} 棄賽` }),
                el('span', { class: 'adm__choiceNote', text: '對手獲判勝' })
              ]),
              el('button', {
                class: 'adm__choice', type: 'button', disabled: !woG.ok || !!state.busy,
                onClick: () => doWalkover('away')
              }, [
                el('span', { class: 'adm__choiceName', text: `${m.away?.name ?? '客隊'} 棄賽` }),
                el('span', { class: 'adm__choiceNote', text: '對手獲判勝' })
              ])
            ]),
            el('div', { class: 'adm__actions' }, [
              el('button', {
                class: 'btn btn--lg', type: 'button', disabled: !!state.busy,
                onClick: () => doStatus('postponed')
              }, iconText('clock', '延期')),
              el('button', {
                class: 'btn btn--lg', type: 'button', disabled: !!state.busy,
                onClick: () => doStatus('cancelled')
              }, iconText('close', '取消'))
            ])
          ])
        : null
    ].filter(Boolean));
  }

  function auditsBox() {
    if (!state.audits.length) return null;
    // 還沒同步的（at 是 null）排最後：Firestore 的 null 最小，而且那一筆
    // 在時間軸上的位置本來就還不確定
    const ms = v => (v?.toMillis ? v.toMillis() : (typeof v === 'number' ? v : Date.parse(v ?? '')));
    const rows = state.audits.map(normalizeAudit).filter(Boolean)
      .sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));
    return el('div', {}, [
      el('h3', { class: 'adm__sectionHead', text: `這一場的改判紀錄（${rows.length}）` }),
      el('ul', { class: 'adm__audits' }, rows.map(a => {
        const d = describeAudit(a);
        return el('li', { class: 'adm__audit' }, [
          el('p', { class: 'adm__auditTitle', text: d.title }),
          ...d.detail.map(t => el('p', { class: 'adm__auditNote', text: t }))
        ]);
      }))
    ]);
  }

  function render() {
    if (state.match === undefined) { mount(root, adminHead('場次改判'), skeleton(4)); return; }

    if (state.error || state.match === null) {
      mount(root, adminHead('場次改判'),
        el('div', { class: 'adm__box adm__box--warn', role: 'alert' }, [
          el('strong', { text: state.match === null ? '找不到這一場' : '讀不到場次' }),
          el('p', { class: 'adm__note', text: state.error ? data.explain(state.error) : `場次代碼 ${matchId}` })
        ]));
      return;
    }

    if (!state.draft) state.draft = draftFrom(state.match);

    mount(root,
      adminHead('場次改判', { sub: state.busy ? '處理中…' : matchId }),
      headBox(),
      el('p', { class: 'adm__permNote', text:
        '這一頁的每一個動作都會寫進稽核紀錄，而且公開端會立刻看到結果。' }),
      scoreEditor(),
      actionsBox(),
      auditsBox()
    );
  }
}
